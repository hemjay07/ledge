/* Bucket definitions, mirroring pipeline/stats.py exactly.

   These are DEFINITIONS: PAIR_BUCKETS, TAX_BUCKETS and the bps ranges below
   are the same values stats.py holds, and moving one is a dated /method
   changelog entry (CONSTRAINTS 9). Placing a token in a bucket is a table
   lookup on one observed value, not a statistic -- the statistic is the row
   the bucket then points at, and that row is computed in Python. */

export const PAIR_BUCKETS = ["eth", "stable", "stock", "other"] as const;
export const TAX_BUCKETS = ["0%", "1%", "2-3%", "4-5%", "6-10%"] as const;

export type PairClass = (typeof PAIR_BUCKETS)[number];
export type TaxBucket = (typeof TAX_BUCKETS)[number];

/** Inclusive bps ranges, from stats.py `_tax_bucket`. Anything outside the
    documented 0-1000 range is excluded exactly as a missing value is. */
const TAX_RANGES: ReadonlyArray<readonly [number, number, TaxBucket]> = [
  [0, 0, "0%"],
  [1, 100, "1%"],
  [101, 300, "2-3%"],
  [301, 500, "4-5%"],
  [501, 1000, "6-10%"],
];

export function taxBucketOf(bps: number | null | undefined): TaxBucket | null {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return null;
  for (const [low, high, label] of TAX_RANGES) {
    if (bps >= low && bps <= high) return label;
  }
  return null;
}

/** The register's labels, from site/lib/format.ts. */
const PAIR_LABELS: Record<string, string> = {
  eth: "ETH",
  stable: "Stablecoin",
  stock: "Tokenized stock",
  other: "Other",
};

export function pairLabel(bucket: string): string {
  return PAIR_LABELS[bucket] ?? bucket;
}

/** Tax buckets are stored as "2-3%" and printed with an en dash. */
export function taxLabel(bucket: string): string {
  return bucket.replace("-", "–");
}

export interface PairTokenEntry {
  class: string;
  symbol: string;
}

/** The repo's pair-token map, read from KV. An address the map has never seen
    lands in "other", which is what recompute.py would do with it anyway; the
    next hourly Python run classifies it for good. */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function pairClassOf(
  pairToken: string,
  map: Record<string, PairTokenEntry> | null,
): PairClass {
  const address = pairToken.toLowerCase();
  // pairToken 0x0 is ETH by the factory's own definition (PONS_CONTRACTS.md),
  // so the most common class does not depend on the map being loadable.
  if (address === ZERO_ADDRESS) return "eth";
  const entry = map?.[address];
  const cls = entry?.class;
  return (PAIR_BUCKETS as readonly string[]).includes(cls ?? "") ? (cls as PairClass) : "other";
}
