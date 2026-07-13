import { describe, expect, it } from "vitest";
import { PROD_SUPABASE_PROJECT_REF, previewGuardMessage } from "@/lib/preview-guard";

const PROD_URL = `https://${PROD_SUPABASE_PROJECT_REF}.supabase.co`;
const DEV_URL = "https://someotherdevref.supabase.co";

describe("previewGuardMessage", () => {
  it("refuses a preview deployment pointing at the production database", () => {
    expect(previewGuardMessage({ VERCEL_ENV: "preview", SUPABASE_URL: PROD_URL })).toMatch(
      /never use the production database/,
    );
  });

  it("allows a preview deployment pointing at the dev database", () => {
    expect(previewGuardMessage({ VERCEL_ENV: "preview", SUPABASE_URL: DEV_URL })).toBeNull();
  });

  it("allows the production deployment to use the production database", () => {
    expect(previewGuardMessage({ VERCEL_ENV: "production", SUPABASE_URL: PROD_URL })).toBeNull();
  });

  it("allows local development (no VERCEL_ENV), whatever the database", () => {
    expect(previewGuardMessage({ SUPABASE_URL: PROD_URL })).toBeNull();
    expect(previewGuardMessage({})).toBeNull();
  });
});
