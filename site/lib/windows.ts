import type { WindowData } from "./schema";

/* Until enough history is indexed, the all-time window contains exactly the
   launches the trailing 24 hours contains, and every figure in it is the same
   measurement. Rendering both is not two measurements agreeing — it is one
   measurement printed twice, which is the most corrosive thing a neutral
   instrument can do. The site detects the condition from the data rather than
   being told about it, so the all-time surfaces reappear on their own the
   moment the index is older than a day. */
export function sameMeasurement(a: WindowData, b: WindowData): boolean {
  return (
    a.launches === b.launches &&
    a.graduations === b.graduations &&
    a.rate === b.rate &&
    a.excludingFast.graduations === b.excludingFast.graduations &&
    a.excludingFast.rate === b.excludingFast.rate &&
    a.deployers.distinct === b.deployers.distinct
  );
}

export const SAME_MEASUREMENT_NOTE =
  "All-time equals the trailing 24 hours until more history is indexed.";

/* Coverage stated in hours rather than in a block number. A block height is
   provenance — it says which blocks were read — but it is not a duration, and
   a reader cannot tell from "since block 56028514" whether the record is four
   hours old or four months old. `firstIndexedAt` is the block-header timestamp
   of the earliest launch in the record, so the span to the measurement that
   counted it is the coverage, and it is rounded DOWN: a record that covers
   four hours and fifty minutes has not covered five.

   Both ends are fixed values in the committed file, so this is stable across a
   static build and a screenshot alike — it is not "hours ago". */
export function coverageHours(firstIndexedAt: string | null, crawledAt: string): number | null {
  if (firstIndexedAt === null) return null;
  const from = Date.parse(firstIndexedAt);
  const to = Date.parse(crawledAt);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.floor((to - from) / 3_600_000));
}
