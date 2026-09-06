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
