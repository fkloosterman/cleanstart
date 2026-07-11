import { createModelForPurpose } from "@/lib/ai-gateway.server";
import { deriveLane } from "@/lib/lanes/derive";
import { buildContext, deriveStage } from "@/lib/prompts/context";
import { extractProfilePatches } from "@/lib/profile/extractor";
import { createExtractionGenerate } from "@/lib/profile/extractor.server";
import { normalizeProfile, slotValue } from "@/lib/profile/normalize";
import { PROFILE_PATCH_PART_TYPE } from "@/lib/profile/stream";
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
};

function textOf(msg: UIMessage) {
  return msg.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

// Very small in-memory rate limiter, per worker instance. Best-effort only.
const RATE_LIMIT = 30; // requests
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_LIMIT;
}

export const Route = createFileRoute("/api/public/chat-guest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
        if (!OPENROUTER_API_KEY) {
          return new Response("Missing OPENROUTER_API_KEY", { status: 500 });
        }

        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "anon";
        if (rateLimited(ip)) {
          return new Response("Too many requests", { status: 429 });
        }

        const body = (await request.json()) as Body;
        const messages = Array.isArray(body.messages) ? body.messages : [];
        if (messages.length === 0) {
          return new Response("Bad request", { status: 400 });
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
        const system = buildContext({
          profile: currentProfile,
          lane,
          // Guests carry no server-side readiness ratchet; stage follows the
          // current profile's sufficiency for the derived lane.
          stage: deriveStage(currentProfile, lane.framing),
        });

        const model = createModelForPurpose("chat", OPENROUTER_API_KEY);
        const modelMessages = await convertToModelMessages(trimmed);
        const lastUser = [...trimmed].reverse().find((m) => m.role === "user");
        const lastUserText = lastUser ? textOf(lastUser) : "";
        const extract = createExtractionGenerate(OPENROUTER_API_KEY);

        const stream = createUIMessageStream({
          originalMessages: trimmed,
          execute: async ({ writer }) => {
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
