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
  formatAmount,
  formatCount,
  formatDuration,
  formatOneIn,
  formatStamp,
  isInsufficient,
  minuteOf,
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
  if (body.state.graduated) return "graduated";
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

function cohortSentence(
  window: NonNullable<TokenResponse["cohort"]>["allTime"],
  lead: string,
): string | null {
  if (!window) return null;
  const fact = { rate: window.rate, n: window.launches, insufficient: window.insufficient };
  if (isInsufficient(fact)) {
    return `${lead}: ${rateText(fact)}.`;
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
    `${formatCount(window.excludingFast.graduations)} of ${formatCount(window.launches)}, ${rateText(ef)}${oneIn}.`
  );
}

/* A placement can be missing for two unrelated reasons, and saying the wrong
   one is a small lie that a reader can catch: a token whose launch time IS
   indexed being told it is not. The cause decides the wording. */
function placementSentence(body: Omit<TokenResponse, "text">): string | null {
  const line = placementText(body.placement);
  if (line !== null) return line;
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

   The share is NOT appended, though it would satisfy CONSTRAINTS 3 on its own
   terms (x of y, both shown). The reason is placement: this line sits three
   lines below a cohort line that may read "not enough data (n=12)", and a
   percentage printed inches beneath a suppressed one invites exactly the
   misreading the suppression exists to prevent. The share travels as
   `curveFilledShare`, which is where the bar is drawn from, and the bar has
   both quantities beside it.

   Where the decimals are unknown the integer is printed unchanged and the
   sentence says the units are not known. An assumed exponent would move the
   figure by orders of magnitude, which is worse than an unreadable one. */
export function fillSentence(
  state: TokenResponse["state"],
  config: TokenResponse["config"],
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
  return `Curve fill: ${filled} of ${threshold}${note}.`;
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

  const allTime = cohortSentence(body.cohort?.allTime ?? null, "Launches configured this way, all time");
  const h24 = cohortSentence(body.cohort?.h24 ?? null, "In the last 24 hours");
  if (allTime) lines.push(allTime);
  if (h24) lines.push(h24);
  if (!allTime && !h24) {
    lines.push("No cohort has been published for this configuration.");
  }

  const placement = placementSentence(body);
  if (placement) lines.push(placement);

  lines.push(fillSentence(body.state, body.config));

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
