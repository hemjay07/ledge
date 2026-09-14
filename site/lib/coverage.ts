import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/* data/coverage.json: how much of the canonical record the live index
   holds, measured by pipeline/coverage.py after every crawl (INDEXER.md §3,
   TODO A4). Optional -- a checkout without it renders no figure rather than
   a made-up one -- and validated, so a malformed reading fails the build. */
export const coverageSchema = z.object({
  measuredAt: z.string(),
  window: z.string(),
  sampled: z.number().int().nonnegative(),
  present: z.number().int().nonnegative(),
  presentShare: z.number().nullable(),
  launchBlockRead: z.number().int().nonnegative(),
  launchBlockReadShare: z.number().nullable(),
  insufficient: z.boolean(),
  cursorLastSuccessAt: z.string(),
  cursorAgeSeconds: z.number().int().nonnegative(),
});

export type Coverage = z.infer<typeof coverageSchema>;

export function readCoverage(dataDir = join(process.cwd(), "..", "data")): Coverage | null {
  const path = join(dataDir, "coverage.json");
  if (!existsSync(path)) return null;
  const parsed = coverageSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error("LEDGE: data/coverage.json does not match its schema.\n" + JSON.stringify(parsed.error.issues, null, 2));
  }
  return parsed.data;
}
