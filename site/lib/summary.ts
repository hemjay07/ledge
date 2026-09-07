import type { WindowData } from "./schema";
import { formatCount, formatStamp, isInsufficient, rateText } from "./format";
import { LEAD } from "./lead";

/* Every sentence that carries a rate off the page — the accessible text under
   the poster figures, the page description, the Open Graph and Twitter
   descriptions, and the alt text on the card image — is built here, from
   rateText(). A percentage cannot reach the DOM or a meta tag for a rate the
   pipeline marked insufficient, left null, or computed over fewer than 30
   launches: the slot fills with "not enough data (n=…)" instead. */

/** The rate fact for the window's headline number. */
export function ponsNumberFact(w: WindowData) {
  return { rate: w.rate, n: w.launches, insufficient: w.insufficient };
}

/** The rate fact for the excluding-fast figure. It shares the window's
    denominator: the numerator is what changes, never the population. */
export function excludingFastFact(w: WindowData) {
  return { rate: w.excludingFast.rate, n: w.launches, insufficient: w.excludingFast.insufficient };
}

/** The sentence a screen reader hears in place of the poster figure.
    The measurement time is spoken, not spelled: a raw ISO timestamp is read
    out as character soup. formatStamp is the same form the colophon stamps. */
export function ponsNumberSentence(w: WindowData, measuredAt?: string): string {
  const counts = `${formatCount(w.graduations)} of ${formatCount(w.launches)} Pons launches in the last 24 hours graduated.`;
  const measured = measuredAt ? ` ${formatStamp(measuredAt)}.` : "";
  return `${rateText(ponsNumberFact(w))}: ${counts}${measured}`;
}

/** The sentence a screen reader hears in place of the excluding-fast figure. */
export function excludingFastSentence(
  w: WindowData,
  cutoffWords: string,
  withCounts = false,
  measuredAt?: string,
): string {
  const counts = withCounts
    ? `: ${formatCount(w.excludingFast.graduations)} of ${formatCount(w.launches)}`
    : "";
  const measured = measuredAt ? ` ${formatStamp(measuredAt)}.` : "";
  return `${rateText(excludingFastFact(w))} excluding launches that graduated inside ${cutoffWords}${counts}.${measured}`;
}

/* ---- which of the two the fold leads with ------------------------------ */

/** The sentence heard in place of the poster figure, whichever figure LEAD
    posters. The poster is the copy of the number that is screenshotted, so it
    is the one that speaks the measurement time. */
export function posterSentence(
  w: WindowData,
  cutoffWords: string,
  measuredAt?: string,
): string {
  return LEAD === "raw"
    ? ponsNumberSentence(w, measuredAt)
    : excludingFastSentence(w, cutoffWords, true, measuredAt);
}

/** The sentence heard in place of the second figure. It is the other one of
    the pair: both are always rendered, over the same n and the same window. */
export function secondarySentence(
  w: WindowData,
  cutoffWords: string,
  withCounts = false,
): string {
  return LEAD === "raw"
    ? excludingFastSentence(w, cutoffWords, withCounts)
    : ponsNumberSentence(w);
}

/** The description carried by the page metadata, the unfurl and the card's
    alt text. One string, so the three cannot disagree. */
export function shareSummary(w: WindowData, cutoffWords: string): string {
  const headline = isInsufficient(ponsNumberFact(w))
    ? `${rateText(ponsNumberFact(w))} for the ${formatCount(w.launches)} Pons launches in the last 24 hours, ${formatCount(w.graduations)} graduations.`
    : `${rateText(ponsNumberFact(w))} of ${formatCount(w.launches)} Pons launches in the last 24 hours graduated.`;

  const excluding = isInsufficient(excludingFastFact(w))
    ? `Excluding launches that graduated inside ${cutoffWords}: ${rateText(excludingFastFact(w))}.`
    : `${rateText(excludingFastFact(w))} excluding launches that graduated inside ${cutoffWords}.`;

  return LEAD === "raw" ? `${headline} ${excluding}` : `${excluding} ${headline}`;
}

/* ---- the fast-graduation finding -------------------------------------- */

/** The two fast-graduation shares as facts, both counted over the window's
    graduations rather than its launches. The sentence is printed on the sheet
    and again on the cohorts page, so the pair of facts and the sample size
    they share are built once here and the two surfaces cannot disagree about
    when either may be printed as a percentage. */
export function fastShareFacts(w: WindowData) {
  const n = w.fastShares.n;
  const insufficient = w.fastShares.insufficient;
  const underCutoff = { rate: w.fastShares.under300Share, n, insufficient };
  const under60 = { rate: w.fastShares.under60Share, n, insufficient };
  return {
    n,
    underCutoff,
    under60,
    /* either half missing takes the whole sentence down to its sample size:
       half a finding reads as a finding */
    insufficient: isInsufficient(underCutoff) || isInsufficient(under60),
  };
}
