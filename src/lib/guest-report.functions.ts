import { createServerFn } from "@tanstack/react-start";
import { createOpenRouterModel } from "@/lib/ai-gateway.server";
import { buildReportPrompt } from "@/lib/prompts/report";
import { generateText } from "ai";
import { z } from "zod";

const GuestInput = z.object({
  tenure: z.enum(["homeowner", "renter", "curious"]).nullable().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      }),
    )
    .min(2)
    .max(60),
});

const ReportSchema = z.object({
  readiness_score: z.number(),
  top_options: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      good_fit_when: z.array(z.string()),
      tradeoffs: z.string(),
    }),
  ),
  key_insights: z.array(z.string()),
  next_steps: z.array(z.object({ step: z.string(), detail: z.string() })),
  resources: z.array(z.object({ label: z.string(), description: z.string() })),
});

export type GuestReport = z.infer<typeof ReportSchema> & {
  id: string;
  session_id: string;
  persona: string | null;
  created_at: string;
};

function extractJson(raw: string): unknown {
  let s = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = s.search(/[\{\[]/);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (start === -1 || end === -1) throw new Error("Model did not return JSON");
  s = s.substring(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    s = s
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\x00-\x1F\x7F]/g, "");
    return JSON.parse(s);
  }
}

export const generateGuestReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => GuestInput.parse(d))
  .handler(async ({ data }) => {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY");

    const transcript = data.messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    const persona = data.tenure ?? null;

    const model = createOpenRouterModel(OPENROUTER_API_KEY);

    const { text } = await generateText({
      model,
      system: buildReportPrompt(persona),
      prompt: `CONVERSATION TRANSCRIPT:\n\n${transcript}\n\nWrite the personalized research summary now as JSON.`,
    });

    const parsed = ReportSchema.parse(extractJson(text));

    return {
      id: "guest",
      session_id: "guest",
      persona,
      created_at: new Date().toISOString(),
      ...parsed,
    } satisfies GuestReport;
  });
