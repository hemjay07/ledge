import type { Coverage } from "./coverage";
import { formatAge, formatCount, formatRate } from "./format";

/* The three sentences /method prints for the live index's own reading.
   Shares come from the file; below the floor the sentence carries the n
   and no percentage, the same rule as every other figure. */
export function coverageCardText(c: Coverage): { coverage: string; launchBlock: string; freshness: string } {
  const pct = (share: number | null) => (c.insufficient || share === null ? `not enough data (n=${c.sampled})` : formatRate(share, c.sampled));
  return {
    coverage: c.insufficient
      ? `${formatCount(c.present)} of ${formatCount(c.sampled)} sampled launches have a row in the live index; not enough data (n=${c.sampled}).`
      : `${formatCount(c.present)} of ${formatCount(c.sampled)} sampled launches have a row in the live index (${pct(c.presentShare)}).`,
    launchBlock: c.insufficient
      ? `For ${formatCount(c.launchBlockRead)} of the ${formatCount(c.sampled)} the launch block itself was read; not enough data (n=${c.sampled}).`
      : `For ${formatCount(c.launchBlockRead)} of the ${formatCount(c.sampled)} the launch block itself was read (${pct(c.launchBlockReadShare)}).`,
    freshness: `The live index's last completed pass was ${formatAge(c.cursorAgeSeconds)} before this was measured.`,
  };
}
