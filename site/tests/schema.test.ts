import { describe, expect, it } from "vitest";
import { numberSchema } from "../lib/schema";
import { h24 as liveH24, numberFile as liveFile } from "../lib/number";
import { insufficientRaw, h24, numberFile, raw } from "./fixtures";

type Mutable = Record<string, any>;

function broken(mutate: (file: Mutable) => void): Mutable {
  const file = structuredClone(raw) as Mutable;
  mutate(file);
  return file;
}

describe("number.json schema", () => {
  it("the live data file parses (the build imports it and throws otherwise)", () => {
    expect(liveFile.schemaVersion).toBe(2);
    expect(liveH24.launches).toBeGreaterThanOrEqual(0);
  });

  it("validates the committed measurement", () => {
    expect(numberSchema.safeParse(raw).success).toBe(true);
  });

  it("rejects a cohort row that has lost its denominator", () => {
    const broken = structuredClone(raw) as Record<string, unknown>;
    const window = (broken.h24 as { cohorts: { pair: { launches?: number }[] } }).cohorts.pair;
    delete window[0].launches;
    expect(numberSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an unknown schema version", () => {
    const broken = { ...(structuredClone(raw) as object), schemaVersion: 99 };
    expect(numberSchema.safeParse(broken).success).toBe(false);
  });

  it("carries a window, a sample size and a measurement time on every figure", () => {
    expect(numberFile.crawledAt).toMatch(/Z$/);
    expect(numberFile.staleAfterSeconds).toBeGreaterThan(0);
    expect(h24.launches).toBeGreaterThanOrEqual(0);
    for (const row of h24.cohorts.pair) {
      expect(typeof row.launches).toBe("number");
      if (row.insufficient) expect(row.rate).toBeNull();
    }
  });

  it("keeps every cohort's buckets inside the window's population", () => {
    const summed = h24.cohorts.pair.reduce((a, r) => a + r.launches, 0);
    expect(summed + h24.cohortsExcluded.pair).toBe(h24.launches);
  });
});

/* The insufficiency invariant belongs to the data, not only to the renderer.
   A rendering rule can be routed around; a schema that refuses the file
   cannot. These are the pipeline regressions that must fail the build. */
describe("a rate that may not be printed is null in the file", () => {
  it("accepts a measurement in which nothing may be printed at all", () => {
    const parsed = numberSchema.safeParse(insufficientRaw());
    expect(parsed.success).toBe(true);
  });

  it("refuses a window marked insufficient that still carries a rate", () => {
    expect(numberSchema.safeParse(broken((f) => {
      f.h24.insufficient = true;
    })).success).toBe(false);
  });

  it("refuses an excluding-fast figure marked insufficient that carries a rate", () => {
    expect(numberSchema.safeParse(broken((f) => {
      f.h24.excludingFast.insufficient = true;
    })).success).toBe(false);
  });

  it("refuses a cohort row under n = 30 that was not marked insufficient", () => {
    expect(numberSchema.safeParse(broken((f) => {
      f.h24.cohorts.pair[3] = { bucket: "other", launches: 12, graduations: 0, rate: null, insufficient: false };
    })).success).toBe(false);
  });

  it("refuses a cohort row marked insufficient that still carries a rate", () => {
    expect(numberSchema.safeParse(broken((f) => {
      f.h24.cohorts.pair[3] = { bucket: "other", launches: 12, graduations: 0, rate: 0.5, insufficient: true };
    })).success).toBe(false);
  });

  it("refuses fast shares computed over fewer than 30 graduations", () => {
    expect(numberSchema.safeParse(broken((f) => {
      f.h24.fastShares.n = 12;
    })).success).toBe(false);
  });

  it("refuses deployer shares over an empty population", () => {
    expect(numberSchema.safeParse(broken((f) => {
      f.h24.deployers.distinct = 0;
    })).success).toBe(false);
  });

  it("refuses a crawledAt no clock can read", () => {
    expect(numberSchema.safeParse(broken((f) => {
      f.crawledAt = "2026-13-45T99:99:99Z";
    })).success).toBe(false);
  });
});
