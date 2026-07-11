/**
 * Starter presets for the chat opening screen (WP3.2, design §3.6).
 *
 * Reads the world-readable `content_presets` table (synced from content/ on
 * deploy) and returns the presets that target the user's tenure. Replaces the
 * old hardcoded CHIPS list. Public data — no auth middleware.
 *
 * Deliberately forgiving: any failure (table not yet migrated/synced on a
 * fresh environment, preview with no DB) returns an empty list rather than
 * throwing. The opening screen always has its free-text input, so no presets
 * is a soft degradation, never a broken screen.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { filterPresetsByTenure } from "@/lib/content/presets";

/** Tenure targeting maps the stepper's owner/renter; "curious" → null (general only). */
const PresetInput = z.object({ tenure: z.enum(["owner", "renter"]).nullable() });

/**
 * A preset patch as it crosses the server→client boundary — a plain JSON
 * value (must be serializable for the server function). The client hands it
 * straight to `applyPatches`, which is the real validator; this type only
 * needs to be transport-safe, not exhaustive.
 */
export type PresetPatch = { op: string; slot: string; provenance: string; value?: Json };

export interface StarterPreset {
  slug: string;
  label: string;
  category: string;
  first_message: string;
  /** Profile warm-start patches (validated by applyPatches at click time). */
  profile_patches: PresetPatch[];
}

export const getPresets = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PresetInput.parse(d))
  .handler(async ({ data }): Promise<StarterPreset[]> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: rows, error } = await supabaseAdmin
        .from("content_presets")
        .select("slug, label, category, first_message, profile_patches, tenures")
        .order("slug", { ascending: true });
      if (error || !rows) return [];

      return filterPresetsByTenure(
        rows.map((r) => ({ ...r, tenures: (r.tenures ?? []) as string[] })),
        data.tenure,
      ).map((r) => ({
        slug: r.slug,
        label: r.label,
        category: r.category,
        first_message: r.first_message,
        profile_patches: Array.isArray(r.profile_patches)
          ? (r.profile_patches as PresetPatch[])
          : [],
      }));
    } catch {
      return [];
    }
  });
