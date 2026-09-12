import { z } from "zod";
import { INSUFFICIENT_BELOW } from "./format";

/* The shape of data/number.json. A build fails here rather than shipping a
   figure whose denominator the pipeline forgot to write. */

const excludingFastBlock = z.object({
  cutoffSeconds: z.number().int().positive(),
  graduations: z.number().int().nonnegative(),
  rate: z.number().nullable(),
  oneIn: z.number().int().nullable(),
  insufficient: z.boolean(),
});

/* Every cohort row carries BOTH rates, and the block is required rather than
   optional: the page leads with the excluding-fast figure, so a row able to
   render without one would invite the cross-cohort comparison to be made on
   the raw number the headline calls contaminated. */
const cohortRow = z.object({
  bucket: z.string(),
  launches: z.number().int().nonnegative(),
  graduations: z.number().int().nonnegative(),
  rate: z.number().nullable(),
  insufficient: z.boolean(),
  excludingFast: excludingFastBlock,
});

/* The cross cohort's cell: a cohort row cut on two keys at once, carrying the
   key it was cut on. */
const pairTaxRow = cohortRow.extend({
  pairClass: z.string(),
  taxBucket: z.string(),
});

/* One rung of the time-to-graduation ladder. `cumulative` is the raw count,
   always present, so a reader can check the share against it; the share is
   null for every rung whenever the ttg block may not be printed. The live
   layer places a token by looking a rung up here — it never divides. */
/* One doubling bucket of the time-to-graduation histogram. Half-open
   [fromSeconds, toSeconds); the last bucket carries a null `toSeconds` and
   holds the tail, so the counts sum to n and no graduation falls outside the
   table. The raw count is always present so a reader can check the share;
   the share is null for every bucket whenever the sample cannot support one.
   It describes how long graduations took and labels nothing. */
const ttgHistogramBucket = z.object({
  fromSeconds: z.number().int().nonnegative(),
  toSeconds: z.number().int().positive().nullable(),
  graduations: z.number().int().nonnegative(),
  share: z.number().nullable(),
});

const ladderRung = z.object({
  atSeconds: z.number().int().positive(),
  cumulative: z.number().int().nonnegative(),
  cumulativeShare: z.number().nullable(),
});

/* A dated sample: a reading taken once, by hand, with its own n and its own
   measurement date. It is not a window and it is not recomputed by the crawl —
   `recompute.py` carries every file in `data/samples/` through verbatim.

   Only `sampled` is optional, and the refinement below is why: a sample may
   report a bare count with no share, but a share is a rate and a rate does not
   exist without the denominator it was taken over (CONSTRAINTS.md 3). The same
   discipline the window blocks are held to, applied to a figure that arrives
   from outside the pipeline. */
const sampleShape = z.object({
  measuredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "measuredAt is the day the sample was read, as YYYY-MM-DD",
  }),
  sampled: z.number().int().nonnegative().optional(),
  count: z.number().int().nonnegative(),
  share: z.number().nullable().optional(),
  method: z.string().min(1),
});

const sampleSchema = sampleShape.superRefine((s, ctx) => {
  if (s.share !== null && s.share !== undefined && s.sampled === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["sampled"],
      message: "a share cannot exist without the sampled count it was taken over",
    });
  }
  if (s.sampled !== undefined && s.count > s.sampled) {
    ctx.addIssue({
      code: "custom",
      path: ["count"],
      message: `a sample counted ${s.count} out of ${s.sampled}, which is more than it sampled`,
    });
  }
});

const histogramRow = z.object({
  bucket: z.string(),
  deployers: z.number().int().nonnegative(),
});

/* OUTCOMES.md step 3 / OUTCOMES-STATS-BRIEF.md. One row per mark after a
   graduation: n gates insufficiency the same way every other rate in this
   file does, and below it every quantile and the noTrade share are null,
   never a computed value. n, noTrade and the raw counts stay in the file
   regardless -- only the derived figures disappear. */
const outcomeMarkRow = z.object({
  n: z.number().int().nonnegative(),
  noTrade: z.number().int().nonnegative(),
  noTradeShare: z.number().nullable(),
  median: z.number().nullable(),
  p25: z.number().nullable(),
  p75: z.number().nullable(),
  insufficient: z.boolean(),
  /* OUTCOMES-BACKFILL-BRIEF.md step 4: how many of this mark's readings
     came from a backfill probe (data/pools/backfill.jsonl) rather than a
     real hour bar. Optional so a number.json written before this field
     landed still parses. */
  fromProbe: z.number().int().nonnegative().optional(),
});

const outcomeCohortRow = z.object({
  bucket: z.string(),
  graduations: z.number().int().nonnegative(),
  withoutPrice: z.number().int().nonnegative(),
  marks: z.object({
    "1h": outcomeMarkRow,
    "24h": outcomeMarkRow,
    "7d": outcomeMarkRow,
  }),
});

/* Optional: a number.json written before this step still validates. Not a
   window like h24/allTime -- every graduation that has a pons pool, joined
   by token, regardless of when its launch fell. */
const outcomesSchema = z.object({
  matched: z.number().int().nonnegative(),
  cohorts: z.object({
    ttg: z.array(outcomeCohortRow),
    pair: z.array(outcomeCohortRow),
    tax: z.array(outcomeCohortRow),
  }),
  cohortsExcluded: z.object({
    ttg: z.number().int().nonnegative(),
    pair: z.number().int().nonnegative(),
    tax: z.number().int().nonnegative(),
  }),
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
    /* Defaulted, not required, for the same reason the Worker's copy is
       optional: a number.json written before this block landed does not carry
       it, and such a file is still a legal file rather than a broken one. The
       LIVE file's histogram is asserted present and summing to n by
       tests/shape.test.tsx, so a pipeline that quietly stopped emitting it
       still fails a test -- the tolerance is for old files, not for
       regressions. */
    histogram: z.array(ttgHistogramBucket).default([]),
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
  /* Optional, and absent means {}: a number.json written before samples
     existed is still a legal file, and a consumer that finds nothing here
     prints nothing rather than inventing a figure. */
  samples: z.record(z.string(), sampleSchema).optional(),
  h24: windowSchema,
  allTime: windowSchema,
  /* Optional for the same reason `samples` is: a number.json written before
     OUTCOMES.md step 3 landed still parses. Not rendered anywhere yet. */
  outcomes: outcomesSchema.optional(),
});

export type NumberFile = z.infer<typeof numberSchema>;
export type WindowData = WindowShape;
export type CohortRow = z.infer<typeof cohortRow>;
export type PairTaxRow = z.infer<typeof pairTaxRow>;
export type LadderRung = z.infer<typeof ladderRung>;
export type HistogramRow = z.infer<typeof histogramRow>;
export type TtgHistogramBucket = z.infer<typeof ttgHistogramBucket>;
export type Sample = z.infer<typeof sampleShape>;
export type OutcomeMarkRow = z.infer<typeof outcomeMarkRow>;
export type OutcomeCohortRow = z.infer<typeof outcomeCohortRow>;
export type Outcomes = z.infer<typeof outcomesSchema>;
