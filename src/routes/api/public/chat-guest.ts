import { createModelForPurpose } from "@/lib/ai-gateway.server";
import { retrieveGrounding } from "@/lib/content/retrieval.server";
import { deriveLane } from "@/lib/lanes/derive";
import { buildContext, buildContextSections, deriveStage } from "@/lib/prompts/context";
import {
  CONTEXT_DEBUG_PART_TYPE,
  promptInspectorEnabled,
  type ContextDebugData,
} from "@/lib/prompts/inspector";
import { extractProfilePatches } from "@/lib/profile/extractor";
import { createExtractionGenerate } from "@/lib/profile/extractor.server";
import { normalizeProfile, slotValue } from "@/lib/profile/normalize";
import { PROFILE_PATCH_PART_TYPE } from "@/lib/profile/stream";
import { dayWindowStart, readGuestRateLimits, SESSION_WINDOW_START } from "@/lib/rate-limit";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit.server";
import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";

type Tenure = "homeowner" | "renter" | "curious" | null;
type Location = { zip: string; city: string; state: string; utility: string } | null;
type Body = {
  // The onboarding fields are still accepted for wire compatibility, but the
  // prompt is now built from `profile` (which the client seeds from these at
  // session start, §4.8) — the same profile-driven path as the signed-in
  // endpoint. They are no longer read here.
  tenure?: Tenure;
  location?: Location;
  messages?: UIMessage[];
  /** The guest's current localStorage profile (§9); patched per turn (WP1.5). */
  profile?: unknown;
  /**
   * The guest's session id (WP3.10) — a client-minted uuid in localStorage,
   * stable across a conversation. Keys the per-session turn cap (D7). Optional:
   * the daily IP cap still applies when it is absent.
   */
  guestSessionId?: string;
};

function textOf(msg: UIMessage) {
  return msg.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

export const Route = createFileRoute("/api/public/chat-guest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
        if (!OPENROUTER_API_KEY) {
          return new Response("Missing OPENROUTER_API_KEY", { status: 500 });
        }

        const body = (await request.json()) as Body;
        const messages = Array.isArray(body.messages) ? body.messages : [];
        if (messages.length === 0) {
          return new Response("Bad request", { status: 400 });
        }

        // Rate limiting (WP3.10, D7/D14): Postgres fixed-window counters, caps
        // read from env. The per-IP daily cap is the abuse bound; the
        // per-session turn cap (when the client sends a session id) bounds a
        // single runaway conversation. Both fail open on a DB error.
        const limits = readGuestRateLimits(process.env);
        const ip = clientIp(request);
        const today = dayWindowStart(new Date());

        const msgLimit = await enforceRateLimit("guest_msg", ip, today, limits.messagesPerDay);
        if (!msgLimit.allowed) {
          return new Response("Daily message limit reached. Sign in to keep chatting.", {
            status: 429,
          });
        }

        if (typeof body.guestSessionId === "string" && body.guestSessionId) {
          const turnLimit = await enforceRateLimit(
            "guest_session_turns",
            body.guestSessionId,
            SESSION_WINDOW_START,
            limits.turnsPerSession,
          );
          if (!turnLimit.allowed) {
            return new Response(
              "This guest conversation has reached its length limit. Start a new one or sign in.",
              { status: 429 },
            );
          }
        }

        // Cap guest conversation length to keep cost bounded
        const trimmed = messages.slice(-20);

        // Extraction + prompt inputs: the profile the client sent (normalized
        // on read, so an old/junk shape heals). The client owns persistence —
        // the server just returns patches on the stream. The upfront slots
        // (tenure/region) already live in this profile, so buildContext marks
        // them established and the agent won't re-ask (§4.8, §5.3).
        const currentProfile = normalizeProfile(body.profile);
        const lane = deriveLane(slotValue(currentProfile, "motivation_weights"));
        // Guests carry no server-side readiness ratchet; stage follows the
        // current profile's sufficiency for the derived lane.
        const stage = deriveStage(currentProfile, lane.framing);
        // Grounding retrieval (WP3.4): same library shortlist as the signed-in
        // path — guests get cited, library-grounded answers too. Resilient.
        const retrieved = await retrieveGrounding(currentProfile);
        const contextInput = { profile: currentProfile, lane, stage, retrieved };
        const system = buildContext(contextInput);

        // Dev prompt inspector (off in prod): stream the assembled prompt,
        // section by section, so a developer can see what the model was told.
        const inspector: ContextDebugData | null = promptInspectorEnabled(process.env)
          ? {
              meta: {
                lanePrimary: lane.primary,
                laneFraming: lane.framing,
                laneMixed: lane.mixed,
                stage,
              },
              sections: buildContextSections(contextInput),
            }
          : null;

        const model = createModelForPurpose("chat", OPENROUTER_API_KEY);
        const modelMessages = await convertToModelMessages(trimmed);
        const lastUser = [...trimmed].reverse().find((m) => m.role === "user");
        const lastUserText = lastUser ? textOf(lastUser) : "";
        const extract = createExtractionGenerate(OPENROUTER_API_KEY);

        const stream = createUIMessageStream({
          originalMessages: trimmed,
          execute: async ({ writer }) => {
            // Dev-only: hand the client the assembled prompt up front (transient,
            // never persisted). No-op when the inspector is disabled.
            if (inspector) {
              writer.write({ type: CONTEXT_DEBUG_PART_TYPE, data: inspector, transient: true });
            }

            const result = streamText({ model, system, messages: modelMessages });
            // Forward the reply as it streams — zero added time-to-first-token.
            writer.merge(result.toUIMessageStream());

            // Extraction runs only after the reply has fully streamed (WP1.4).
            // Never throws and never blocks the reply the user already saw.
            if (!lastUserText) return;
            // A stream failure is already surfaced via the merge; bail rather
            // than extract from a broken turn.
            let assistantText = "";
            try {
              assistantText = (await result.text).trim();
            } catch (err) {
              console.error("[/api/public/chat-guest] reply stream failed:", err);
              return;
            }
            const patches = await extractProfilePatches(
              currentProfile,
              { user: lastUserText, assistant: assistantText || undefined },
              extract,
            );
            if (patches.length === 0) return;
            // Return patches on the same stream; the client applies them onto
            // its localStorage profile via `applyPatches` (§9). Transient: a
            // side-channel, never part of the persisted message history.
            writer.write({ type: PROFILE_PATCH_PART_TYPE, data: { patches }, transient: true });
          },
          onError: (error) => {
            console.error("[/api/public/chat-guest] stream error", error);
            return error instanceof Error ? error.message : "Stream error";
          },
        });

        return createUIMessageStreamResponse({ stream });
      },
    },
  },
});
