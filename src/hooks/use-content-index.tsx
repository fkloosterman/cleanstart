/**
 * Client content index (WP3.4) — the read side of chat grounding. Resolves the
 * slugs the agent embeds in a reply ([cite:<component>], [figure:<media>]) into
 * the records the UI renders: citation sources (D4's "Sources (n)" row) and
 * library figures.
 *
 * Loaded once per session from the *world-readable* content tables (anon SELECT
 * is granted, so guests resolve too — no auth needed), cached at module scope
 * so every message shares one fetch. Resilient: on any failure the resolvers
 * return nothing, so citations and figures are simply absent — never a crash,
 * never a broken transcript. This one index serves both live streaming and
 * history replay, since both render from the same stored marker text.
 *
 * Security note (D4): links come only from `content_sources` rows and images
 * only from `content_media`; a model-authored slug that isn't in the library
 * resolves to nothing. The agent cannot surface an arbitrary URL or image.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CitationSource {
  slug: string;
  label: string;
  publisher: string;
  url: string;
  lastVerified: string;
}

export interface FigureRecord {
  slug: string;
  url: string;
  alt: string;
  caption: string;
  credit: { source: string; license: string };
}

export interface ContentIndex {
  /** Sources for the given component slugs, de-duplicated, in first-seen order. */
  resolveCitations(componentSlugs: string[]): CitationSource[];
  /** A library figure by media slug, or null if unknown (non-library → not rendered). */
  resolveFigure(mediaSlug: string): FigureRecord | null;
  /** False until the one-time load resolves; resolvers return empty meanwhile. */
  loaded: boolean;
}

interface IndexData {
  /** component slug → its source slugs. */
  componentSources: Map<string, string[]>;
  sourceBySlug: Map<string, CitationSource>;
  figureBySlug: Map<string, FigureRecord>;
}

const EMPTY: IndexData = {
  componentSources: new Map(),
  sourceBySlug: new Map(),
  figureBySlug: new Map(),
};

let cache: IndexData | null = null;
let inflight: Promise<IndexData> | null = null;

function publicUrl(storagePath: string): string {
  return supabase.storage.from("content-media").getPublicUrl(storagePath).data.publicUrl;
}

async function load(): Promise<IndexData> {
  try {
    const [components, sources, media] = await Promise.all([
      supabase.from("content_components").select("slug, sources").eq("status", "published"),
      supabase.from("content_sources").select("slug, label, publisher, url, last_verified"),
      supabase.from("content_media").select("slug, storage_path, alt, caption, credit"),
    ]);

    const componentSources = new Map<string, string[]>();
    for (const c of components.data ?? []) {
      componentSources.set(c.slug, Array.isArray(c.sources) ? (c.sources as string[]) : []);
    }

    const sourceBySlug = new Map<string, CitationSource>();
    for (const s of sources.data ?? []) {
      sourceBySlug.set(s.slug, {
        slug: s.slug,
        label: s.label,
        publisher: s.publisher,
        url: s.url,
        lastVerified: s.last_verified,
      });
    }

    const figureBySlug = new Map<string, FigureRecord>();
    for (const m of media.data ?? []) {
      const credit = (m.credit ?? {}) as { source?: string; license?: string };
      figureBySlug.set(m.slug, {
        slug: m.slug,
        url: publicUrl(m.storage_path),
        alt: m.alt,
        caption: m.caption ?? "",
        credit: { source: credit.source ?? "", license: credit.license ?? "" },
      });
    }

    return { componentSources, sourceBySlug, figureBySlug };
  } catch {
    return EMPTY;
  }
}

function makeIndex(data: IndexData, loaded: boolean): ContentIndex {
  return {
    loaded,
    resolveFigure: (slug) => data.figureBySlug.get(slug) ?? null,
    resolveCitations: (componentSlugs) => {
      const out: CitationSource[] = [];
      const seen = new Set<string>();
      for (const compSlug of componentSlugs) {
        for (const srcSlug of data.componentSources.get(compSlug) ?? []) {
          if (seen.has(srcSlug)) continue;
          const source = data.sourceBySlug.get(srcSlug);
          if (source) {
            seen.add(srcSlug);
            out.push(source);
          }
        }
      }
      return out;
    },
  };
}

/**
 * Access the content index. Returns a live resolver immediately (empty until
 * the shared one-time fetch resolves, then re-renders with the loaded data).
 */
export function useContentIndex(): ContentIndex {
  const [data, setData] = useState<IndexData | null>(cache);

  useEffect(() => {
    if (cache) return;
    let active = true;
    inflight ??= load();
    inflight.then((result) => {
      cache = result;
      if (active) setData(result);
    });
    return () => {
      active = false;
    };
  }, []);

  return makeIndex(data ?? EMPTY, data !== null);
}
