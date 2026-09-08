/* Formatting rules, stated once and applied everywhere.
   Precision is decided by the sample size, never by taste.

   This module is plain JavaScript on purpose: it is imported by the site
   (through lib/format.ts) and by scripts/og.mjs, which runs on bare node
   before the build. One copy of these rules, so the sheet and the share card
   cannot disagree about when a number may be printed. */

export const INSUFFICIENT_BELOW = 30;

export function decimalsFor(n) {
  return n >= 1000 ? 2 : 1;
}

export function insufficientText(n) {
  return `not enough data (n=${Number.isFinite(n) ? n : 0})`;
}

/** A rate in [0,1] as a percentage, to the precision n supports. */
export function formatRate(rate, n, precision) {
  const d = precision ?? decimalsFor(n);
  return `${(rate * 100).toFixed(d)}%`;
}

/* ---- the insufficiency gate -------------------------------------------- */

/** True when a rate must not be printed as a percentage: the pipeline marked
    it insufficient, it has no value, or the sample is under 30. */
export function isInsufficient(fact) {
  return (
    fact.insufficient === true ||
    fact.rate === null ||
    fact.rate === undefined ||
    !(fact.n >= INSUFFICIENT_BELOW)
  );
}

/** The one formatter every rate goes through, on every surface: the DOM, the
    accessible text, the page metadata and the share card. It returns
    "not enough data (n=…)" whenever the rate may not be printed, so a
    percentage cannot reach a reader for a rate the sample does not support. */
export function rateText(fact, precision) {
  return isInsufficient(fact) ? insufficientText(fact.n) : formatRate(fact.rate, fact.n, precision);
}

/** A part of a population as a share of it, gated the same way. An empty
    population has no share: it renders "not enough data (n=0)". */
export function shareText(part, whole, precision) {
  return rateText({ rate: whole > 0 ? part / whole : null, n: whole }, precision);
}

/* ---- counts, durations, timestamps ------------------------------------- */

/** "1 in 279". */
export function formatOneIn(oneIn) {
  return `1 in ${formatCount(oneIn)}`;
}

export function formatCount(value) {
  return value.toLocaleString("en-US");
}

/** Seconds as a printed duration: "41 s", "4 min", "1 h 2 min". */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s - h * 3600) / 60);
  if (m === 60) return `${h + 1} h`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The same duration spelled out, for running prose: "5 minutes". */
export function formatDurationLong(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} seconds`;
  if (s < 3600) {
    const m = Math.round(s / 60);
    return `${m} ${m === 1 ? "minute" : "minutes"}`;
  }
  return formatDuration(s);
}

/** Age of a measurement. Coarsens above an hour: nobody reads "2 h 14 min old". */
export function formatAge(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(iso) {
  const d = new Date(iso);
  return {
    day: d.getUTCDate(),
    month: d.getUTCMonth(),
    year: d.getUTCFullYear(),
    hh: String(d.getUTCHours()).padStart(2, "0"),
    mm: String(d.getUTCMinutes()).padStart(2, "0"),
  };
}

/** "Measured 6 Sep 2026 · 15:58 UTC" — the colophon stamp. */
export function formatStamp(iso) {
  const p = parts(iso);
  return `Measured ${p.day} ${MONTHS_SHORT[p.month]} ${p.year} · ${p.hh}:${p.mm} UTC`;
}

/** "15:58 UTC, 6 September 2026" — the long form used in prose. */
export function formatUtcLong(iso) {
  const p = parts(iso);
  return `${p.hh}:${p.mm} UTC, ${p.day} ${MONTHS[p.month]} ${p.year}`;
}

/** "15:58 UTC" — the short form. */
export function formatUtcTime(iso) {
  const p = parts(iso);
  return `${p.hh}:${p.mm} UTC`;
}

/* ---- dated samples ------------------------------------------------------ */

/** "8 September 2026" — a measurement date with no time on it. A sample is
    read on a day, not at an instant, so it is not stamped like a crawl. */
export function formatDayLong(iso) {
  const p = parts(iso);
  return `${p.day} ${MONTHS[p.month]} ${p.year}`;
}

/* The one sentence the raised-nothing sample is published as, and the one
   provenance line under it. Both live here because the fold, the card page and
   the OG image all set them, and three copies of a sentence are three chances
   for the card to say something the sheet does not. */

/** The clause the share governs. The figure is never in this string. */
export const SAMPLE_CLAUSE = "of Pons launches never take a single buy.";

/** How the sample was taken, in the length a fine-print line holds. The full
    method stays in the file, under `method`. */
export const SAMPLE_METHOD_SHORT = "read from each launch's own bonding curve";

/** The sample as a rate fact: its share over the number it sampled. A sample
    with no `sampled` count has no denominator and therefore no printable
    share, which is the same gate every other rate on the site passes. */
export function sampleFact(sample) {
  return { rate: sample?.share ?? null, n: sample?.sampled ?? 0 };
}

/** "93.5% of Pons launches never take a single buy." — or, below the gate,
    "not enough data (n=…) of Pons launches never take a single buy." */
export function sampleSentence(sample) {
  return `${rateText(sampleFact(sample))} ${SAMPLE_CLAUSE}`;
}

/** "187 of 200 sampled · 8 September 2026 · read from each launch's own
    bonding curve" — the count, the denominator, the date, the method. */
export function sampleProvenance(sample) {
  return (
    `${formatCount(sample.count)} of ${formatCount(sample.sampled)} sampled` +
    ` · ${formatDayLong(sample.measuredAt)} · ${SAMPLE_METHOD_SHORT}`
  );
}

/** The sample a surface may render: one that carries its own denominator.
    Without `sampled` there is nothing to divide by and nothing to print, so
    the block does not appear at all rather than appearing without its n. */
export function renderableSample(samples, name) {
  const sample = samples?.[name];
  return sample && typeof sample.sampled === "number" ? sample : null;
}
