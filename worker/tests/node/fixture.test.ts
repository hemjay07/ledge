import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureNumber, REPO_ROOT } from "./helpers";

/* Two frozen files exist: worker/tests/fixtures/number.json, which the
   Worker's own suite reads, and tests/vectors/fixture-number.json, which the
   pipeline cut the vectors from. They hold different values on purpose -- one
   suite would otherwise be asserting the other's arithmetic -- but they must
   hold the same SHAPE, or a schema change in the pipeline passes here while
   breaking in production. */

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
