import { describe, expect, it } from "vitest";
import { tokenResponseSchema, errorResponseSchema } from "../../src/schema";
import { lookupText } from "../../src/text";
import { ACTIVITY, makeBody, fixtureNumber } from "./helpers";

/* Gate 4. The same Zod discipline as site/lib/schema.ts: a Class A object
   without its denominator, its window and the moment it was computed does not
   parse, and the Worker 500s rather than shipping it. */

function response() {
  const body = makeBody();
  return { ...body, text: lookupText(body, fixtureNumber().allTime.ttg.max) };
}

describe("the response contract", () => {
  it("accepts a complete lookup", () => {
    expect(tokenResponseSchema.safeParse(response()).success).toBe(true);
  });

  it("refuses a Class A object with no launches", () => {
    const r = response() as Record<string, any>;
    delete r["cohort"].allTime.launches;
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("refuses a Class A object with no window", () => {
    const r = response() as Record<string, any>;
    delete r["cohort"].allTime.window;
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("refuses a Class A object with no crawledAt", () => {
    const r = response() as Record<string, any>;
    delete r["cohort"].allTime.crawledAt;
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("refuses a rate that is not null while the row is insufficient", () => {
    const r = response() as Record<string, any>;
    r["cohort"].allTime.insufficient = true;
    r["cohort"].allTime.rate = 0.0123;
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("refuses a row under n = 30 that is not marked insufficient", () => {
    const r = response() as Record<string, any>;
    r["cohort"].allTime.launches = 29;
    r["cohort"].allTime.insufficient = false;
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("refuses an excludingFast oneIn beside an insufficient rate", () => {
    const r = response() as Record<string, any>;
    r["cohort"].allTime.excludingFast.insufficient = true;
    r["cohort"].allTime.excludingFast.rate = null;
    r["cohort"].allTime.excludingFast.oneIn = 184;
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("refuses a placement that carries a share while insufficient", () => {
    const r = response() as Record<string, any>;
    r["placement"].insufficient = true;
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("refuses an absent fill that does not say why", () => {
    const r = response() as Record<string, any>;
    r["state"].fillNote = null;
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("refuses an unindexed launch that still reports an elapsed time", () => {
    const r = response() as Record<string, any>;
    r["state"].indexed = false;
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("holds the documented error codes and nothing else", () => {
    for (const error of ["not_a_pons_token", "not_indexed", "rpc_down", "bad_address", "number_unavailable"]) {
      expect(
        errorResponseSchema.safeParse({ schemaVersion: 1, error, message: "x" }).success,
        error,
      ).toBe(true);
    }
    expect(
      errorResponseSchema.safeParse({ schemaVersion: 1, error: "token_is_unsafe", message: "x" }).success,
    ).toBe(false);
  });
});

/* Phase A. The activity block is Class B: counts of events about one token,
   with no denominator because there is no population. The one rule the shape
   itself enforces is that a count cannot reach a reader without the range of
   blocks it was counted over -- the same posture as a rate without its n. */
describe("the activity block", () => {
  function withActivity() {
    const body = makeBody({ activity: ACTIVITY });
    return { ...body, text: lookupText(body, fixtureNumber().allTime.ttg.max) };
  }

  it("accepts a lookup that carries counts and their window", () => {
    const parsed = tokenResponseSchema.safeParse(withActivity());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("refuses counts with no window at all", () => {
    const r = withActivity() as Record<string, any>;
    delete r["activity"].window;
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("refuses a window whose label does not name the blocks it covers", () => {
    const r = withActivity() as Record<string, any>;
    r["activity"].window.label = "recent activity";
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("refuses a window that ends before it begins", () => {
    const r = withActivity() as Record<string, any>;
    r["activity"].window.toBlock = r["activity"].window.fromBlock - 1;
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("refuses a first-block buyer count that does not say which block", () => {
    const r = withActivity() as Record<string, any>;
    delete r["activity"].firstBlock.block;
    expect(tokenResponseSchema.safeParse(r).success).toBe(false);
  });

  it("accepts a lookup with no activity row at all", () => {
    const body = makeBody({ activity: null });
    const parsed = tokenResponseSchema.safeParse({
      ...body,
      text: lookupText(body, fixtureNumber().allTime.ttg.max),
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(body.activity).toBeNull();
  });
});
