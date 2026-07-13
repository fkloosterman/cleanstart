import { describe, expect, it } from "vitest";
import { applyPatches } from "@/lib/profile/patches";
import { emptyProfile, slotValue } from "@/lib/profile/normalize";
import {
  PROFILE_PATCH_DATA_NAME,
  PROFILE_PATCH_PART_TYPE,
  readProfilePatchData,
  type ProfilePatchData,
} from "@/lib/profile/stream";

describe("profile-patch wire format", () => {
  it("derives the part type from the data name (server/client agree)", () => {
    expect(PROFILE_PATCH_PART_TYPE).toBe(`data-${PROFILE_PATCH_DATA_NAME}`);
  });
});

describe("readProfilePatchData — tolerant reader", () => {
  it("returns the patches array from a well-formed payload", () => {
    const payload: ProfilePatchData = {
      patches: [{ op: "set", slot: "tenure", value: "owner", provenance: "stated" }],
    };
    expect(readProfilePatchData(payload)).toEqual(payload.patches);
  });

  it("yields [] for foreign or malformed payloads instead of throwing", () => {
    expect(readProfilePatchData(null)).toEqual([]);
    expect(readProfilePatchData(undefined)).toEqual([]);
    expect(readProfilePatchData("nope")).toEqual([]);
    expect(readProfilePatchData(42)).toEqual([]);
    expect(readProfilePatchData({})).toEqual([]);
    expect(readProfilePatchData({ patches: "not-an-array" })).toEqual([]);
    expect(readProfilePatchData([])).toEqual([]);
  });

  it("hands raw (still-untrusted) patches straight to applyPatches", () => {
    // A payload mixing a valid patch with junk — the reader passes both
    // through; applyPatches is the gate that keeps only the valid one.
    const data = {
      patches: [
        { op: "set", slot: "tenure", value: "renter", provenance: "stated" },
        { op: "set", slot: "not_a_slot", value: 1, provenance: "stated" },
        "garbage",
      ],
    };
    const raw = readProfilePatchData(data);
    const { profile, rejected } = applyPatches(emptyProfile(), raw);
    expect(slotValue(profile, "tenure")).toBe("renter");
    expect(rejected.length).toBe(2);
  });
});
