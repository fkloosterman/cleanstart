/**
 * Renders a grounded assistant message (WP3.4, D4). Turns the raw reply — which
 * carries the agent's inline [cite:<slug>] and [figure:<slug>] directives — into
 * markdown prose, inline library figures, and a compact "Sources (n)" row.
 *
 * All slug → record resolution goes through the content index, which only knows
 * library records: a citation whose sources aren't in the library shows nothing,
 * and a figure slug outside `content_media` renders nothing. So the agent can
 * neither fabricate a source link nor display a non-library image — the WP3.4
 * guarantee, enforced at the render boundary rather than trusted from the model.
 *
 * Used by both the signed-in and guest transcripts, and identical for a live
 * stream and a replayed history row, because both are just the stored text.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { parseMessageContent } from "@/lib/chat/message-content";
import { useContentIndex, type CitationSource } from "@/hooks/use-content-index";
import { cn } from "@/lib/utils";

function ChatFigure({ slug }: { slug: string }) {
  const index = useContentIndex();
  const figure = index.resolveFigure(slug);
  // Unknown / not-yet-loaded / non-library slug → render nothing (the guarantee).
  if (!figure) return null;
  return (
    <figure className="my-1 overflow-hidden rounded-lg border border-border bg-muted/30">
      <img src={figure.url} alt={figure.alt} className="mx-auto block max-h-80 w-auto max-w-full" />
      {(figure.caption || figure.credit.source) && (
        <figcaption className="px-3 py-2 text-xs text-muted-foreground">
          {figure.caption}
          {figure.credit.source && (
            <span className="opacity-70">
              {figure.caption ? " — " : ""}
              {figure.credit.source}
              {figure.credit.license ? ` (${figure.credit.license})` : ""}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}

function SourcesRow({ sources }: { sources: CitationSource[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-1">
      <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        Sources ({sources.length})
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 space-y-1.5">
        {sources.map((s) => (
          <a
            key={s.slug}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/60"
          >
            <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="font-medium text-foreground">{s.label}</span>
              <span className="text-muted-foreground">
                {" · "}
                {s.publisher}
                {" · verified "}
                {s.lastVerified}
              </span>
            </span>
          </a>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AssistantMessage({ text }: { text: string }) {
  const parsed = useMemo(() => parseMessageContent(text), [text]);
  const index = useContentIndex();
  const sources = index.resolveCitations(parsed.citedSlugs);

  return (
    <>
      {parsed.segments.map((seg, i) =>
        seg.type === "figure" ? (
          <ChatFigure key={`fig-${i}`} slug={seg.slug} />
        ) : (
          <MessageResponse key={`txt-${i}`}>{seg.text}</MessageResponse>
        ),
      )}
      {sources.length > 0 && <SourcesRow sources={sources} />}
    </>
  );
}
