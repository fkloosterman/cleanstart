/**
 * Server wiring for the report composer (WP3.6). Kept separate from the pure
 * `composer.ts` so that module stays free of the AI-gateway and Supabase
 * imports and remains trivially unit-testable. Both report paths — the
 * authenticated `report.functions.ts` and the guest `guest-report.functions.ts`
 * — compose through `composeReportDocument` here, so a single orchestration owns
 * the retry→fallback contract (§6.3) and neither path can drift from it.
 *
 * The one behavioral difference between the paths is a parameter: guests skip
 * the retry and go straight to the deterministic fallback on failure (§9), since
 * a guest report is cost-bounded and disposable.
 *
 * Like the extractor's server layer, the model call is built here from the
 * model-map's `composition` purpose (D12) so ZDR/no-training routing and the
 * production-designated model apply uniformly.
 */

import { generateText } from "ai";
import { createModelForPurpose } from "@/lib/ai-gateway.server";
import {
  buildCandidateContext,
  selectCandidates,
  DEFAULT_CANDIDATE_LIMIT,
} from "@/lib/content/candidates";
import type { ContentComponent, ContentMedia, ContentSource } from "@/lib/content/schema";
import { deriveLane } from "@/lib/lanes/derive";
import { slotValue } from "@/lib/profile/normalize";
import type { SessionProfile } from "@/lib/profile/registry";
import type { ReportDocument } from "@/lib/report/document";
import {
  assembleReportDocument,
  authoringAllowedTopics,
  buildComposerPrompt,
  buildComposerSystem,
  buildConversationDigest,
  composerOutputSchema,
  deterministicFallback,
  toComposerCandidate,
  validateComposerOutput,
  parseComposerJson,
  MIN_VIABLE_ITEMS,
  type AssemblyLibrary,
  type ComposerInput,
  type ValidatedComposition,
} from "@/lib/report/composer";

/** The composition model call (D12). Temperature 0 — selection is structured, not creative. */
export type ComposeGenerate = (args: { system: string; prompt: string }) => Promise<string>;

export function createCompositionGenerate(apiKey: string): ComposeGenerate {
  const model = createModelForPurpose("composition", apiKey);
  return async ({ system, prompt }) => {
    const { text } = await generateText({ model, system, prompt, temperature: 0 });
    return text;
  };
}

// The full component columns assembly needs — including body_md (frozen into the
// document's background section) and every source field, unlike chat grounding
// (retrieval.server.ts) which deliberately omits the body.
const COMPONENT_COLUMNS =
  "slug, kind, title, summary, body_md, technologies, lanes, tenures, housing_types, regions, prerequisites, effort, impact, sources, last_verified, expires, status, version, media";
const SOURCE_COLUMNS = "slug, label, url, publisher, last_verified";
// Media columns feed the frozen figures in the document's background section
// (§7.1); the renderer resolves storage_path → a public URL at render time.
const MEDIA_COLUMNS = "slug, kind, storage_path, alt, caption, credit, technologies, regions";

/**
 * Load the published content library for composition. Forgiving like every
 * other content read (§WP3.2): any failure — tables not migrated, a preview
 * with no service-role env, a transient outage — yields an empty library, and
 * the composer falls back to a profile-only report rather than throwing.
 */
export async function loadCompositionLibrary(): Promise<AssemblyLibrary> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [componentsRes, sourcesRes, mediaRes] = await Promise.all([
      supabaseAdmin.from("content_components").select(COMPONENT_COLUMNS).eq("status", "published"),
      supabaseAdmin.from("content_sources").select(SOURCE_COLUMNS),
      supabaseAdmin.from("content_media").select(MEDIA_COLUMNS),
    ]);
    if (componentsRes.error || !componentsRes.data)
      return { components: [], sources: [], media: [] };
    return {
      // The tables are a projection of already-validated content (WP3.1/3.2); cast
      // at this trust boundary. A malformed row simply fails to match filters.
      components: componentsRes.data as unknown as ContentComponent[],
      sources: (sourcesRes.data ?? []) as unknown as ContentSource[],
      media: (mediaRes.data ?? []) as unknown as ContentMedia[],
    };
  } catch {
    return { components: [], sources: [], media: [] };
  }
}

/** One model attempt: generate → parse → Zod → validate. Null when unparseable. */
async function attempt(
  input: ComposerInput,
  generate: ComposeGenerate,
  retryErrors?: string[],
): Promise<ValidatedComposition | null> {
  const system = buildComposerSystem();
  let prompt = buildComposerPrompt(input);
  if (retryErrors && retryErrors.length > 0) {
    prompt += `\n\nYour previous attempt had problems — fix them:\n${retryErrors
      .map((e) => `- ${e}`)
      .join("\n")}`;
  }
  const text = await generate({ system, prompt });
  const parsed = parseComposerJson(text);
  if (parsed === null) return null;
  const result = composerOutputSchema.safeParse(parsed);
  if (!result.success) return null;
  return validateComposerOutput(result.data, input);
}

export interface ComposeOptions {
  profile: SessionProfile;
  /** The conversation, for the digest. Only `role`/`content` are read. */
  messages: { role: string; content: string }[];
  generate: ComposeGenerate;
  /** Auth path retries once on a thin result; guest goes straight to fallback (§9). */
  allowRetry: boolean;
  /** Injectable clock for deterministic tests; defaults to now. */
  now?: () => Date;
}

/**
 * Compose a `ReportDocument` for a profile. Never throws: the validation
 * pipeline plus the deterministic fallback guarantee a real, grounded document
 * on either path even when the model fails or the library is empty (§6.3).
 *
 * Flow: build candidates (WP3.3) → one model attempt → retry once with the drop
 * reasons if the result is thin and retries are allowed → deterministic fallback
 * if still unusable → assemble the document.
 */
export async function composeReportDocument(opts: ComposeOptions): Promise<ReportDocument> {
  const { profile, messages, generate, allowRetry } = opts;
  const generatedAt = (opts.now?.() ?? new Date()).toISOString();

  const library = await loadCompositionLibrary();
  const ctx = buildCandidateContext(profile);
  const scored = selectCandidates(library.components, profile, { limit: DEFAULT_CANDIDATE_LIMIT });
  const candidates = scored.map(toComposerCandidate);

  const input: ComposerInput = {
    profile,
    derivation: deriveLane(slotValue(profile, "motivation_weights")),
    candidates,
    conversationDigest: buildConversationDigest(messages),
    authoringAllowedFor: authoringAllowedTopics(candidates, ctx),
  };

  // The viability target scales with what's actually available: a thin corpus
  // legitimately yields few items and must not loop into a retry.
  const target = Math.min(MIN_VIABLE_ITEMS, candidates.length);

  let composition: ValidatedComposition | null = null;
  try {
    composition = await attempt(input, generate);
    if (allowRetry && (!composition || composition.items.length < target)) {
      const errors = composition?.errors ?? ["previous output could not be parsed as JSON"];
      composition = (await attempt(input, generate, errors)) ?? composition;
    }
  } catch (err) {
    console.error("[composer] model call failed, using fallback:", err);
    composition = null;
  }

  // Fallback when the model produced nothing usable: null (parse/model failure),
  // or an empty plan despite having candidates to choose from.
  const unusable = !composition || (candidates.length > 0 && composition.items.length === 0);
  const final = unusable ? deterministicFallback(input) : composition!;

  return assembleReportDocument(final, input, library, generatedAt);
}
