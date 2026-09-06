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

/* The fields the live layer reads. The site does not render them yet, but it
   is the build that refuses a file that has lost them: nothing downstream —
   the Worker's lookups, the death card — can be reproduced from a file whose
   ladder or cross cohort is missing, and a silently absent one would be
   discovered as a wrong figure rather than as a broken build. */
describe("the ladder, the cross cohort, and the first indexed time", () => {
  it("carries an ISO first-indexed timestamp beside the first indexed block", () => {
    expect(numberFile.firstIndexedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(numberFile.firstIndexedBlock).toBeGreaterThan(0);
  });

  it("accepts a file that has indexed nothing yet", () => {
    expect(numberSchema.safeParse(broken((f) => {
      f.firstIndexedAt = null;
    })).success).toBe(true);
  });

  it("refuses a first-indexed timestamp no clock can read", () => {
    expect(numberSchema.safeParse(broken((f) => {
      f.firstIndexedAt = "the first block";
    })).success).toBe(false);
  });

  it("carries a monotone ladder whose rungs each keep their raw count", () => {
    for (const w of [numberFile.h24, numberFile.allTime]) {
      expect(w.ttg.ladder.map((r) => r.atSeconds)).toEqual([
        30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600,
      ]);
      const counts = w.ttg.ladder.map((r) => r.cumulative);
      expect(counts).toEqual([...counts].sort((a, b) => a - b));
      expect(counts.at(-1)).toBeLessThanOrEqual(w.ttg.n);
    }
  });

  it("refuses a ladder rung that has lost its raw count", () => {
    expect(numberSchema.safeParse(broken((f) => {
      delete f.h24.ttg.ladder[0].cumulative;
    })).success).toBe(false);
  });

  it("refuses a ladder share on a ttg block that may not be printed", () => {
    expect(numberSchema.safeParse(broken((f) => {
      f.h24.ttg.insufficient = true;
    })).success).toBe(false);
  });

  it("carries 20 cross-cohort rows, pair-major, each with its own denominator", () => {
    for (const w of [numberFile.h24, numberFile.allTime]) {
      expect(w.cohorts.pairTax).toHaveLength(20);
      expect(w.cohorts.pairTax[0].bucket).toBe("eth/0%");
      expect(w.cohorts.pairTax.at(-1)!.bucket).toBe("other/6-10%");
      for (const row of w.cohorts.pairTax) {
        expect(row.bucket).toBe(`${row.pairClass}/${row.taxBucket}`);
        expect(typeof row.launches).toBe("number");
        if (row.insufficient) {
          expect(row.rate).toBeNull();
          expect(row.excludingFast.rate).toBeNull();
        }
      }
      const summed = w.cohorts.pairTax.reduce((a, r) => a + r.launches, 0);
      expect(summed + w.cohortsExcluded.pairTax).toBe(w.launches);
    }
  });

  it("refuses a cross-cohort row whose excluding-fast rate outlives its gate", () => {
    expect(numberSchema.safeParse(broken((f) => {
      f.h24.cohorts.pairTax[0].insufficient = true;
      f.h24.cohorts.pairTax[0].rate = null;
    })).success).toBe(false);
  });

  it("refuses a file whose cross cohort has lost its excluded count", () => {
    expect(numberSchema.safeParse(broken((f) => {
      delete f.h24.cohortsExcluded.pairTax;
    })).success).toBe(false);
  });
});
