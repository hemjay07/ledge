/* The live board: one row per token with indexed curve activity
   (REPOSITION.md Phase B1).

   THIS IS THE OPPOSITE FILE FROM lookup.ts. lookup.ts reads one token and
   can afford a live RPC call; this reads up to a few hundred at once and
   cannot -- 121 live curves at three reads each would be 363 subrequests
   against a free-plan budget of 50 (REPOSITION.md "What has to be built").
   So every row here comes from D1 alone: the curve is never read, and the
   fill this board reports is an INDEXED figure, not the live one.

   WHY THE INDEXED FIGURE IS NOT THE CURVE'S FIGURE. worker/src/curve.ts reads
   realQuoteReserve() directly and is exact. This board instead sums quoteIn
   and quoteOut off the CurveBuy/CurveSell logs the tick already folded
   (worker/src/activity.ts) and nets them. But CurveBuy's own data layout
   carries [2]=fee [3]=tax -- the curve skims both off quoteIn before the
   reserve sees it -- so the indexed net quote is always at or above the
   curve's real reserve, never below it, and never equal to it once either fee
   or tax is nonzero. Every row says so in its own `fill.label`, not only in
   this comment, because a reader who never opens the source must be able to
   tell the two figures apart from the payload alone.

   NO STATISTIC IS COMPUTED HERE. Counts, sums and one subtraction
   (quoteIn - quoteOut, Class B: two observed quantities about one token, not
   a sample) are everything this file does. scripts/lint-worker.sh does not
   guard this file the way it guards lookup.ts/ladder.ts/text.ts, because the
   arithmetic here is the same kind curve.ts and activity.ts already do
   outside that guard -- BigInt subtraction on one object's own figures, never
   a rate over a population. */

import type { CursorRow } from "./lookup";
import { toIso } from "./format";

/* Every key orders biggest-value-first, so the direction never has to be
   guessed at: most buys, most recent activity, greatest age, largest net
   quote, highest launch block. `age` therefore puts the OLDEST launch first,
   which is the honest reading of that word and the opposite of what a reader
   browsing for something new wants -- hence `newest`, which orders on the
   launch block itself. Both are orderings of a shown quantity, which is what
   CONSTRAINTS 1 permits; neither is a judgement about which token is
   better. */
export const BOARD_SORT_KEYS = ["buys", "lastActivity", "age", "netQuote", "newest"] as const;
export type BoardSortKey = (typeof BOARD_SORT_KEYS)[number];

export function isBoardSortKey(value: string): value is BoardSortKey {
  return (BOARD_SORT_KEYS as readonly string[]).includes(value);
}

/* One row per token with recent indexed activity: the earliest launch row
   for that token (EXISTS/subquery, not a bare join, for the same reason
   index.ts's old board avoided one -- a token can hold more than one launch
   row while a reorg is being reconciled, and joining would print it twice),
   its curve counters, and whether any graduation has been seen. Bounded at
   500 by recency before this file sorts and index.ts trims to 200: the
   population this reads is the ~121 curves with activity in a short window
   (REPOSITION.md), and 500 leaves headroom without inviting a full-table
   scan of everything the 7-day retention window still holds. */
export const BOARD_QUERY = `
  SELECT l.token, l.pair_class, l.pair_token, l.creator_tax_bps, l.graduation_threshold,
         l.block, l.ts,
         EXISTS (SELECT 1 FROM graduation g WHERE g.token = l.token) AS graduated,
         a.from_block, a.buys, a.sells, a.quote_in, a.quote_out, a.first_block_buyers,
         a.last_activity_ts
    FROM token_activity a
    JOIN launch l
      ON l.token = a.token
     AND l.block = (SELECT MIN(l2.block) FROM launch l2 WHERE l2.token = a.token)
   ORDER BY a.last_activity_ts DESC
   LIMIT 500
`;

export interface BoardDbRow {
  token: string;
  pair_class: string;
  pair_token: string;
  creator_tax_bps: number | null;
  graduation_threshold: string | null;
  block: number;
  ts: number;
  graduated: number;
  from_block: number;
  buys: number;
  sells: number;
  quote_in: string;
  quote_out: string;
  first_block_buyers: number | null;
  last_activity_ts: number;
}

export interface BoardWindow {
  fromBlock: number;
  toBlock: number;
  label: string;
  /** True when this launch's own block predates what the index holds -- the
      same signal activity.ts already carries as `first_block_buyers === null`
      (worker/src/activity.ts: "Null when the launch block itself was never
      read"). A row this counts over is missing whatever traded before
      `fromBlock`, and a count that looks complete without saying so is the
      denominator defect CONSTRAINTS 3 exists to catch. */
  partial: boolean;
}

export interface BoardFill {
  graduationThresholdWei: string;
  label: string;
}

export interface BoardRow {
  token: string;
  pairClass: string;
  pairToken: string;
  creatorTaxBps: number | null;
  launchBlock: number;
  ageSeconds: number;
  graduated: boolean;
  buys: number;
  sells: number;
  quoteIn: string;
  quoteOut: string;
  /** quoteIn - quoteOut, always shown regardless of whether the threshold to
      measure it against is known. */
  netQuoteWei: string;
  firstBlockBuyers: number | null;
  lastActivityAt: string;
  window: BoardWindow;
  /** Null when the launch carries no threshold (enrichment failed): a guessed
      fill is worse than none, so the row renders no fill at all. */
  fill: BoardFill | null;
}

/** Every reader of this figure is owed the same sentence the module comment
    carries, in the payload itself: counted from indexed trades, not read
    from the curve, and an upper bound on the curve's real reserve because the
    curve skims fee and creator tax off quoteIn (CurveBuy data words
    [2]=fee [3]=tax) before the reserve ever sees it. */
export const NET_QUOTE_LABEL =
  "indexed net quote (quote in minus quote out), counted from indexed trades, not read from the curve. " +
  "The curve itself skims a fee and the creator tax off quote in before its reserve sees it, so this figure " +
  "is an upper bound on the curve's real reserve, not the reading /t/{address} shows.";

function netQuote(row: BoardDbRow): bigint {
  return BigInt(row.quote_in) - BigInt(row.quote_out);
}

function windowOf(row: BoardDbRow, toBlock: number): BoardWindow {
  const partial = row.first_block_buyers === null;
  const base = `counted over blocks ${row.from_block} to ${toBlock}`;
  return {
    fromBlock: row.from_block,
    toBlock,
    label: partial
      ? `${base} -- partial: this launch's own block predates LEDGE's indexed record, so trades before block ${row.from_block} are not counted`
      : base,
    partial,
  };
}

function rowOf(row: BoardDbRow, toBlock: number, nowSeconds: number): BoardRow {
  return {
    token: row.token,
    pairClass: row.pair_class,
    pairToken: row.pair_token,
    creatorTaxBps: row.creator_tax_bps,
    launchBlock: row.block,
    ageSeconds: Math.max(0, nowSeconds - row.ts),
    graduated: row.graduated === 1,
    buys: row.buys,
    sells: row.sells,
    quoteIn: row.quote_in,
    quoteOut: row.quote_out,
    netQuoteWei: netQuote(row).toString(),
    firstBlockBuyers: row.first_block_buyers,
    lastActivityAt: toIso(row.last_activity_ts),
    window: windowOf(row, toBlock),
    fill:
      row.graduation_threshold === null
        ? null
        : { graduationThresholdWei: row.graduation_threshold, label: NET_QUOTE_LABEL },
  };
}

/** Highest value first, on every key -- the most buys, the most recent
    activity, the oldest launch (largest age), the largest indexed net quote.
    One convention across all four so a reader never has to learn a second
    direction for one column. */
function sortDbRows(rows: BoardDbRow[], sort: BoardSortKey): BoardDbRow[] {
  const sorted = [...rows];
  switch (sort) {
    case "buys":
      sorted.sort((a, b) => b.buys - a.buys);
      break;
    case "lastActivity":
      sorted.sort((a, b) => b.last_activity_ts - a.last_activity_ts);
      break;
    case "age":
      sorted.sort((a, b) => a.ts - b.ts);
      break;
    case "newest":
      sorted.sort((a, b) => b.block - a.block);
      break;
    case "netQuote":
      sorted.sort((a, b) => {
        const diff = netQuote(b) - netQuote(a);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      });
      break;
  }
  return sorted;
}

export function buildBoardRows(
  dbRows: BoardDbRow[],
  cursor: CursorRow | null,
  nowSeconds: number,
  sort: BoardSortKey,
  limit = 200,
): BoardRow[] {
  const toBlock = cursor ? cursor.last_indexed_block : 0;
  return sortDbRows(dbRows, sort)
    .slice(0, limit)
    .map((row) => rowOf(row, toBlock, nowSeconds));
}
