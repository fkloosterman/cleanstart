/**
 * Guard against the transitional Vercel misconfiguration described in
 * ARCHITECTURE.md §3.4: until the global Preview env vars are flipped to the
 * dev Supabase project, a preview deployment of any branch other than `dev`
 * falls through to Preview values that point at the *production* database.
 *
 * Such a preview must not silently read/write prod data (and, once Phase 1
 * migrations exist on dev only, would half-break confusingly). This predicate
 * turns that state into a loud, self-explaining refusal. Once the global
 * Preview vars point at the dev project, the condition can never be true and
 * this guard (plus its call sites) can be deleted.
 *
 * Pure: callers pass the env values, so it runs identically on the server
 * (process.env.VERCEL_ENV / SUPABASE_URL) and in the browser
 * (import.meta.env.VITE_VERCEL_ENV / VITE_SUPABASE_URL).
 */

/** The production Supabase project ref (same value as in supabase/config.toml). */
export const PROD_SUPABASE_PROJECT_REF = "kqnkvtguipyprxpwlboh";

export interface PreviewGuardEnv {
  /** "production" | "preview" | "development" on Vercel; undefined locally. */
  VERCEL_ENV?: string;
  SUPABASE_URL?: string;
}

/**
 * Returns a human-readable refusal message when a Vercel *preview* deployment
 * is configured with the *production* database, or null when the
 * configuration is fine (production deploys, dev-database previews, local).
 */
export function previewGuardMessage(env: PreviewGuardEnv): string | null {
  const isPreview = env.VERCEL_ENV === "preview";
  const pointsAtProd = (env.SUPABASE_URL ?? "").includes(PROD_SUPABASE_PROJECT_REF);
  if (!isPreview || !pointsAtProd) return null;
  return (
    "This preview deployment is not connected to a database: previews must " +
    "never use the production database. Test locally or on the dev staging " +
    "deployment instead — see ARCHITECTURE.md §3.4 (transitional Vercel " +
    "preview setup)."
  );
}
