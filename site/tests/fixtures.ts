import raw from "./fixture-number.json";
import { numberSchema, type NumberFile } from "../lib/schema";

/* An insufficient measurement, built from the committed one so it stays the
   same shape: a window whose sample is under 30, whose every rate is null and
   whose every share is gone. Nothing in it may be printed as a percentage, so
   any "%" that survives a render of this fixture is a defect. */
export function insufficientRaw(): Record<string, unknown> {
  const file = structuredClone(raw) as Record<string, any>;

  for (const key of ["h24", "allTime"]) {
    const w = file[key];
    w.launches = 12;
    w.graduations = 0;
    w.rate = null;
    w.insufficient = true;
    w.orphans = 0;

    w.excludingFast = {
      cutoffSeconds: w.excludingFast.cutoffSeconds,
      graduations: 0,
      rate: null,
      oneIn: null,
      insufficient: true,
    };

    w.fastShares = { n: 0, under300Share: null, under60Share: null, insufficient: true };

    w.ttg = {
      n: 0,
      insufficient: true,
      p10: null, p25: null, p50: null, p75: null, p90: null, p95: null, max: null,
      /* The ladder survives an insufficient window: it still says what was
         observed at each rung. Only the shares are gone. */
      ladder: w.ttg.ladder.map((rung: { atSeconds: number }) => ({
        atSeconds: rung.atSeconds,
        cumulative: 0,
        cumulativeShare: null,
      })),
    };

    for (const name of Object.keys(w.cohorts)) {
      w.cohorts[name] = w.cohorts[name].map((row: Record<string, any>, i: number) => ({
        ...row,
        launches: i === 0 ? 12 : 0,
        graduations: 0,
        rate: null,
        insufficient: true,
        ...(row.excludingFast
          ? {
              excludingFast: {
                cutoffSeconds: row.excludingFast.cutoffSeconds,
                graduations: 0,
                rate: null,
                oneIn: null,
                insufficient: true,
              },
            }
          : {}),
      }));
      w.cohortsExcluded[name] = 0;
    }

    w.deployers = {
      distinct: 0,
      launched2plusShare: null,
      from10plusShare: null,
      insufficient: true,
      histogram: [{ bucket: "1", deployers: 0 }],
    };
  }

  return file;
}

/** The same fixture, parsed: proof that an entirely insufficient measurement
    is a legal file, and a typed window the render helpers can be run against. */
export function insufficientFile(): NumberFile {
  return numberSchema.parse(insufficientRaw());
}

// Frozen snapshot of data/number.json (schemaVersion 2). Tests assert
// against this, never the live file, so a crawl cannot change a test.
export const numberFile: NumberFile = numberSchema.parse(raw);
export const h24 = numberFile.h24;
export { raw };
