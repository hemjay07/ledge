/* Curve fill — how far one launch got toward graduation.

   THE CURVE IS NOT SHARED. PONS_CONTRACTS.md called
   0xF6e86610771ee7838cABE2f9c376265CA25EF04c "the shared bonding curve"; that
   is wrong, and RESEARCH-PHASE2-3.md section 0 corrects it. Every launch
   deploys its own PonsV2BondingCurve with its pair token and threshold baked
   in as immutables — 5,900 launches in one day, 5,900 distinct curve
   addresses, and 0xF6e8… is simply CHIT's own curve, which is where the
   address in the old note came from. So the curve to read is the one in the
   token's own TokenLaunched event (getLaunchedToken word 1), never a constant.

   The corollary matters more than the reading: curve logs cannot be filtered
   by address, because there is no address to filter by. Any future indexer of
   CurveBuy/CurveSell filters on topic0 alone and reads the emitting curve out
   of each log's own `address` field. The factory-address filter on
   TokenLaunched and PoolGraduated is a different thing and stays.

   WHY THE QUOTE SIDE. There are two fills and they disagree: the quote side,
   realQuoteReserve/graduationThreshold, and the token side,
   1 - sellableTokens/(launchSupply - reservedTokens). The curve is constant
   product, so the token side runs ahead — 53.45% against 73.92% on the same
   token at the same block in the research sample. Both reach 100% at the same
   instant, and graduation actually triggers on the token side. We report the
   QUOTE side because it is the figure denominated in the pair token that a
   reader recognises ("2.245 of 4.2 ETH"), and because it is the one the
   PoolGraduated event independently confirms. Reporting both would be two
   bars for one fact, and picking the higher one would be flattery.

   THE THRESHOLD IS NOT 4.2 ETH. It is per pair token: 4.2e18 for ETH, 8.09e9
   for USDG (6 decimals), 79.98e18 for another ERC-20 — all confirmed. It is
   read from the curve itself, and the event's own value is the fallback.

   THE DRAIN. After graduation the curve is emptied: realQuoteReserve,
   trackedQuote, trackedTokens and sellableTokens all read 0. A naive ratio on
   a graduated token therefore renders 0%, not 100% — the exact opposite of
   the truth. graduated() is called FIRST for that reason, and a graduated
   curve is pinned to a full bar with a note saying where the figure came
   from. */

import type { RpcClient } from "./rpc";

/** No-arg view selectors on PonsV2BondingCurve (RESEARCH-PHASE2-3.md A2,
    computed with pipeline/keccak.py and cross-checked against the deployed
    dispatcher's jump table). */
export const SELECTOR_GRADUATED = "0xe7c2b772";
export const SELECTOR_REAL_QUOTE_RESERVE = "0x4f1f58fd";
export const SELECTOR_GRADUATION_THRESHOLD = "0x8b0bc501";

export interface CurveFill {
  /** Quote raised so far, net of fees and creator tax, in the pair token's
      smallest unit. Equal to the threshold once graduated. Null when the read
      that would have supplied it did not come back. */
  filledWei: string | null;
  /** The threshold it is measured against, same unit, read from the curve. */
  thresholdWei: string | null;
  /** filledWei over thresholdWei, to six places. A Class B ratio of two
      observed quantities against one constant, not a sample statistic — it is
      rendered as a bar with both figures beside it, never as a lone
      percentage.

      NULL WHENEVER ANY OF THE THREE READS FAILED. A batch can fail one item
      and answer the other two, and the drained-curve case makes that silence
      dangerous: a graduated curve holds nothing, so a failed graduated() with
      an answered reserve of zero produced 0.0%, which is the opposite of what
      happened. A share the reads do not support is not published at all, and
      `note` says which read is missing. */
  share: number | null;
  /** Non-null whenever the reading needs a word to be honest: the graduated
      case, where the curve holds nothing and the figure is the threshold it
      filled to; a reserve standing above the threshold; and a read that did
      not come back. */
  note: string | null;
}

export const FILL_UNAVAILABLE = "fill not available";
/** What each of the three reads would have told us, in words. A note names
    the missing fact, never the selector: a reader is owed the fact. */
export const READ_WORDS: Record<string, string> = {
  [SELECTOR_GRADUATED]: "whether it had graduated",
  [SELECTOR_REAL_QUOTE_RESERVE]: "the quote it has raised",
  [SELECTOR_GRADUATION_THRESHOLD]: "the threshold it is measured against",
};
/** "the curve did not answer whether it had graduated, so the fill is not
    known". No figure travels with it, because none of them is supported. */
export function fillReadFailed(missing: readonly string[]): string {
  const words = missing.map((selector) => READ_WORDS[selector] ?? selector);
  const listed =
    words.length === 1
      ? (words[0] as string)
      : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
  return `the curve did not answer ${listed}, so the fill is not known`;
}
/** A real reading, taken between the buy that crossed the threshold and the
    graduation that empties the curve. It is above 100% and must never be
    printed as a bare percentage: the word is what stops it reading as a
    broken instrument. */
export const FILL_OVER_THRESHOLD =
  "the reserve stands above the threshold; the curve had not been emptied when it was read";
export const FILL_OVER_THRESHOLD_CARD = "reserve above the threshold when read";
export const FILL_GRADUATED =
  "the curve was emptied at graduation; this is the threshold it filled to, not a live balance";
/** The same fact, short enough for the card's one line. Kept beside the long
    form so a reviewer reads them together and neither drifts. */
export const FILL_GRADUATED_CARD = "filled to the threshold at graduation";

/** A note in the form the card has room for. Every note reaches the card:
    a figure whose word was dropped in the layout is a bare figure. */
export function fillNoteShort(note: string): string {
  if (note === FILL_GRADUATED) return FILL_GRADUATED_CARD;
  if (note === FILL_OVER_THRESHOLD) return FILL_OVER_THRESHOLD_CARD;
  return note;
}

function decodeUint(result: unknown): bigint | null {
  if (typeof result !== "string" || result.length < 66) return null;
  try {
    return BigInt(result.slice(0, 66));
  } catch {
    return null;
  }
}

/** Six places, matching the precision number.json carries, rounded rather
    than truncated so 2.245000707691451167 of 4.2 reads 0.534524 and not
    0.534523. Scaled integer division keeps the wei exact until the last step. */
function shareOf(filled: bigint, threshold: bigint): number {
  const SCALE = 1_000_000_000_000n;
  const scaled = Number((filled * SCALE) / threshold) / Number(SCALE);
  return Number(scaled.toFixed(6));
}

/**
 * @param rpc            chain access
 * @param curve          the launch's OWN curve, from getLaunchedToken word 1
 * @param eventThresholdWei  graduationThreshold from TokenLaunched word 2,
 *                           used only if the curve declines to answer
 */
export async function curveFill(
  rpc: RpcClient,
  curve: string,
  eventThresholdWei: string,
): Promise<CurveFill | null> {
  // One batch, one round trip, same envelope as everything else.
  const selectors = [
    SELECTOR_GRADUATED,
    SELECTOR_REAL_QUOTE_RESERVE,
    SELECTOR_GRADUATION_THRESHOLD,
  ];
  const results = await rpc.callBatch(
    selectors.map((data) => ({ method: "eth_call", params: [{ to: curve, data }, "latest"] })),
  );

  /* A batch item that failed carries no `result` at all, and
     indexBatchResponse hands back `undefined` for it. That is a different
     thing from a curve that answered something undecodable, which is a
     silence we have documented fallbacks for -- so the two are not
     conflated. */
  const missing = selectors.filter((_, i) => results[i] === undefined);

  const graduatedWord = decodeUint(results[0]);
  const filled = decodeUint(results[1]);
  const fromCurve = decodeUint(results[2]);

  // An address that answers none of the three is not a Pons curve, and a
  // fill invented for it would be worse than no fill.
  if (graduatedWord === null && filled === null && fromCurve === null) return null;

  let threshold = fromCurve;
  if (threshold === null || threshold === 0n) {
    try {
      const fallback = BigInt(eventThresholdWei);
      threshold = fallback > 0n ? fallback : null;
    } catch {
      threshold = null;
    }
  }

  /* No share, and a word saying which fact is missing. The quantities that
     DID come back still travel: they are observations, and one of them being
     unreadable does not make the other untrue. */
  if (missing.length > 0) {
    return {
      filledWei: filled === null ? null : filled.toString(),
      thresholdWei: threshold === null ? null : threshold.toString(),
      share: null,
      note: fillReadFailed(missing),
    };
  }

  if (threshold === null) return null;

  // graduated() first: the curve drains on graduation, so the live balance
  // below would read zero for a token that filled all the way.
  if (graduatedWord === 1n) {
    return {
      filledWei: threshold.toString(),
      thresholdWei: threshold.toString(),
      share: 1,
      note: FILL_GRADUATED,
    };
  }

  if (filled === null) {
    return {
      filledWei: null,
      thresholdWei: threshold.toString(),
      share: null,
      note: fillReadFailed([SELECTOR_REAL_QUOTE_RESERVE]),
    };
  }

  return {
    filledWei: filled.toString(),
    thresholdWei: threshold.toString(),
    share: shareOf(filled, threshold),
    note: filled > threshold ? FILL_OVER_THRESHOLD : null,
  };
}
