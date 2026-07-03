import { createOpenRouterModel } from "@/lib/ai-gateway.server";
import { buildSystemPrompt, type Persona } from "@/lib/clean-start-prompt";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

type Tenure = "homeowner" | "renter" | "curious" | null;
type Location = { zip: string; city: string; state: string; utility: string } | null;
type Body = {
  persona?: Persona;
  tenure?: Tenure;
  location?: Location;
  messages?: UIMessage[];
};

const TENURE_LABEL: Record<NonNullable<Tenure>, string> = {
  homeowner: "homeowner",
  renter: "renter",
  curious: "exploring (not sure yet)",
};

function buildContextSystem(
  tenureValue: string,
  city: string,
  state: string,
  utility: string,
) {
  return `You are Clean Start, a friendly and knowledgeable clean energy guide for households. Your job is to educate — never to sell. Keep answers conversational, plain-language, and under 120 words.

The user has already provided the following information during onboarding. Do NOT ask for any of this again under any circumstances:
- Home ownership status: ${tenureValue}
- City: ${city}
- State: ${state}
- Utility provider: ${utility}

Use this context to personalize every response immediately and directly. Never ask the user if they own or rent. Never ask what state, city, zip code, or utility they are on. This information is already known. Treat it as established fact in every message.

Personalization rules:
- If tenure is homeowner: focus on panel installation, federal tax credits (30%), and utility rebate programs.
- If tenure is renter: focus on community solar, portable upgrades, and renter-eligible credits.
- If tenure is exploring: give accessible overviews.
- If city and state are known: reference them by name and surface programs specific to that utility territory.
- If utility is known: reference utility-specific programs and net metering rules for that provider.`;
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

        const assistantTurnCount = trimmed.filter((m) => m.role === "assistant").length;
        const tenure = body.tenure ?? null;
        const location = body.location ?? null;
        const personaFromTenure: Persona =
          tenure === "homeowner" || tenure === "renter" || tenure === "curious" ? tenure : null;

        // Resolve placeholders up front so the system prompt never contains
        // unfilled [BRACKET] tokens — the model treats those as unknown and
        // re-asks the user.
        const tenureValue = tenure ? TENURE_LABEL[tenure] : "not provided";
        const city = location?.city ?? "not provided";
        const state = location?.state ?? "not provided";
        const utility = location?.utility ?? "not provided";

        // Safety log: if any of these read "not provided", the bug is in how
        // onboarding persists tenure/location, not in this handler.
        console.log(
          "Injecting context — tenure:", tenureValue,
          "city:", city,
          "state:", state,
          "utility:", utility,
        );

        // When onboarding context exists, skip the base prompt's DISCOVERY
        // stage (which instructs the model to ask getting-to-know-you
        // questions) by pushing the turn counter past it.
        const contextKnownBoost = (tenure ? 1 : 0) + (location ? 1 : 0);
        const baseSystem = buildSystemPrompt({
          persona: body.persona ?? personaFromTenure,
          assistantTurnCount: assistantTurnCount + contextKnownBoost,
        });
        const system = `${buildContextSystem(tenureValue, city, state, utility)}\n\n${baseSystem}`;

        const model = createOpenRouterModel(OPENROUTER_API_KEY);

        const result = streamText({
          model,
          system,
          messages: await convertToModelMessages(trimmed),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: trimmed,
          onError: (error) => {
            console.error("[/api/public/chat-guest] stream error", error);
            return error instanceof Error ? error.message : "Stream error";
          },
        });
      },
    },
  },
});
