/* The one text builder.
   ============================================================================
   NO ARITHMETIC IN THIS FILE (gate 2, ARCHITECTURE-PHASE2-4.md section 9).
   Every number below arrives already decided -- by pipeline/stats.py if it is
   a statistic, by a chain read if it is an observation. This file chooses
   words. The formatters it calls live in format.ts, which carries a reviewer
   note for the unit conversions it does hold.

   The API, the /t shell, the death card and the Telegram bot all render from
   here, so none of them can invent a sentence of its own.

   Two rules govern the wording, and both are review blockers if broken:
     - Past tense, always. "graduated", "died", "had already happened". An
       outcome that has occurred is a fact about one token, which CONSTRAINTS
       permits. A future tense would be a verdict, which it forbids.
     - No percentage without its n, ever, on any surface. Every rate goes
       through rateText, which returns "not enough data (n=...)" rather than a
       figure the sample does not support.
   ========================================================================= */

import {
  formatAge,
  formatAmount,
  formatCount,
  formatDuration,
  formatOneIn,
  formatStamp,
  isInsufficient,
  minuteOf,
  formatShareOfOne,
  rateText,
  shortAddress,
} from "./format";
import { pairLabel, taxLabel } from "./buckets";
import type { TokenResponse } from "./schema";

const SEP = " · ";

/** The outcome word for a token, in the past tense.

    "died" is used only where the outcome is settled: the token is still on the
    bonding curve, no PoolGraduated has been seen for it, and it is older than
    the longest time-to-graduation ever measured in the published window --
    after which nothing has ever graduated. Where the outcome is not yet
    settled the word is "on the curve", which is a description, not a forecast. */
export function outcomeWord(body: Omit<TokenResponse, "text">, observedMaxSeconds: number | null): string {
  if (body.state.graduated) {
    /* How long it took, where both ends are on record. "Graduated" alone is
       the signal the whole chain runs on, and it is the same word for a curve
       that filled in eight seconds and one that took six hours. Those are not
       the same event, and the duration is the only thing that separates them.

       It is a duration, not a judgement: CONSTRAINTS 6 binds here, and the
       5-minute mark stays a descriptive threshold rather than a definition of
       "rigged". Nothing here labels a token, and a reader who sees "8 s"
       needs no help from us. Null when the launch is older than the indexed
       record, where the difference cannot be taken. */
    const took = body.state.timeToGraduationSeconds;
    return took === null ? "graduated" : `graduated in ${formatDuration(took)}`;
  }
  const elapsed = body.state.elapsedSeconds;
  if (elapsed === null || observedMaxSeconds === null) return "on the curve";
  if (body.state.phase !== 0 && body.state.phase !== null) return "on the curve";
  return elapsed > observedMaxSeconds ? "died" : "on the curve";
}

export function minuteLabel(elapsedSeconds: number | null): string {
  return elapsedSeconds === null ? "launch time not indexed" : `minute ${minuteOf(elapsedSeconds)}`;
}

/** The token's configuration, named by the cohort buckets it falls in --
    those buckets are what the cohort figures are about. */
function configLabel(body: Omit<TokenResponse, "text">): string {
  const tax = body.config.taxBucket === null ? "tax not read" : taxLabel(body.config.taxBucket);
  return `${pairLabel(body.config.pairClass)}${SEP}${tax}`;
}

/** The cohort slot of the card:
      "cohort 1.82% (n=3,566)" | "cohort not enough data (n=29)" | "cohort not published" */
function cohortSlot(body: Omit<TokenResponse, "text">): string {
  const w = body.cohort?.allTime ?? body.cohort?.h24 ?? null;
  if (!w) return "cohort not published";
  const fact = { rate: w.rate, n: w.launches, insufficient: w.insufficient };
  return isInsufficient(fact)
    ? `cohort ${rateText(fact)}`
    : `cohort ${rateText(fact)} (n=${formatCount(w.launches)})`;
}

/** The death card line, and the og:title of /t/{address}:
      minute 14 · died · cohort 1.2% (n=156) · ETH · 3%
    Fixed byte-for-byte against tests/vectors/lookup.json. */
export function headline(
  body: Omit<TokenResponse, "text">,
  observedMaxSeconds: number | null,
): string {
  return [
    minuteLabel(body.state.elapsedSeconds),
    outcomeWord(body, observedMaxSeconds),
    cohortSlot(body),
    configLabel(body),
  ].join(SEP);
}

/** Where the token sits on the published table of graduation times. The share
    is stats.py's, copied; this only chooses how to say it. Null when there is
    no launch time to place. Fixed byte-for-byte against the vector file. */
export function placementText(placement: TokenResponse["placement"]): string | null {
  if (!placement) return null;
  if (placement.reason === "no_ladder") {
    return "The table of graduation times is not published yet, so this launch is not placed on it.";
  }
  if (placement.reason === "before_first_step") {
    return `This launch is younger than the first step of the published table (n=${formatCount(placement.n)}).`;
  }
  const share = placement.rung === null ? null : placement.rung.cumulativeShare;
  if (placement.insufficient || placement.rung === null || share === null) {
    return `Not enough graduations to place this launch (n=${formatCount(placement.n)}).`;
  }
  const by = formatDuration(placement.rung.atSeconds);
  return (
    `By ${by}, ${rateText({ rate: share, n: placement.n })} of the ${formatCount(placement.n)} ` +
    `graduations measured in this window had already happened.`
  );
}

/* METHOD.md "Freshness": the age is the consumer's computation, and a figure
   older than the published bound may not be stated as if it had just been
   measured. The clause goes on the sentence itself rather than on a banner at
   the top, because the sentence is what gets quoted, screenshotted and read
   aloud on its own. */
export function freshnessNote(freshness: Omit<TokenResponse, "text">["freshness"]): string {
  if (!freshness || !freshness.stale) return "";
  const age = formatAge(freshness.ageSeconds);
  const bound = formatDuration(freshness.staleAfterSeconds);
  return ` These figures were measured ${age} ago — older than the ${bound} freshness bound.`;
}

/** The same clause, without its sentence, for a card line. */
export function freshnessLine(freshness: Omit<TokenResponse, "text">["freshness"]): string | null {
  if (!freshness || !freshness.stale) return null;
  const age = formatAge(freshness.ageSeconds);
  const bound = formatDuration(freshness.staleAfterSeconds);
  return `measured ${age} ago — older than the ${bound} freshness bound`;
}

function cohortSentence(
  window: NonNullable<TokenResponse["cohort"]>["allTime"],
  lead: string,
  note = "",
): string | null {
  if (!window) return null;
  const fact = { rate: window.rate, n: window.launches, insufficient: window.insufficient };
  if (isInsufficient(fact)) {
    return `${lead}: ${rateText(fact)}.${note}`;
  }
  const cutoff = formatDuration(window.excludingFast.cutoffSeconds);
  const ef = {
    rate: window.excludingFast.rate,
    n: window.launches,
    insufficient: window.excludingFast.insufficient,
  };
  const oneIn =
    !isInsufficient(ef) && window.excludingFast.oneIn !== null
      ? ` (${formatOneIn(window.excludingFast.oneIn)})`
      : "";
  return (
    `${lead}: ${formatCount(window.graduations)} of ${formatCount(window.launches)} graduated, ` +
    `${rateText(fact)}. Excluding launches that graduated inside ${cutoff}: ` +
    `${formatCount(window.excludingFast.graduations)} of ${formatCount(window.launches)}, ${rateText(ef)}${oneIn}.${note}`
  );
}

/* A placement can be missing for two unrelated reasons, and saying the wrong
   one is a small lie that a reader can catch: a token whose launch time IS
   indexed being told it is not. The cause decides the wording. */
function placementSentence(body: Omit<TokenResponse, "text">): string | null {
  const line = placementText(body.placement);
  if (line !== null) return `${line}${freshnessNote(body.freshness)}`;
  if (!body.state.indexed) {
    return "The launch time is not indexed, so this launch is not placed on the table of graduation times.";
  }
  if (body.cohort === null) {
    return "The published table of graduation times is not loadable, so this launch is not placed on it.";
  }
  return "This launch is not placed on the table of graduation times.";
}

/* Both quantities, always, in the pair token's own units.

   "0.0094 ETH of 4.2 ETH" is the same fact as "9413231 of 4200000000000000000"
   and the only one a reader can act on; the conversion is a unit change on one
   observed quantity, done in format.ts, not a statistic.

   The share follows the quantities as "(53.5% of the threshold)". That is x of
   y with both terms present, which is what CONSTRAINTS 3 asks for -- it is
   never the whole sentence.

   With one exception, and it is about placement rather than about the share.
   This line sits three lines below a cohort line that may read "not enough
   data (n=12)". A percentage printed inches beneath a suppressed one invites
   exactly the misreading the suppression exists to prevent, so where the
   cohort is suppressed the share clause is dropped and only the two
   quantities are printed. The share still travels as `curveFilledShare`,
   which is where the bar is drawn from.

   Where the decimals are unknown the integer is printed unchanged and the
   sentence says the units are not known. An assumed exponent would move the
   figure by orders of magnitude, which is worse than an unreadable one. */
export function fillSentence(
  state: TokenResponse["state"],
  config: TokenResponse["config"],
  cohortSuppressed = false,
): string {
  if (state.curveFilledShare === null) {
    return `Curve fill: ${state.fillNote ?? "not available"}.`;
  }
  const note = state.fillNote === null ? "" : ` — ${state.fillNote}`;
  const decimals = config.pairDecimals;

  if (decimals === null) {
    return (
      `Curve fill: ${state.curveFilledWei} of ${state.graduationThresholdWei} ` +
      `in the pair token's smallest unit; its decimals are not known${note}.`
    );
  }

  const filled = formatAmount(state.curveFilledWei ?? "0", decimals, config.pairSymbol);
  const threshold = formatAmount(state.graduationThresholdWei ?? "0", decimals, config.pairSymbol);
  if (filled === null || threshold === null) {
    return (
      `Curve fill: ${state.curveFilledWei} of ${state.graduationThresholdWei} ` +
      `in the pair token's smallest unit; its decimals are not known${note}.`
    );
  }
  if (cohortSuppressed) return `Curve fill: ${filled} of ${threshold}${note}.`;

  // A string comparison, not a test on the rounded share: at six places a
  // curve holding one unit and a curve holding nothing look the same.
  const holdsSomething = state.curveFilledWei !== null && state.curveFilledWei !== "0";
  const share = formatShareOfOne(state.curveFilledShare, holdsSomething);
  return `Curve fill: ${filled} of ${threshold} (${share} of the threshold)${note}.`;
}

/** True when the cohort figure this entry leads with is not printable as a
    percentage -- no cohort at all, or one the sample does not support. The
    window is the one the headline reads, so the two lines agree about what is
    being withheld. */
export function cohortSuppressed(body: Omit<TokenResponse, "text">): boolean {
  const w = body.cohort?.allTime ?? body.cohort?.h24 ?? null;
  if (w === null) return true;
  return isInsufficient({ rate: w.rate, n: w.launches, insufficient: w.insufficient });
}

/** quoteIn and quoteOut, in the pair token's own units. Same fallback as
    fillSentence: where the decimals are unknown the raw integers are printed
    rather than scaled by a guessed exponent. */
function activityQuoteText(
  a: NonNullable<TokenResponse["activity"]>,
  config: TokenResponse["config"],
): string {
  const decimals = config.pairDecimals;
  const inAmt = decimals === null ? null : formatAmount(a.quoteIn, decimals, config.pairSymbol);
  const outAmt = decimals === null ? null : formatAmount(a.quoteOut, decimals, config.pairSymbol);
  if (inAmt === null || outAmt === null) {
    return (
      `${a.quoteIn} in and ${a.quoteOut} out, in the pair token's smallest unit; ` +
      "its decimals are not known"
    );
  }
  return `${inAmt} in and ${outAmt} out`;
}

/** This token's own indexed curve activity (REPOSITION.md Phase B): its buys,
    its sells, its quote in and out, when it first took a buy, when it last
    saw one, and how many distinct addresses bought in its own launch block --
    the coordination reading, because that costs gas and snipe tax to fake.

    `null` and `0` distinct buyers are kept apart on purpose: null is "that
    block was never indexed", 0 is "it was indexed and nobody bought" -- a
    finding, not a gap. Absent entirely when LEDGE holds no activity row for
    this token, which is a different silence than either. */
export function activitySentences(body: Omit<TokenResponse, "text">): string[] {
  const a = body.activity;
  if (a === null) return [];

  const quote = activityQuoteText(a, body.config);
  const lines: string[] = [
    `Activity, ${a.window.label}: ${formatCount(a.buys)} buys, ${formatCount(a.sells)} sells, ${quote}.`,
  ];

  const first = a.firstBuyAt === null ? "no buy recorded yet" : formatStamp(a.firstBuyAt);
  lines.push(`First buy: ${first}. Last activity: ${formatStamp(a.lastActivityAt)}.`);

  lines.push(
    a.firstBlock === null
      ? "Distinct buyers in the launch's own block: that block was not indexed."
      : `Distinct buyers in the launch's own block (block ${formatCount(a.firstBlock.block)}): ` +
          `${formatCount(a.firstBlock.distinctBuyers)}.`,
  );

  return lines;
}

/** The lookup, as plain text. Rendered by the API, the /t noscript block and
    the Telegram bot from the same objects, so the three cannot diverge. */
export function lookupText(
  body: Omit<TokenResponse, "text">,
  observedMaxSeconds: number | null,
): string {
  const lines: string[] = [
    `${shortAddress(body.address)}${SEP}Pons`,
    `${configLabel(body)}${SEP}${body.state.phaseLabel}`,
    headline(body, observedMaxSeconds),
  ];

  if (body.notice) lines.push(body.notice);

  const aged = freshnessNote(body.freshness);
  const allTime = cohortSentence(
    body.cohort?.allTime ?? null,
    "Launches configured this way, all time",
    aged,
  );
  const h24 = cohortSentence(body.cohort?.h24 ?? null, "In the last 24 hours", aged);
  if (allTime) lines.push(allTime);
  if (h24) lines.push(h24);
  if (!allTime && !h24) {
    lines.push("No cohort has been published for this configuration.");
  }

  const placement = placementSentence(body);
  if (placement) lines.push(placement);

  lines.push(fillSentence(body.state, body.config, cohortSuppressed(body)));
  lines.push(...activitySentences(body));

  if (body.cohort) lines.push(formatStamp(body.cohort.crawledAt));
  if (body.live.stale) {
    lines.push("The live index has not completed a pass in over 5 minutes. Nothing below it is being estimated.");
  }
  lines.push(`${body.links.method}`);

  return lines.join("\n");
}

/** The /number reply: the two figures the fold prints, both with their n. */
export function numberText(
  h24: {
    launches: number;
    graduations: number;
    rate: number | null;
    insufficient: boolean;
    excludingFast: { cutoffSeconds: number; graduations: number; rate: number | null; oneIn: number | null; insufficient: boolean };
  },
  crawledAt: string,
  ageText: string,
  methodUrl: string,
): string {
  const fact = { rate: h24.rate, n: h24.launches, insufficient: h24.insufficient };
  const ef = { rate: h24.excludingFast.rate, n: h24.launches, insufficient: h24.excludingFast.insufficient };
  const cutoff = formatDuration(h24.excludingFast.cutoffSeconds);
  const oneIn =
    !isInsufficient(ef) && h24.excludingFast.oneIn !== null ? ` (${formatOneIn(h24.excludingFast.oneIn)})` : "";
  return [
    `Pons, last 24 hours: ${formatCount(h24.graduations)} of ${formatCount(h24.launches)} launches graduated, ${rateText(fact)}.`,
    `Excluding launches that graduated inside ${cutoff}: ${formatCount(h24.excludingFast.graduations)} of ${formatCount(h24.launches)}, ${rateText(ef)}${oneIn}.`,
    `${formatStamp(crawledAt)}, ${ageText} ago.`,
    methodUrl,
  ].join("\n");
}
