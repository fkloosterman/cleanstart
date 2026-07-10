import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { guestMessagesFromUI } from "@/lib/guest-migration";
import { emptyProfile, normalizeProfile } from "@/lib/profile/normalize";
import { applyPatches, type ProfilePatch } from "@/lib/profile/patches";
import type { SessionProfile } from "@/lib/profile/registry";

function ui(role: UIMessage["role"], text: string): UIMessage {
  return { id: `${role}-${text}`, role, parts: [{ type: "text", text }] };
}

describe("guestMessagesFromUI", () => {
  it("keeps user/assistant turns, joins text parts, drops empties and other roles", () => {
    const messages: UIMessage[] = [
      ui("user", "Is solar worth it?"),
      ui("assistant", "For a homeowner in Boston, yes."),
      ui("system", "hidden"),
      { id: "empty", role: "assistant", parts: [{ type: "text", text: "   " }] },
      {
        id: "multi",
        role: "user",
        parts: [
          { type: "text", text: "part one " },
          { type: "step-start" } as UIMessage["parts"][number],
          { type: "text", text: "part two" },
        ],
      },
    ];
    expect(guestMessagesFromUI(messages)).toEqual([
      { role: "user", content: "Is solar worth it?" },
      { role: "assistant", content: "For a homeowner in Boston, yes." },
      { role: "user", content: "part one part two" },
    ]);
  });

  it("returns [] for an empty transcript", () => {
    expect(guestMessagesFromUI([])).toEqual([]);
  });
});

// The drift guard (§9, WP1.9): guest state lives in localStorage in exactly
// the shape the DB row holds, so both storage paths must read back to the same
// profile. Guest persists `JSON.stringify(profile)`; the DB stores the same
// object as JSONB (`profile as unknown as Json`). Both are read through
// normalizeProfile. If the profile ever gained a shape that survives one path
// but not the other, this fails.
describe("profile shared-shape drift guard", () => {
  function representativeProfile(): SessionProfile {
    const patches: ProfilePatch[] = [
      { op: "set", slot: "tenure", value: "owner", provenance: "stated" },
      {
        op: "set",
        slot: "region",
        value: { state: "MA", city: "Boston", zip: "02118" },
        provenance: "stated",
      },
      {
        op: "set",
        slot: "motivation_weights",
        value: { cost: 0.8, carbon: 0.2, comfort: 0.5, resilience: 0, learning: 0 },
        provenance: "inferred",
      },
      { op: "append", slot: "goals", value: { text: "Cut winter bills" }, provenance: "stated" },
      {
        op: "append",
        slot: "preferences",
        value: {
          entity: "financing:loan",
          stance: "ruled_out",
          note: "no debt",
          provenance: "edited",
        },
        provenance: "edited",
      },
    ];
    return applyPatches(emptyProfile(), patches).profile;
  }

  it("localStorage and DB JSON round-trips normalize identically", () => {
    const profile = representativeProfile();

    // Guest path: JSON.stringify → JSON.parse → normalize.
    const guest = normalizeProfile(JSON.parse(JSON.stringify(profile)));
    // DB path: the same object serialized as JSONB and read back is a
    // structural clone; model it the same way.
    const db = normalizeProfile(structuredClone(profile) as unknown);

    expect(guest).toEqual(db);
    // And both equal the in-memory profile normalized — no information lost.
    expect(guest).toEqual(normalizeProfile(profile));
  });

  it("an edited slot keeps its provenance across the round-trip (edited-wins is durable)", () => {
    const profile = representativeProfile();
    const restored = normalizeProfile(JSON.parse(JSON.stringify(profile)));
    const loan = (restored.preferences.value ?? []).find(
      (p) => (p as { entity: string }).entity === "financing:loan",
    ) as { provenance: string } | undefined;
    expect(loan?.provenance).toBe("edited");
  });
});
