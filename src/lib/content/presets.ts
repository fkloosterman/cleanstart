/**
 * Pure preset selection (WP3.2 fix, design §3.6). Extracted from the server
 * function so the tenure-targeting rule is unit-tested without a database.
 */

export type PresetTenure = "owner" | "renter";

/**
 * Which presets a starter screen shows, given the user's tenure.
 *
 * Tenure-**exclusive** so the screen stays a focused handful, not a scroll:
 *   - a known tenure sees only presets targeted to it (`tenures` includes it);
 *   - "not sure yet" (tenure `null`) sees the general set — presets with no
 *     tenure targeting (`tenures` empty), which act as the unknown-tenure
 *     fallback rather than showing to everyone.
 */
export function filterPresetsByTenure<T extends { tenures: string[] }>(
  rows: T[],
  tenure: PresetTenure | null,
): T[] {
  return rows.filter((r) => {
    const tenures = r.tenures ?? [];
    if (tenure === null) return tenures.length === 0;
    return tenures.includes(tenure);
  });
}
