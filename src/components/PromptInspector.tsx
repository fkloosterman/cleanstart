/**
 * Dev prompt inspector (feat/prompt-inspector).
 *
 * Renders the assembled system prompt for the last turn — piece by piece,
 * color-coded by section — in a modal. It appears only when the server
 * streamed a `data-context-debug` part, which it only does when the
 * `EXPOSE_PROMPT_INSPECTOR` env flag is on (dev/staging), so this never
 * surfaces for production users. Purely diagnostic.
 */

import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ContextSectionId } from "@/lib/prompts/context";
import type { ContextDebugData } from "@/lib/prompts/inspector";
import { cn } from "@/lib/utils";

/** A left-border + tint per section, so the pieces read as distinct. */
const SECTION_STYLE: Record<ContextSectionId, string> = {
  base: "border-l-slate-400 bg-slate-50 dark:bg-slate-900/40",
  profile: "border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/30",
  framing: "border-l-amber-500 bg-amber-50 dark:bg-amber-950/30",
  stage: "border-l-blue-500 bg-blue-50 dark:bg-blue-950/30",
  grounding: "border-l-purple-500 bg-purple-50 dark:bg-purple-950/30",
  still_to_learn: "border-l-rose-500 bg-rose-50 dark:bg-rose-950/30",
  brevity: "border-l-slate-400 bg-slate-50 dark:bg-slate-900/40",
};

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

export function PromptInspector({ data }: { data: ContextDebugData }) {
  const [copied, setCopied] = useState(false);
  const fullPrompt = data.sections.map((s) => s.text).join("\n\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — non-fatal for a dev tool.
    }
  };

  const laneValue = data.meta.laneMixed
    ? `mixed (${data.meta.lanePrimary})`
    : data.meta.laneFraming;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1 font-mono text-xs"
          title="Dev: inspect the system prompt for the last turn"
        >
          <Search className="h-3.5 w-3.5" />
          Prompt
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-baseline gap-2">
            System prompt
            <span className="text-xs font-normal text-muted-foreground">last turn</span>
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <MetaChip label="lane" value={laneValue || "—"} />
              <MetaChip label="stage" value={data.meta.stage || "—"} />
              <MetaChip label="sections" value={String(data.sections.length)} />
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto pr-1">
          {data.sections.map((s) => (
            <section key={s.id} className={cn("rounded-md border-l-4 p-3", SECTION_STYLE[s.id])}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {s.label}
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {s.text}
              </pre>
            </section>
          ))}
        </div>

        <DialogFooter className="sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            Dev only · transient · never sent to production users
          </span>
          <Button variant="secondary" size="sm" onClick={copy}>
            {copied ? "Copied!" : "Copy full prompt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
