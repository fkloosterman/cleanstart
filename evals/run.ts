/**
 * Eval harness (WP0.5, extended for extraction in WP1.4): `bun run evals`
 *
 * Loads every fixture file in evals/fixtures/ and evaluates it:
 *   - text fixtures: send system+prompt to the purpose's model, assert on
 *     the raw reply.
 *   - extraction fixtures: run the real profile extractor over the exchange,
 *     apply the returned patches, and assert on the resulting profile
 *     (transcript → expected profile, §6.5).
 * Reports pass/fail per fixture; exits non-zero if any fixture fails.
 *
 * Adding a fixture file is the only step needed to cover a new case.
 *
 * Per D16/D12: evals are run manually before prompt-touching merges, with
 * env pointing at the production-designated models — never only against the
 * free dev models a prompt might accidentally be tuned to.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateText } from "ai";
import { createModelForPurpose } from "@/lib/ai-gateway.server";
import { resolveModelConfig } from "@/lib/model-map";
import { normalizeProfile, slotFilled } from "@/lib/profile/normalize";
import { applyPatches } from "@/lib/profile/patches";
import { extractProfilePatches } from "@/lib/profile/extractor";
import { createExtractionGenerate } from "@/lib/profile/extractor.server";
import type { SessionProfile } from "@/lib/profile/registry";
import type {
  AnyFixture,
  EvalAssertion,
  EvalFixtureModule,
  ExtractionExpectation,
  ExtractionFixture,
  TextFixture,
} from "./types";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

function checkAssertion(assertion: EvalAssertion, output: string): string | null {
  switch (assertion.kind) {
    case "contains": {
      const haystack = assertion.caseSensitive ? output : output.toLowerCase();
      const needle = assertion.caseSensitive ? assertion.value : assertion.value.toLowerCase();
      return haystack.includes(needle)
        ? null
        : `expected output to contain ${JSON.stringify(assertion.value)}`;
    }
    case "matches": {
      const re = new RegExp(assertion.pattern, assertion.flags);
      return re.test(output) ? null : `expected output to match /${assertion.pattern}/`;
    }
    case "json-parses": {
      try {
        JSON.parse(output);
        return null;
      } catch {
        return "expected output to be valid JSON";
      }
    }
  }
}

/** Order-insensitive structural equality for small fixture values. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

function checkExpectation(exp: ExtractionExpectation, profile: SessionProfile): string | null {
  switch (exp.kind) {
    case "slot-filled":
      return slotFilled(profile[exp.slot]) ? null : `expected ${exp.slot} to be filled`;
    case "slot-empty":
      return slotFilled(profile[exp.slot]) ? `expected ${exp.slot} to be empty` : null;
    case "slot-value":
      return deepEqual(profile[exp.slot].value, exp.value)
        ? null
        : `expected ${exp.slot} = ${JSON.stringify(exp.value)}, got ${JSON.stringify(profile[exp.slot].value)}`;
    case "list-includes": {
      const value = profile[exp.slot].value;
      const list = Array.isArray(value) ? value : [];
      const needle = exp.text.toLowerCase();
      const hit = list.some((entry) => {
        const text = typeof entry === "string" ? entry : ((entry as { text?: string }).text ?? "");
        return text.toLowerCase().includes(needle);
      });
      return hit ? null : `expected ${exp.slot} to include an entry matching "${exp.text}"`;
    }
  }
}

async function loadFixtures(): Promise<AnyFixture[]> {
  const files = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".fixture.ts"))
    .sort();
  const fixtures: AnyFixture[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(FIXTURES_DIR, file)).href)) as {
      default: EvalFixtureModule;
    };
    const value = mod.default;
    fixtures.push(...(Array.isArray(value) ? value : [value]));
  }
  return fixtures;
}

async function runText(fixture: TextFixture, apiKey: string): Promise<string[]> {
  const { text } = await generateText({
    model: createModelForPurpose(fixture.purpose, apiKey),
    system: fixture.system,
    prompt: fixture.prompt,
  });
  return fixture.assertions
    .map((a) => checkAssertion(a, text))
    .filter((e): e is string => e !== null);
}

async function runExtraction(fixture: ExtractionFixture, apiKey: string): Promise<string[]> {
  const base = normalizeProfile(fixture.base ?? {});
  const patches = await extractProfilePatches(
    base,
    fixture.exchange,
    createExtractionGenerate(apiKey),
  );
  const { profile } = applyPatches(base, patches);
  return fixture.expect
    .map((e) => checkExpectation(e, profile))
    .filter((e): e is string => e !== null);
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("Missing OPENROUTER_API_KEY — set it in .env or the environment.");
  process.exit(1);
}

const fixtures = await loadFixtures();
if (fixtures.length === 0) {
  console.error(`No fixtures found in ${FIXTURES_DIR}.`);
  process.exit(1);
}

let failures = 0;
for (const fixture of fixtures) {
  const purpose = fixture.type === "extraction" ? "extraction" : fixture.purpose;
  const { modelId } = resolveModelConfig(purpose, process.env);
  let errors: string[];
  try {
    errors =
      fixture.type === "extraction"
        ? await runExtraction(fixture, apiKey)
        : await runText(fixture, apiKey);
  } catch (err) {
    errors = [`model call failed: ${err instanceof Error ? err.message : String(err)}`];
  }

  if (errors.length === 0) {
    console.log(`PASS  ${fixture.name}  [${purpose} → ${modelId}]`);
  } else {
    failures++;
    console.error(`FAIL  ${fixture.name}  [${purpose} → ${modelId}]`);
    for (const error of errors) console.error(`      ${error}`);
  }
}

console.log(`\n${fixtures.length - failures}/${fixtures.length} fixtures passed`);
process.exit(failures > 0 ? 1 : 0);
