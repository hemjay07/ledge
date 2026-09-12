/* The live board: one row per token with indexed curve activity
   (REPOSITION.md Phase B1).

   THE FILL IS NOW A REAL READING (2026-09-12). Until this date every row's
   fill compared the graduation threshold against an INDEXED net quote --
   quoteIn minus quoteOut, summed off the CurveBuy/CurveSell logs the tick
   folds (worker/src/activity.ts) -- because reading up to a few hundred
   curves live, one eth_call each, would have cost hundreds of subrequests
   against a 40-subrequest budget (worker/src/rpc.ts SUBREQUEST_BUDGET). That
   figure was wrong on wash-traded curves by orders of magnitude: CurveBuy's
   own data layout carries [2]=fee [3]=tax, skimmed off quoteIn before the
   curve's reserve ever sees it, so a curve holding 0.007 ETH could show
   -1.40 ETH indexed, and one holding 2.82 ETH could show 8.65 ETH -- neither
   an upper bound on anything, both worse than no figure at all.

   worker/src/reserve.ts fixes the cost problem, not just the accuracy one:
   Multicall3's aggregate3() reads every curve's realQuoteReserve() and
   graduated() in ONE eth_call, one subrequest, covering the whole board
   population every tick. worker/src/tick.ts writes what comes back into
   token_activity.reserve_wei / reserve_block, and this file reads those two
   columns for `fill` -- never the curve, and never the indexed net quote.
   `netQuoteWei` stays on every row regardless: it is still a true observed
   quantity (this tick's quoteIn minus quoteOut), just no longer what fill is
   measured against.

   NO STATISTIC IS COMPUTED HERE. Counts, sums and one subtraction
   (quoteIn - quoteOut, Class B: two observed quantities about one token, not
   a sample) are everything this file does. scripts/lint-worker.sh does not
   guard this file the way it guards lookup.ts/ladder.ts/text.ts, because the
   arithmetic here is the same kind curve.ts and activity.ts already do
   outside that guard -- BigInt subtraction on one object's own figures, never
   a rate over a population. */

import type { CursorRow } from "./lookup";
import type { PairTokenEntry } from "./buckets";
import { toIso } from "./format";
import { ETH_DECIMALS, ZERO_ADDRESS, pairSymbolOf } from "./decimals";

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
         a.last_activity_ts, a.reserve_wei, a.reserve_block
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
  /** realQuoteReserve(), read from the curve by worker/src/reserve.ts. NULL
      means this token has never been read this way -- not zero, which is a
      real reading a drained or graduated curve can give. */
  reserve_wei: string | null;
  /** The block reserve_wei was read at. NULL exactly when reserve_wei is. */
  reserve_block: number | null;
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
  /** realQuoteReserve(), read straight from the curve -- never the indexed
      net quote. */
  reserveWei: string;
  /** The block reserveWei was read at, so its age is legible next to the
      figure without a second lookup. */
  readAtBlock: number;
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
  /** Null when the launch carries no threshold (enrichment failed) or the
      curve has never been read (reserve_wei still NULL): a guessed or
      indexed-only fill is worse than none, so the row renders no fill bar at
      all rather than a figure that cannot be trusted. */
  fill: BoardFill | null;
  /** The pair token's own units, so a reader sees "4.2 ETH" rather than
      4200000000000000000. Resolved WITHOUT a chain call: the zero address is
      ETH at 18 by the factory's own definition, and anything else comes from
      the pair-token map already in KV. A pair the map has not classified
      resolves to null, and the reader is then shown the raw integer and told
      the units are not known -- decimals.ts's rule, which exists because a
      guessed exponent moves a figure by orders of magnitude. Reading 121 rows
      could never afford a decimals() call each. */
  pairDecimals: number | null;
  pairSymbol: string | null;
  /** The token's own name()/symbol() (2026-09-12, worker/schema.sql's
      `token_meta` cache) -- never the pair token, which pairSymbol is about.
      Null means the read was never attempted or did not decode as a string,
      never that the token has no name. */
  name: string | null;
  symbol: string | null;
}

/** One `pair_token` row, as read straight off worker/schema.sql's read-once
    decimals()/symbol() cache (worker/src/reserve.ts, worker/src/tick.ts,
    2026-09-12). Both fields are independently nullable: a row existing means
    the read was attempted, not that it succeeded. */
export interface DbPairToken {
  decimals: number | null;
  symbol: string | null;
}

/** One `token_meta` row, as read straight off worker/schema.sql's read-once
    name()/symbol() cache for the launched token itself (worker/src/reserve.ts,
    worker/src/tick.ts, 2026-09-12). Both fields are independently nullable,
    same posture as DbPairToken above: a row existing means the read was
    attempted, not that it succeeded. */
export interface DbTokenMeta {
  name: string | null;
  symbol: string | null;
}

/** Builds the lookup pairUnits consults first, from every row `pair_token`
    holds -- loaded ONCE per request (worker/src/index.ts), never once per
    board row. */
export function pairTokenMapFromRows(
  rows: Array<{ address: string; decimals: number | null; symbol: string | null }>,
): Map<string, DbPairToken> {
  const map = new Map<string, DbPairToken>();
  for (const row of rows) {
    map.set(row.address.toLowerCase(), { decimals: row.decimals, symbol: row.symbol });
  }
  return map;
}

/** Same job as pairTokenMapFromRows, for `token_meta` -- loaded ONCE per
    request (worker/src/index.ts), never once per row. */
export function tokenMetaMapFromRows(
  rows: Array<{ address: string; name: string | null; symbol: string | null }>,
): Map<string, DbTokenMeta> {
  const map = new Map<string, DbTokenMeta>();
  for (const row of rows) {
    map.set(row.address.toLowerCase(), { name: row.name, symbol: row.symbol });
  }
  return map;
}

/** Decimals and symbol, checked in a fixed order and never guessed at
    (2026-09-12 -- this is the second source consulted, not the only one:
    see the module comment's "THE FILL IS NOW A REAL READING" for the reserve
    side of the same date's fix):

      1. the zero address is ETH at 18, by the factory's own definition --
         never touches either map
      2. `dbPairTokens`, the live `pair_token` table cache: a HIT here is
         used exactly as read, decimals/symbol and all, even when one or
         both are NULL (a read that was attempted and failed is not a miss
         to fall back past -- see worker/schema.sql's table comment)
      3. `map`, the static registry (data/pair-tokens.json via KV) -- only
         consulted on a genuine table MISS
      4. null, and the caller prints the raw integer and says the units are
         not known

    No RPC, no KV read, no chain call per row -- both maps are loaded once,
    outside this function, by the caller. */
export function pairUnits(
  pairToken: string,
  dbPairTokens: Map<string, DbPairToken> | null,
  map: Record<string, PairTokenEntry> | null,
): { pairDecimals: number | null; pairSymbol: string | null } {
  const address = pairToken.toLowerCase();
  if (address === ZERO_ADDRESS) return { pairDecimals: ETH_DECIMALS, pairSymbol: "ETH" };

  const dbEntry = dbPairTokens?.get(address);
  if (dbEntry) return { pairDecimals: dbEntry.decimals, pairSymbol: dbEntry.symbol };

  const symbol = pairSymbolOf(pairToken, map);
  const decimals = (map?.[address] as (PairTokenEntry & { decimals?: number }) | undefined)
    ?.decimals;
  return { pairDecimals: typeof decimals === "number" ? decimals : null, pairSymbol: symbol };
}

function netQuote(row: BoardDbRow): bigint {
  return BigInt(row.quote_in) - BigInt(row.quote_out);
}

/** Null whenever there is no threshold to measure against, or the curve has
    never been read this way -- reserve_wei/reserve_block are NULL together
    (schema.sql) so one check covers both. A row this returns null for still
    carries netQuoteWei, quoteIn and quoteOut on the row itself; it renders no
    bar, not a wrong one. */
function fillOf(row: BoardDbRow): BoardFill | null {
  if (row.graduation_threshold === null) return null;
  if (row.reserve_wei === null || row.reserve_block === null) return null;
  return {
    graduationThresholdWei: row.graduation_threshold,
    reserveWei: row.reserve_wei,
    readAtBlock: row.reserve_block,
    label: `read from the curve at block ${row.reserve_block}`,
  };
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

/** The token's own name/symbol, straight from `token_meta` -- no fallback map
    exists for these the way pairUnits has the static registry for pair
    tokens, so a table miss (the read was never attempted, or this tick has
    not reached it yet) is simply null, and the row shows the address alone,
    same as before this table existed. */
export function tokenMetaOf(
  token: string,
  dbTokenMeta: Map<string, DbTokenMeta> | null,
): { name: string | null; symbol: string | null } {
  const entry = dbTokenMeta?.get(token.toLowerCase());
  return { name: entry?.name ?? null, symbol: entry?.symbol ?? null };
}

function rowOf(
  row: BoardDbRow,
  toBlock: number,
  nowSeconds: number,
  pairTokens: Record<string, PairTokenEntry> | null,
  dbPairTokens: Map<string, DbPairToken> | null,
  dbTokenMeta: Map<string, DbTokenMeta> | null,
): BoardRow {
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
    fill: fillOf(row),
    ...pairUnits(row.pair_token, dbPairTokens, pairTokens),
    ...tokenMetaOf(row.token, dbTokenMeta),
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
  pairTokens: Record<string, PairTokenEntry> | null = null,
  dbPairTokens: Map<string, DbPairToken> | null = null,
  dbTokenMeta: Map<string, DbTokenMeta> | null = null,
): BoardRow[] {
  const toBlock = cursor ? cursor.last_indexed_block : 0;
  return sortDbRows(dbRows, sort)
    .slice(0, limit)
    .map((row) => rowOf(row, toBlock, nowSeconds, pairTokens, dbPairTokens, dbTokenMeta));
}
