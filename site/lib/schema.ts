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
  }),
  cohorts: z.object({
    pair: z.array(cohortRow),
    tax: z.array(cohortRow),
    hour: z.array(cohortRow),
    day: z.array(cohortRow),
  }),
  cohortsExcluded: z.object({
    pair: z.number().int().nonnegative(),
    tax: z.number().int().nonnegative(),
    hour: z.number().int().nonnegative(),
    day: z.number().int().nonnegative(),
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
export type HistogramRow = z.infer<typeof histogramRow>;
