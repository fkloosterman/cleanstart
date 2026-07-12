import { describe, expect, it } from "vitest";
import {
  DEFAULT_GUEST_RATE_LIMITS,
  dayWindowStart,
  isOverLimit,
  parseLimit,
  readGuestRateLimits,
} from "@/lib/rate-limit";

describe("parseLimit", () => {
  it("returns the fallback when the value is unset", () => {
    expect(parseLimit(undefined, 40)).toBe(40);
  });

  it("parses a valid positive integer", () => {
    expect(parseLimit("12", 40)).toBe(12);
    expect(parseLimit("  7 ", 40)).toBe(7);
  });

  it("falls back on non-numeric, zero, negative, or fractional input", () => {
    // A misconfigured var must never disable a cap or set a nonsense value.
    expect(parseLimit("abc", 40)).toBe(40);
    expect(parseLimit("0", 40)).toBe(40);
    expect(parseLimit("-5", 40)).toBe(40);
    expect(parseLimit("3.5", 40)).toBe(40);
    expect(parseLimit("", 40)).toBe(40);
  });
});

describe("readGuestRateLimits", () => {
  it("uses D7 defaults when nothing is set", () => {
    expect(readGuestRateLimits({})).toEqual(DEFAULT_GUEST_RATE_LIMITS);
    expect(DEFAULT_GUEST_RATE_LIMITS).toEqual({
      messagesPerDay: 40,
      turnsPerSession: 30,
      reportsPerDay: 3,
    });
  });

  it("overrides each cap from its env var independently", () => {
    expect(
      readGuestRateLimits({
        GUEST_MESSAGES_PER_DAY: "100",
        GUEST_TURNS_PER_SESSION: "50",
        GUEST_REPORTS_PER_DAY: "10",
      }),
    ).toEqual({ messagesPerDay: 100, turnsPerSession: 50, reportsPerDay: 10 });
  });

  it("keeps the default for a var that is set but invalid", () => {
    expect(readGuestRateLimits({ GUEST_REPORTS_PER_DAY: "lots" }).reportsPerDay).toBe(3);
  });
});

describe("dayWindowStart", () => {
  it("truncates to UTC midnight so a whole UTC day shares one key", () => {
    const morning = new Date("2026-07-12T06:15:00.000Z");
    const evening = new Date("2026-07-12T23:59:59.000Z");
    expect(dayWindowStart(morning)).toBe("2026-07-12T00:00:00.000Z");
    expect(dayWindowStart(morning)).toBe(dayWindowStart(evening));
  });

  it("gives adjacent UTC days different keys", () => {
    expect(dayWindowStart(new Date("2026-07-12T23:59:59.000Z"))).not.toBe(
      dayWindowStart(new Date("2026-07-13T00:00:01.000Z")),
    );
  });
});

describe("isOverLimit", () => {
  it("allows up to and including the limit, blocks the next request", () => {
    // count is the post-increment total, so limit 40 allows the 40th (count 40)
    // and blocks the 41st (count 41).
    expect(isOverLimit(40, 40)).toBe(false);
    expect(isOverLimit(41, 40)).toBe(true);
    expect(isOverLimit(1, 40)).toBe(false);
  });
});
