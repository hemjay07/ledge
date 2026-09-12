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

/** A creator tax in the reader's own unit: 300 bps is "3%". Null when the
    factory read failed, and that says so rather than printing 0. */
export function taxPercent(bps: number | null): string {
  if (bps === null) return "not read";
  const percent = bps / 100;
  return Number.isInteger(percent * 100) ? `${percent}%` : `${percent.toFixed(2)}%`;
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

/* ---- the live board (REPOSITION.md Phase B) -----------------------------
   The live payload carries quote amounts as raw uint256 decimal strings with
   no decimals field to scale them by -- a launch's pair token can be an
   18-decimal ETH pool, a 6-decimal stablecoin, or "other values besides"
   (REPOSITION.md), and guessing which would be exactly the fake precision
   CONSTRAINTS 4 bans. These stay unscaled, printed as the raw base-unit
   integers LEDGE indexed, comma-grouped for legibility. */

/** Comma-grouped digits for a uint256 decimal string. BigInt-safe: these
    values run well past Number.MAX_SAFE_INTEGER. */
export function formatBigDecimal(value: string): string {
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}

/** A quantity in its pair token's own units: 8090000000 at 6 decimals is
    "8,090 USDG". A unit conversion on one observed quantity, not a rate.

    Null decimals returns null, and the caller then prints the raw integer and
    says the units are not known. That is deliberate and mirrors the Worker's
    decimals.ts: a GUESSED exponent moves a figure by orders of magnitude, so
    no exponent is ever assumed from the pair class or from anything else.

    The integer arithmetic is exact -- the base units never pass through a
    float, only the digits that are printed do. `maxPlaces` is a display cap
    rather than a claim about precision: a value that would round away to "0"
    is given more places until a significant digit appears, because "0 ETH"
    for a token that holds something would be false. */
export function formatPairAmount(
  raw: string,
  decimals: number | null,
  symbol: string | null,
  maxPlaces = 4,
): string | null {
  if (decimals === null) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;

  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return null;
  }

  const negative = value < 0n;
  if (negative) value = -value;

  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0");

  let places = Math.min(maxPlaces, decimals);
  while (places < decimals && whole === 0n && /^0*$/.test(fraction.slice(0, places))) {
    places += 1;
  }

  const shown = fraction.slice(0, places).replace(/0+$/, "");
  const sign = negative ? "-" : "";
  const amount = `${sign}${formatBigDecimal(whole.toString())}${shown === "" ? "" : `.${shown}`}`;
  return symbol === null ? amount : `${amount} ${symbol}`;
}

/** The pair amount where the units are known, and the raw base-unit integer
    with the units said aloud where they are not. Never a guessed exponent. */
export function pairQuantity(
  raw: string,
  decimals: number | null,
  symbol: string | null,
): { text: string; scaled: boolean } {
  const scaled = formatPairAmount(raw, decimals, symbol);
  return scaled === null
    ? { text: formatBigDecimal(raw), scaled: false }
    : { text: scaled, scaled: true };
}

/** The indexed net quote as a share of a launch's own graduation threshold,
    to one decimal place. Null when the threshold is not a positive integer,
    so a caller never divides by zero or by a value it cannot parse. This is
    a single launch's own fact against its own denominator, not a sampled
    rate, so it is not gated by n -- there is no cohort to be under-sampled. */
export function fillPercent(netQuoteWei: string, thresholdWei: string): number | null {
  let net: bigint;
  let threshold: bigint;
  try {
    net = BigInt(netQuoteWei);
    threshold = BigInt(thresholdWei);
  } catch {
    return null;
  }
  if (threshold <= 0n) return null;
  const tenthPercent = (net * 1000n) / threshold;
  return Number(tenthPercent) / 10;
}
