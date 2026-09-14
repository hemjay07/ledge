/* The curve index: ~564 events a minute, folded into one row per token.

   ============================================================================
   WHAT IS STORED, AND WHY IT IS NOT THE EVENTS
   ============================================================================
   CurveBuy and CurveSell run at about 564 events a minute — ~34,000 an hour,
   ~812,000 a day. Stored as rows that is a table LEDGE's plan cannot hold.
   But only ~121 distinct curves see any activity in a five-minute window, so
   folded into per-token counters it is ~121 rows updated per window: bounded
   by the number of live curves rather than by the number of trades, and
   bounded again by the seven-day retention every other table already keeps.

   None of this is a statistic. A count of buys on one token has no
   denominator because there is no population — it is Class B, an observation
   about one object, in the same family as its curve fill and its launch
   block. No rate is derived from these anywhere, and ranking arrives, if it
   arrives, out of `pipeline/stats.py` like every other Class A figure.

   ============================================================================
   DISTINCT BUYERS IN THE LAUNCH'S FIRST BLOCK, WITH NO (token, buyer) TABLE
   ============================================================================
   The obvious schema for "how many distinct addresses bought" is a
   `(token, buyer)` table with a composite primary key — roughly 144,000
   distinct pairs a day, bounded and prunable. It is the right answer to the
   general question, and it is not needed for this one.

   The reading LEDGE wants is narrower: distinct buyers in the launch's OWN
   block. A block is atomic — no window ever splits one — and the tick folds
   each block into the counters exactly once, so every CurveBuy in the launch
   block arrives in the same pass as the TokenLaunched log that names the
   curve. The distinct count is therefore a Set held for the length of one
   fold, and what reaches D1 is the integer it produced. Zero extra rows, zero
   extra retention rule, and no dependence on a second table staying in step
   with the first.

   The cost of that choice is that the reading exists only for launches whose
   own block LEDGE indexed: a launch older than the record has `null` there,
   which is what it should have. A `(token, buyer)` table would not fix that
   either — it would have no rows for those blocks for exactly the same
   reason.

   ============================================================================
   WHY THE COUNTERS FOLD ONLY THE BLOCKS ABOVE THE PREVIOUS CURSOR
   ============================================================================
   Every tick re-reads REORG_OVERLAP_BLOCKS it has already indexed. `launch`
   and `graduation` are keyed on the log's own identity, so the overlap is
   reconciled by clearing the range and writing the fresh logs back. A counter
   has no such key: it cannot be un-added, and folding a re-read block again
   would count every trade in it twice. So the counters advance strictly above
   the previous cursor, and the price is stated rather than hidden — a trade
   in a block that is later reorged away stays in the counts until the row
   ages out. D1 is canonical for nothing, and the alternative is a table of
   812,000 rows a day whose only purpose is to make a subtraction possible. */

import type { CurveTradeLog } from "./pons";

export interface ActivityRow {
  token: string;
  /** The first block these counts cover: the token's own launch block. */
  from_block: number;
  buys: number;
  sells: number;
  /** uint256 sums as decimal strings. 2^63 wei is 9.2 ETH; a curve sees more
      than that over its life, so these never touch a SQLite INTEGER. */
  quote_in: string;
  quote_out: string;
  first_buy_ts: number | null;
  last_activity_ts: number;
  /** Null when the launch block itself was never read, and 0 when it was read
      and nobody bought — which is the finding, not a gap. */
  first_block_buyers: number | null;
  /** The launch's own opening buy (design/FIRSTBUY-TOKEN-BRIEF.md): 1 when a
      CurveBuy sharing the launch's own tx_hash was seen while the launch
      block was folded, 0 when that block was folded and no such buy was
      seen, null when the launch block has never been folded — the same
      null/0/positive shape as first_block_buyers, set under the same
      condition (planActivity's newLaunches loop). */
  launch_tx_buy: number | null;
  /** The earliest CurveBuy on this token's curve whose txHash differs from
      the launch's own, by (block, logIndex). Set once and never again, like
      first_buy_ts — the first outside buy the index ever saw, not the most
      recent. Null until one is seen. */
  first_outside_buy_block: number | null;
  /** The block header timestamp of first_outside_buy_block, never a wall
      clock. Null exactly when first_outside_buy_block is null. */
  first_outside_buy_ts: number | null;
  /** realQuoteReserve(), read from the curve by worker/src/reserve.ts — never
      folded here. Present on this type only so a row read back out of D1
      (worker/src/tick.ts readActivityRows, `SELECT *`) carries it, letting
      the tick preserve a previous reading across a REPLACE that touches the
      other nine columns. Optional: rows this module constructs itself never
      set it. */
  reserve_wei?: string | null;
  /** The block reserve_wei was read at. Same carry-forward purpose as
      reserve_wei, and NULL exactly when it is. */
  reserve_block?: number | null;
}

export interface ActivityInput {
  /** Deduped trades, restricted by the caller to the blocks being folded. */
  trades: CurveTradeLog[];
  /** Lowercase curve address to the token whose launch deployed it. */
  curveToToken: Map<string, string>;
  /** Token to its launch block, for every launch LEDGE holds. */
  launchBlockOf: Map<string, number>;
  /** Token to its launch block, for launches folded in THIS pass — the only
      ones whose first block is in hand. */
  newLaunches: Map<string, number>;
  /** Token to its launch's own tx_hash, for every launch LEDGE holds
      (worker/src/tick.ts resolveCurves, from the launch rows it already
      reads). The only thing that tells the launch's own opening buy apart
      from the first buy from anyone else. */
  launchTxOf: Map<string, string>;
  existing: Map<string, ActivityRow>;
  /** Block-header timestamps for the blocks activityBlocks asked for. */
  timestamps: Map<number, number>;
}

export interface ActivityPlan {
  rows: ActivityRow[];
  /** Curve logs whose curve belongs to no launch LEDGE holds: launched before
      the first indexed block, or evicted. Counted, never guessed at. */
  unattributed: number;
}

interface Grouped {
  trades: CurveTradeLog[];
  maxBlock: number;
  minBuyBlock: number | null;
  /** The earliest CurveBuy, by (block, logIndex), whose txHash differs from
      this token's own launch tx — or, when the launch tx is not known,
      every buy qualifies, since nothing can be excluded without it. */
  outsideMinBuy: { block: number; logIndex: number } | null;
  /** Whether a CurveBuy sharing the launch's own tx_hash was seen among this
      pass's trades. Only meaningful when the launch tx is known. */
  sawLaunchTxBuy: boolean;
}

/** Trades by token, with the two blocks whose headers the counters need, and
    the launch-tx-buy / first-outside-buy readings
    (design/FIRSTBUY-TOKEN-BRIEF.md). A launch's own opening buy shares its
    tx_hash with the launch transaction itself, and a transaction is mined in
    exactly one block — the launch block — so telling the two apart needs no
    block filter of its own, only the tx_hash comparison. */
function group(
  trades: CurveTradeLog[],
  curveToToken: Map<string, string>,
  launchTxOf: Map<string, string> = new Map(),
): { byToken: Map<string, Grouped>; unattributed: number } {
  const byToken = new Map<string, Grouped>();
  let unattributed = 0;
  for (const trade of trades) {
    const token = curveToToken.get(trade.curve);
    if (token === undefined) {
      unattributed += 1;
      continue;
    }
    const held =
      byToken.get(token) ??
      { trades: [], maxBlock: trade.block, minBuyBlock: null, outsideMinBuy: null, sawLaunchTxBuy: false };
    held.trades.push(trade);
    if (trade.block > held.maxBlock) held.maxBlock = trade.block;
    if (trade.side === "buy") {
      if (held.minBuyBlock === null || trade.block < held.minBuyBlock) held.minBuyBlock = trade.block;

      const launchTx = launchTxOf.get(token);
      const isLaunchTx = launchTx !== undefined && trade.txHash.toLowerCase() === launchTx.toLowerCase();
      if (isLaunchTx) {
        held.sawLaunchTxBuy = true;
      } else if (
        held.outsideMinBuy === null ||
        trade.block < held.outsideMinBuy.block ||
        (trade.block === held.outsideMinBuy.block && trade.logIndex < held.outsideMinBuy.logIndex)
      ) {
        held.outsideMinBuy = { block: trade.block, logIndex: trade.logIndex };
      }
    }
    byToken.set(token, held);
  }
  return { byToken, unattributed };
}

/** The block headers the counters need, and no others. One header per curve
    log would be ~564 requests a minute against a 50-subrequest budget; what
    is actually needed is each token's last block, plus its first buy and its
    first outside buy when no earlier pass has recorded one. */
export function activityBlocks(
  trades: CurveTradeLog[],
  curveToToken: Map<string, string>,
  existing: Map<string, ActivityRow>,
  launchTxOf: Map<string, string> = new Map(),
): number[] {
  const { byToken } = group(trades, curveToToken, launchTxOf);
  const blocks = new Set<number>();
  for (const [token, held] of byToken) {
    blocks.add(held.maxBlock);
    if (held.minBuyBlock !== null && (existing.get(token)?.first_buy_ts ?? null) === null) {
      blocks.add(held.minBuyBlock);
    }
    if (
      held.outsideMinBuy !== null &&
      (existing.get(token)?.first_outside_buy_block ?? null) === null
    ) {
      blocks.add(held.outsideMinBuy.block);
    }
  }
  return [...blocks];
}

function seedRow(token: string, fromBlock: number, ts: number): ActivityRow {
  return {
    token,
    from_block: fromBlock,
    buys: 0,
    sells: 0,
    quote_in: "0",
    quote_out: "0",
    first_buy_ts: null,
    last_activity_ts: ts,
    first_block_buyers: null,
    launch_tx_buy: null,
    first_outside_buy_block: null,
    first_outside_buy_ts: null,
  };
}

/** Distinct addresses that bought in the launch's own block. */
function firstBlockBuyers(trades: CurveTradeLog[], launchBlock: number): number {
  const buyers = new Set<string>();
  for (const trade of trades) {
    if (trade.side === "buy" && trade.block === launchBlock) buyers.add(trade.trader);
  }
  return buyers.size;
}

/** Fold one pass's trades onto the rows a previous pass left behind.

    Every launch folded in this pass gets a row whether or not anyone traded
    on it: a launch that took no buys is the finding the record exists to
    hold, and a row saying zero says it, where a missing row says only that
    nothing is known. */
export function planActivity(input: ActivityInput): ActivityPlan {
  const { byToken, unattributed } = group(input.trades, input.curveToToken, input.launchTxOf);
  const rows = new Map<string, ActivityRow>();

  for (const [token, launchBlock] of input.newLaunches) {
    const ts = input.timestamps.get(launchBlock);
    if (ts === undefined) continue; // unreachable: the launch carries its header
    const row = input.existing.get(token) ?? seedRow(token, launchBlock, ts);
    const held = byToken.get(token);
    row.first_block_buyers = firstBlockBuyers(held?.trades ?? [], launchBlock);
    // Same condition as first_block_buyers: only known the pass that folds
    // the launch's own block. See worker/schema.sql's MIGRATION note.
    row.launch_tx_buy = held?.sawLaunchTxBuy ? 1 : 0;
    rows.set(token, row);
  }

  for (const [token, held] of byToken) {
    const lastTs = input.timestamps.get(held.maxBlock);
    const fromBlock = input.launchBlockOf.get(token) ?? held.trades[0]?.block ?? held.maxBlock;
    const row =
      rows.get(token) ??
      input.existing.get(token) ??
      seedRow(token, fromBlock, lastTs ?? input.timestamps.get(fromBlock) ?? 0);

    let quoteIn = BigInt(row.quote_in);
    let quoteOut = BigInt(row.quote_out);
    for (const trade of held.trades) {
      if (trade.side === "buy") {
        row.buys += 1;
        quoteIn += BigInt(trade.quoteIn);
      } else {
        row.sells += 1;
        quoteOut += BigInt(trade.quoteOut);
      }
    }
    row.quote_in = quoteIn.toString();
    row.quote_out = quoteOut.toString();

    if (row.first_buy_ts === null && held.minBuyBlock !== null) {
      row.first_buy_ts = input.timestamps.get(held.minBuyBlock) ?? null;
    }
    if (row.first_outside_buy_block === null && held.outsideMinBuy !== null) {
      row.first_outside_buy_block = held.outsideMinBuy.block;
      row.first_outside_buy_ts = input.timestamps.get(held.outsideMinBuy.block) ?? null;
    }
    if (lastTs !== undefined && lastTs > row.last_activity_ts) row.last_activity_ts = lastTs;
    rows.set(token, row);
  }

  return { rows: [...rows.values()], unattributed };
}
