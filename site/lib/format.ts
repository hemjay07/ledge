/* The site's view of the formatting rules.

   Every rule that the share card must also obey lives in ./format-core.mjs,
   which is plain JavaScript so scripts/og.mjs can import the same code on bare
   node. Nothing is reimplemented here: the bucket labels below are the only
   part of formatting the card has no use for. */

export * from "./format-core.mjs";

/** Cohort bucket labels, as printed in the register. */
const PAIR_LABELS: Record<string, string> = {
  eth: "ETH",
  stable: "Stablecoin",
  stock: "Tokenized stock",
  other: "Other",
};

export function pairLabel(bucket: string): string {
  return PAIR_LABELS[bucket] ?? bucket;
}

/** Tax buckets arrive as "2-3%" and are printed with an en dash. */
export function taxLabel(bucket: string): string {
  return bucket.replace("-", "–");
}

export function hourLabel(bucket: string): string {
  return `${bucket}:00`;
}

export function histogramLabel(bucket: string): string {
  return bucket.replace("-", "–");
}
