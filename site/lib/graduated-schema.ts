import { z } from "zod";

/* The shape of public/graduated.json, generated at build time by
   scripts/generate-graduated.mjs (see graduated-core.mjs for the join). A
   build fails here rather than shipping a row list the schema cannot vouch
   for — the same discipline lib/schema.ts holds data/number.json to.

   Every field on a row is a Class B fact about that one token: its own
   duration, its own launch, its own graduation. Nothing here is a share, a
   rate, or a percentage over the population — those stay in number.json. */

const isoTimestamp = z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
  message: "must be a timestamp a clock can read",
});

export const graduatedRowSchema = z.object({
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  durationSeconds: z.number().int().nonnegative(),
  graduatedAt: isoTimestamp,
  launchedAt: isoTimestamp,
  pairClass: z.string().nullable(),
  creatorTaxBps: z.number().int().nullable(),
});

export const graduatedFileSchema = z.object({
  generatedAt: isoTimestamp,
  staleAfterSeconds: z.number().int().positive(),
  totalGraduationRows: z.number().int().nonnegative(),
  excludedNoLaunch: z.number().int().nonnegative(),
  excludedUnmatched: z.number().int().nonnegative(),
  rows: z.array(graduatedRowSchema),
});

export type GraduatedRow = z.infer<typeof graduatedRowSchema>;
export type GraduatedFile = z.infer<typeof graduatedFileSchema>;
