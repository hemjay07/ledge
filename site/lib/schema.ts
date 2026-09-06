import { z } from "zod";
import { INSUFFICIENT_BELOW } from "./format";

/* The shape of data/number.json. A build fails here rather than shipping a
   figure whose denominator the pipeline forgot to write. */

const cohortRow = z.object({
  bucket: z.string(),
  launches: z.number().int().nonnegative(),
  graduations: z.number().int().nonnegative(),
  rate: z.number().nullable(),
  insufficient: z.boolean(),
});

/* The cross cohort's cell: a cohort row cut on two keys at once, carrying the
   key it was cut on and its own excluding-fast figure, gated on its own n. */
const pairTaxRow = cohortRow.extend({
  pairClass: z.string(),
  taxBucket: z.string(),
  excludingFast: z.object({
    cutoffSeconds: z.number().int().positive(),
    graduations: z.number().int().nonnegative(),
    rate: z.number().nullable(),
    oneIn: z.number().int().nullable(),
    insufficient: z.boolean(),
  }),
});

/* One rung of the time-to-graduation ladder. `cumulative` is the raw count,
   always present, so a reader can check the share against it; the share is
   null for every rung whenever the ttg block may not be printed. The live
   layer places a token by looking a rung up here — it never divides. */
const ladderRung = z.object({
  atSeconds: z.number().int().positive(),
  cumulative: z.number().int().nonnegative(),
  cumulativeShare: z.number().nullable(),
});

const histogramRow = z.object({
  bucket: z.string(),
  deployers: z.number().int().nonnegative(),
});

const windowShape = z.object({
  since: z.number().int().nullable(),
  until: z.number().int(),
  launches: z.number().int().nonnegative(),
  graduations: z.number().int().nonnegative(),
  rate: z.number().nullable(),
  insufficient: z.boolean(),
  lowerBound: z.boolean(),
  orphans: z.number().int().nonnegative(),
  excludingFast: z.object({
    cutoffSeconds: z.number().int().positive(),
    graduations: z.number().int().nonnegative(),
    rate: z.number().nullable(),
    oneIn: z.number().int().nullable(),
    insufficient: z.boolean(),
  }),
  /* Shares are nullable and carry their own insufficiency flag: an empty
     population, or one under n = 30, has no share to print. The flag is
     defaulted rather than required only so a file written before the pipeline
     began emitting it still parses; the invariants below hold either way. */
  fastShares: z.object({
    n: z.number().int().nonnegative(),
    under300Share: z.number().nullable(),
    under60Share: z.number().nullable(),
    insufficient: z.boolean(),
  }),
  ttg: z.object({
    n: z.number().int().nonnegative(),
    insufficient: z.boolean(),
    p10: z.number().int().nullable(),
    p25: z.number().int().nullable(),
    p50: z.number().int().nullable(),
    p75: z.number().int().nullable(),
    p90: z.number().int().nullable(),
    p95: z.number().int().nullable(),
    max: z.number().int().nullable(),
    ladder: z.array(ladderRung),
  }),
  cohorts: z.object({
    pair: z.array(cohortRow),
    tax: z.array(cohortRow),
    hour: z.array(cohortRow),
    day: z.array(cohortRow),
    pairTax: z.array(pairTaxRow),
  }),
  cohortsExcluded: z.object({
    pair: z.number().int().nonnegative(),
    tax: z.number().int().nonnegative(),
    hour: z.number().int().nonnegative(),
    day: z.number().int().nonnegative(),
    pairTax: z.number().int().nonnegative(),
  }),
  deployers: z.object({
    distinct: z.number().int().nonnegative(),
    launched2plusShare: z.number().nullable(),
    from10plusShare: z.number().nullable(),
    insufficient: z.boolean(),
    histogram: z.array(histogramRow),
  }),
});

type WindowShape = z.infer<typeof windowShape>;

/* The insufficiency invariant, asserted rather than assumed.

   The site refuses to print a percentage for an insufficient rate, but that is
   a rendering rule and a rendering rule can be routed around. These checks make
   the same statement about the data itself: a rate that is marked insufficient,
   or computed over fewer than 30 launches, must be null in the file. A pipeline
   regression that starts writing a number into one of those slots fails the
   build here instead of reaching a reader. */
function checkInsufficiency(w: WindowShape, ctx: z.RefinementCtx): void {
  const fail = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });

  if (w.insufficient && w.rate !== null) {
    fail(["rate"], "rate must be null when the window is marked insufficient");
  }
  if (w.excludingFast.insufficient && w.excludingFast.rate !== null) {
    fail(
      ["excludingFast", "rate"],
      "excludingFast.rate must be null when it is marked insufficient",
    );
  }

  for (const [name, rows] of Object.entries(w.cohorts)) {
    rows.forEach((row, i) => {
      if (row.insufficient && row.rate !== null) {
        fail(
          ["cohorts", name, i, "rate"],
          `cohort ${name}[${row.bucket}] is insufficient and must carry a null rate`,
        );
      }
      if (row.launches < INSUFFICIENT_BELOW && !row.insufficient) {
        fail(
          ["cohorts", name, i, "insufficient"],
          `cohort ${name}[${row.bucket}] holds n = ${row.launches} and must be marked insufficient`,
        );
      }
    });
  }

  for (const [i, row] of w.cohorts.pairTax.entries()) {
    if (row.bucket !== `${row.pairClass}/${row.taxBucket}`) {
      fail(
        ["cohorts", "pairTax", i, "bucket"],
        `cross-cohort row ${row.bucket} does not name the cell it was cut from`,
      );
    }
    if (row.insufficient && row.excludingFast.rate !== null) {
      fail(
        ["cohorts", "pairTax", i, "excludingFast", "rate"],
        `cross-cohort row ${row.bucket} is insufficient and must carry a null excludingFast.rate`,
      );
    }
  }

  /* A ladder share is a published proportion and lives under the same gate as
     every other one: below n = 30 the ttg block prints nothing at all, so no
     rung may carry a share. */
  if (w.ttg.insufficient || w.ttg.n < INSUFFICIENT_BELOW) {
    w.ttg.ladder.forEach((rung, i) => {
      if (rung.cumulativeShare !== null) {
        fail(
          ["ttg", "ladder", i, "cumulativeShare"],
          `the ladder holds n = ${w.ttg.n} and rung ${rung.atSeconds} must carry a null share`,
        );
      }
    });
  }

  const sharesGone = w.fastShares.insufficient || w.fastShares.n < INSUFFICIENT_BELOW;
  if (sharesGone && (w.fastShares.under300Share !== null || w.fastShares.under60Share !== null)) {
    fail(
      ["fastShares"],
      `fastShares holds n = ${w.fastShares.n} and must carry null shares`,
    );
  }

  const dep = w.deployers;
  if ((dep.insufficient || dep.distinct < INSUFFICIENT_BELOW) && dep.launched2plusShare !== null) {
    fail(
      ["deployers", "launched2plusShare"],
      `deployers holds ${dep.distinct} distinct and must carry a null launched2plusShare`,
    );
  }
  if ((dep.insufficient || w.launches < INSUFFICIENT_BELOW) && dep.from10plusShare !== null) {
    fail(
      ["deployers", "from10plusShare"],
      `the window holds n = ${w.launches} and must carry a null from10plusShare`,
    );
  }
}

const windowSchema = windowShape.superRefine(checkInsufficiency);

export const numberSchema = z.object({
  schemaVersion: z.literal(2),
  definitionsVersion: z.string(),
  chainId: z.number().int(),
  factory: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  firstIndexedBlock: z.number().int(),
  /* The earliest launch timestamp in the record, beside the block that holds
     it, so a consumer can state coverage in hours without converting blocks to
     time. Null when nothing is indexed yet. */
  firstIndexedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    .refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "firstIndexedAt must be a timestamp a clock can read",
    })
    .nullable(),
  headBlock: z.number().int(),
  crawledAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    .refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "crawledAt must be a timestamp a clock can read",
    }),
  stale: z.boolean(),
  staleAfterSeconds: z.number().int().positive(),
  h24: windowSchema,
  allTime: windowSchema,
});

export type NumberFile = z.infer<typeof numberSchema>;
export type WindowData = WindowShape;
export type CohortRow = z.infer<typeof cohortRow>;
export type PairTaxRow = z.infer<typeof pairTaxRow>;
export type LadderRung = z.infer<typeof ladderRung>;
export type HistogramRow = z.infer<typeof histogramRow>;
