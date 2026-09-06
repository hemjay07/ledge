import type { WindowData } from "./schema";
import { formatCount, formatStamp, isInsufficient, rateText } from "./format";

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
): string {
  const counts = withCounts
    ? `: ${formatCount(w.excludingFast.graduations)} of ${formatCount(w.launches)}`
    : "";
  return `${rateText(excludingFastFact(w))} excluding launches that graduated inside ${cutoffWords}${counts}.`;
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

  return `${headline} ${excluding}`;
}
