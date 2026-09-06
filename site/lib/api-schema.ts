/* A COPY of worker/src/schema.ts. Do not edit by hand.
   ============================================================================
   The site is a static export: it cannot import across the repo boundary into
   worker/ without dragging the Worker's own zod copy and its tsconfig into the
   build, so the response contract is mirrored here instead of imported.

   The copy is not trusted to stay a copy. tests/api-schema-parity.test.ts
   diffs the field names and the error codes of the two files and fails when
   they drift, which is the only thing that keeps "the site renders the API's
   shape" true after either side moves.

   Everything below this banner is worker/src/schema.ts verbatim, minus its
   own header comment.
   ========================================================================= */

import { z } from "zod";

export const SCHEMA_VERSION = 1;
const INSUFFICIENT_BELOW = 30;

const windowName = z.enum(["24h", "allTime"]);

const excludingFast = z.object({
  cutoffSeconds: z.number().int().positive(),
  graduations: z.number().int().nonnegative(),
  rate: z.number().nullable(),
  oneIn: z.number().int().nullable(),
  insufficient: z.boolean(),
});

/* ---- Class A: statistics, read verbatim from number.json ---------------- */

const cohortWindowShape = z.object({
  window: windowName,
  crawledAt: z.string(),
  launches: z.number().int().nonnegative(),
  graduations: z.number().int().nonnegative(),
  rate: z.number().nullable(),
  insufficient: z.boolean(),
  excludingFast,
});

const cohortWindow = cohortWindowShape.superRefine((w, ctx) => {
  if (w.insufficient && w.rate !== null) {
    ctx.addIssue({ code: "custom", path: ["rate"], message: "rate must be null when insufficient" });
  }
  if (w.launches < INSUFFICIENT_BELOW && !w.insufficient) {
    ctx.addIssue({
      code: "custom",
      path: ["insufficient"],
      message: `holds n = ${w.launches} and must be marked insufficient`,
    });
  }
  if (w.excludingFast.insufficient && w.excludingFast.rate !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["excludingFast", "rate"],
      message: "excludingFast.rate must be null when insufficient",
    });
  }
  if (w.excludingFast.insufficient && w.excludingFast.oneIn !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["excludingFast", "oneIn"],
      message: "excludingFast.oneIn must be null when insufficient",
    });
  }
});

const cohort = z.object({
  crawledAt: z.string(),
  definitionsVersion: z.string(),
  key: z.object({ pairClass: z.string(), taxBucket: z.string().nullable() }),
  h24: cohortWindow.nullable(),
  allTime: cohortWindow.nullable(),
});

const ladderStep = z.object({
  atSeconds: z.number().int().nonnegative(),
  cumulative: z.number().int().nonnegative(),
  cumulativeShare: z.number().nullable(),
});

const placement = z
  .object({
    crawledAt: z.string(),
    window: windowName,
    elapsedSeconds: z.number().int().nonnegative(),
    rung: ladderStep.nullable(),
    reason: z.enum(["ok", "insufficient", "no_ladder", "before_first_step"]),
    n: z.number().int().nonnegative(),
    insufficient: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (p.insufficient && p.rung?.cumulativeShare != null) {
      ctx.addIssue({
        code: "custom",
        path: ["rung", "cumulativeShare"],
        message: "an insufficient placement must not carry a share",
      });
    }
    if (p.n < INSUFFICIENT_BELOW && !p.insufficient) {
      ctx.addIssue({
        code: "custom",
        path: ["insufficient"],
        message: `placement holds n = ${p.n} and must be marked insufficient`,
      });
    }
  });

/* ---- Class B: observations about one token ------------------------------ */

const config = z.object({
  pairToken: z.string(),
  pairClass: z.string(),
  creatorTaxBps: z.number().int().nullable(),
  taxBucket: z.string().nullable(),
});

const state = z.object({
  phase: z.number().int().nullable(),
  phaseLabel: z.string(),
  curveFilledWei: z.string().nullable(),
  graduationThresholdWei: z.string().nullable(),
  curveFilledShare: z.number().nullable(),
  fillNote: z.string().nullable(),
  launchBlock: z.number().int().nullable(),
  launchedAt: z.string().nullable(),
  elapsedSeconds: z.number().int().nonnegative().nullable(),
  graduated: z.boolean(),
  graduatedAt: z.string().nullable(),
  timeToGraduationSeconds: z.number().int().nullable(),
  indexed: z.boolean(),
});

const live = z.object({
  stale: z.boolean(),
  lastSuccessAt: z.string().nullable(),
  lastIndexedBlock: z.number().int().nullable(),
});

export const tokenResponseSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    address: z.string().regex(/^0x[0-9a-f]{40}$/),
    venue: z.literal("pons"),
    observedAt: z.string(),
    source: z.literal("chain"),
    config,
    state,
    cohort: cohort.nullable(),
    placement: placement.nullable(),
    live,
    text: z.string(),
    notice: z.string().nullable(),
    links: z.object({ method: z.string(), numberJson: z.string() }),
  })
  .superRefine((body, ctx) => {
    if (body.state.curveFilledShare === null && body.state.fillNote === null) {
      ctx.addIssue({
        code: "custom",
        path: ["state", "fillNote"],
        message: "an absent fill must say why, in words",
      });
    }
    if (body.state.indexed && body.state.launchedAt === null) {
      ctx.addIssue({
        code: "custom",
        path: ["state", "launchedAt"],
        message: "an indexed launch carries the block-header timestamp it was seen at",
      });
    }
    if (!body.state.indexed && body.state.elapsedSeconds !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["state", "elapsedSeconds"],
        message: "an unindexed launch has no elapsed time to report",
      });
    }
  });

export type TokenResponse = z.infer<typeof tokenResponseSchema>;
export type CohortWindow = z.infer<typeof cohortWindowShape>;

export const liveRowSchema = z.object({
  pairClass: z.string(),
  taxBucket: z.string().nullable(),
  ageSeconds: z.number().int().nonnegative(),
  graduated: z.boolean(),
});

export const liveResponseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  observedAt: z.string(),
  lastIndexedBlock: z.number().int().nullable(),
  count: z.number().int().nonnegative(),
  rows: z.array(liveRowSchema).max(200),
  live: live,
});

export type LiveResponse = z.infer<typeof liveResponseSchema>;

/** The complete set of error codes. Anything else is a bug, not a shape. */
export const ERROR_CODES = [
  "bad_address",
  "not_a_pons_token",
  "not_indexed",
  "rpc_down",
  "number_unavailable",
  "rate_limited",
  "not_found",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorResponseSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  error: z.enum(ERROR_CODES),
  message: z.string(),
  factory: z.string().optional(),
  lastIndexedBlock: z.number().int().nullable().optional(),
  retryAfterSeconds: z.number().int().optional(),
  partial: z.unknown().optional(),
});
