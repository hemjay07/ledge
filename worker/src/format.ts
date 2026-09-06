/* Formatting helpers.

   REVIEWER NOTE (gate 2, ARCHITECTURE-PHASE2-4.md section 9): this is the
   separate file the no-arithmetic lint exempts, and it exists so that
   lookup.ts, ladder.ts and text.ts can hold none. Everything below turns a
   number that is already decided into characters. Nothing here derives a rate,
   a share, or a percentile: the only divisions are seconds-into-minutes and
   milliseconds-into-seconds, both of which are unit conversions on a single
   observed quantity, not aggregations over a population.

   The rules themselves are the site's, from site/lib/format-core.mjs, so the
   Worker and the sheet cannot disagree about when a number may be printed. */

export const INSUFFICIENT_BELOW = 30;

export interface Fact {
  rate: number | null | undefined;
  n: number;
  insufficient?: boolean;
}

export function decimalsFor(n: number): number {
  return n >= 1000 ? 2 : 1;
}

export function insufficientText(n: number): string {
  return `not enough data (n=${Number.isFinite(n) ? n : 0})`;
}

export function formatRate(rate: number, n: number, precision?: number): string {
  const d = precision ?? decimalsFor(n);
  return `${(rate * 100).toFixed(d)}%`;
}

/** True when a rate must not be printed as a percentage. */
export function isInsufficient(fact: Fact): boolean {
  return (
    fact.insufficient === true ||
    fact.rate === null ||
    fact.rate === undefined ||
    !(fact.n >= INSUFFICIENT_BELOW)
  );
}

/** The one formatter every rate goes through, on every surface. */
export function rateText(fact: Fact, precision?: number): string {
  return isInsufficient(fact) ? insufficientText(fact.n) : formatRate(fact.rate as number, fact.n, precision);
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatOneIn(oneIn: number): string {
  return `1 in ${formatCount(oneIn)}`;
}

/** Seconds as a printed duration: "41 s", "4 min", "1 h 2 min". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s - h * 3600) / 60);
  if (m === 60) return `${h + 1} h`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function formatDurationLong(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} seconds`;
  if (s < 3600) {
    const m = Math.round(s / 60);
    return `${m} ${m === 1 ? "minute" : "minutes"}`;
  }
  return formatDuration(s);
}

/** Age of a measurement. Coarsens above an hour. */
export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

/* ---- token amounts ------------------------------------------------------ */

/** A quantity in a token's smallest unit, printed in that token's own units.

    This is a unit conversion on one observed quantity -- 4200000000000000000
    and 4.2 ETH are the same fact written two ways -- not a rate and not a
    share. The integer arithmetic is exact: the wei never pass through a float,
    only the digits that are printed do.

    `maxPlaces` is a display cap, not a claim about precision. A value that
    would round away to "0" is given more places until a significant digit
    appears, because "0 ETH" for a token that holds something would be false;
    it stops at the token's own decimals, where the value really is exhausted. */
export function formatUnits(
  raw: string | bigint,
  decimals: number,
  maxPlaces = 4,
): string | null {
  let value: bigint;
  try {
    value = typeof raw === "bigint" ? raw : BigInt(raw);
  } catch {
    return null;
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;

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
  return shown === "" ? `${sign}${whole}` : `${sign}${whole}.${shown}`;
}

/** A Class B ratio -- one measurement against one constant -- as a percentage.

    It deliberately does NOT go through rateText. rateText carries the
    insufficiency gate, and that gate is about SAMPLES: it asks whether n
    supports a rate. A curve fill has no n, because it has no population; it is
    one quantity over one threshold, both observed and both printed beside it.
    Passing a fabricated n to rateText to get past its gate would be routing
    around the gate, which is the thing the gate exists to prevent.

    A share that would round away to "0.0%" while the curve actually holds
    something is printed as "<0.1%", because a curve holding something must not
    read as a curve holding nothing. `holdsSomething` is the caller's reading of
    the quantity itself, not of the already-rounded share -- by the time a share
    reaches six places the distinction has been lost. */
export function formatShareOfOne(share: number, holdsSomething = true): string {
  const percent = share * 100;
  if (holdsSomething && percent < 0.05) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

/** "4.2 ETH", or "4.2" when the ticker is not known. */
export function formatAmount(
  raw: string | bigint,
  decimals: number,
  symbol: string | null,
  maxPlaces = 4,
): string | null {
  const amount = formatUnits(raw, decimals, maxPlaces);
  if (amount === null) return null;
  return symbol === null ? amount : `${amount} ${symbol}`;
}

/** Which whole minute of its life a token is in. "minute 14" on the card. */
export function minuteOf(elapsedSeconds: number): number {
  return Math.floor(Math.max(0, elapsedSeconds) / 60);
}

/** Seconds between an ISO stamp and a clock reading, never negative. */
export function ageSeconds(iso: string, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
}

export function toIso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Measured 6 Sep 2026 - 15:58 UTC" -- the colophon stamp. */
export function formatStamp(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `Measured ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
}

/** A 20-byte hex address, lowercased, or null. The Worker accepts nothing else. */
export function normaliseAddress(input: string): string | null {
  const trimmed = input.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** "0x23fe54b3...f98fe2" -- an address shortened for a card, never as a subject. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}
