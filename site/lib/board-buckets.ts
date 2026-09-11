/* Mirrors worker/src/buckets.ts (PAIR_BUCKETS, TAX_BUCKETS, taxBucketOf)
   verbatim. The site cannot import across the repo boundary into worker/ --
   same reasoning as lib/api-schema.ts's own header -- so the edges are
   copied here rather than imported. CONSTRAINTS 9: these are the same
   published bucket edges pipeline/stats.py and worker/src/buckets.ts already
   hold; this file defines no new band, it only reads the existing ones for
   the board filters to look a row up against. */

export const PAIR_BUCKETS = ["eth", "stable", "stock", "other"] as const;
export const TAX_BUCKETS = ["0%", "1%", "2-3%", "4-5%", "6-10%"] as const;

export type PairClass = (typeof PAIR_BUCKETS)[number];
export type TaxBucket = (typeof TAX_BUCKETS)[number];

const TAX_RANGES: ReadonlyArray<readonly [number, number, TaxBucket]> = [
  [0, 0, "0%"],
  [1, 100, "1%"],
  [101, 300, "2-3%"],
  [301, 500, "4-5%"],
  [501, 1000, "6-10%"],
];

/** A tax bucket from its raw bps, or null when bps is null or outside the
    documented 0-1000 range -- exactly worker/src/buckets.ts's own rule. */
export function taxBucketOf(bps: number | null | undefined): TaxBucket | null {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return null;
  for (const [low, high, label] of TAX_RANGES) {
    if (bps >= low && bps <= high) return label;
  }
  return null;
}
