import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureNumber, REPO_ROOT } from "./helpers";

/* Two frozen files exist: worker/tests/fixtures/number.json, which the
   Worker's own suite reads, and tests/vectors/fixture-number.json, which the
   pipeline cut the vectors from. Both are computed by pipeline/stats.py over
   the same 20-hour capture and differ only where this suite needs coverage
   the vectors do not (a populated stable cohort, a cell of exactly 29), but
   they must hold the same SHAPE, or a schema change in the pipeline passes
   here while breaking in production.

   And the Worker's fixture must satisfy METHOD's ladder invariant. It once
   did not: 72 of 107 graduations inside 300 s on the ladder against 0.71028 --
   76 of the same 107 -- in fastShares, a disagreement METHOD says is
   impossible because the 300 s rung IS the share inside five minutes. Tests
   read that fixture as if it were a measurement, so an impossible fixture is
   an impossible assertion. It is now regenerated through pipeline/recompute.py
   by worker/scripts/make-number-fixture.py, and these invariants are what
   would catch a hand edit that put it back. */

function keyShape(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return depth > 3 ? "[]" : [keyShape(value[0], depth + 1)];
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = depth > 3 ? "…" : keyShape((value as Record<string, unknown>)[key], depth + 1);
    }
    return out;
  }
  return typeof value;
}

const PIPELINE_FIXTURE = join(REPO_ROOT, "tests", "vectors", "fixture-number.json");

describe("the two frozen fixtures", () => {
  it.skipIf(!existsSync(PIPELINE_FIXTURE))(
    "agree on the shape of a window, so a pipeline schema change fails here too",
    () => {
      const pipeline = JSON.parse(readFileSync(PIPELINE_FIXTURE, "utf8"));
      const worker = fixtureNumber();
      expect(keyShape(worker.allTime.ttg)).toEqual(keyShape(pipeline.allTime.ttg));
      expect(keyShape(worker.allTime.cohorts.pairTax?.[0])).toEqual(
        keyShape(pipeline.allTime.cohorts.pairTax[0]),
      );
    },
  );

  it("carries the ladder and the cross cohort the live layer reads", () => {
    const file = fixtureNumber();
    expect(file.allTime.ttg.ladder?.length).toBeGreaterThan(0);
    expect(file.allTime.cohorts.pairTax).toHaveLength(20);
  });

  it("is frozen, and says so", () => {
    const raw = readFileSync(join(REPO_ROOT, "worker", "tests", "fixtures", "number.json"), "utf8");
    expect(raw).toContain("Never live data");
  });
});

/* B5 — METHOD's ladder invariant, asserted on the frozen fixture itself.

   METHOD.md ("The ladder"): "The counts only rise as the marks rise", and
   "the rung at 300 s is the share that graduated inside 5 minutes and the
   rung at 60 s is the share inside 60 seconds -- the ladder and those two
   figures cannot disagree." A fixture that breaks either is not a
   measurement any crawl could have produced. */
describe("the ladder invariant METHOD binds", () => {
  const file = fixtureNumber();
  const windows: Array<[string, ReturnType<typeof fixtureNumber>["allTime"]]> = [
    ["h24", file.h24],
    ["allTime", file.allTime],
  ];

  for (const [name, window] of windows) {
    const ladder = window.ttg.ladder ?? [];
    const shares = window.fastShares;

    it(`${name}: the marks rise and the counts rise with them`, () => {
      expect(ladder.length).toBeGreaterThan(0);
      for (let i = 1; i < ladder.length; i++) {
        expect(ladder[i]!.atSeconds).toBeGreaterThan(ladder[i - 1]!.atSeconds);
        expect(ladder[i]!.cumulative).toBeGreaterThanOrEqual(ladder[i - 1]!.cumulative);
      }
    });

    it(`${name}: no rung counts more graduations than the window measured`, () => {
      for (const rung of ladder) expect(rung.cumulative).toBeLessThanOrEqual(window.ttg.n);
    });

    it(`${name}: the 300 s rung is the share that graduated inside five minutes`, () => {
      const rung = ladder.find((s) => s.atSeconds === 300)!;
      expect(rung).toBeDefined();
      expect(shares).toBeDefined();
      expect(rung.cumulativeShare).toBe(shares!.under300Share);
      expect(rung.cumulative).toBe(Math.round(shares!.under300Share! * window.ttg.n));
    });

    it(`${name}: the 60 s rung is the share that graduated inside sixty seconds`, () => {
      const rung = ladder.find((s) => s.atSeconds === 60)!;
      expect(rung.cumulativeShare).toBe(shares!.under60Share);
      expect(rung.cumulative).toBe(Math.round(shares!.under60Share! * window.ttg.n));
    });
  }
});
