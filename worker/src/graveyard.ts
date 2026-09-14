/* The graveyard: launches LEDGE has indexed that took zero buys, at least 72
   hours after their own launch block (the task that names this file).

   WHY THIS IS THE SAME SHAPE AS board.ts. It reads token_activity and launch
   from D1 alone, for the same reason board.ts does -- there is no budget to
   read hundreds of curves live, and there is no need to: a token that has
   taken zero buys has nothing on its curve for a live read to disagree with
   the index about. No statistic is computed here. Every figure is a count or
   an age about one token (Class B), or a count of rows in D1 (the index's own
   scope, stated so the population this reads is never mistaken for "every
   dead launch on pons").

   ============================================================================
   THE SCOPE CAVEAT, AND WHY IT IS NOT OPTIONAL
   ============================================================================
   worker/src/activity.ts folds a row for a launch only when that launch's own
   block is read by a tick -- either as a brand-new launch, or later if a
   trade on it arrives while its curve is already known. A launch whose entire
   life happened before LEDGE started recording curve activity has no row here
   at all, and its absence means "not measured", never "took a buy". A count
   that looks complete without saying so is the denominator defect CONSTRAINTS
   3 exists to catch, so every response and every bot post carries `scope`:
   how many launches the activity index currently holds a row for, and the
   oldest one among them -- read live off the same table the graveyard itself
   queries, never a hand-maintained date that could drift out of step with it. */

import { shortAddress } from "./format";
import type { CursorRow } from "./lookup";
import type { PairTokenEntry } from "./buckets";
import { pairUnits, tokenMetaOf, type DbPairToken, type DbTokenMeta } from "./board";
import { toIso } from "./format";

/** 72 hours. A launch younger than this has not had the window the finding
    (REPOSITION.md: 93.5% of launches took no buys, sampled 2026-09-08) was
    measured over, so it is excluded rather than shown as if it were done. */
export const GRAVEYARD_AGE_SECONDS = 72 * 60 * 60;

export const GRAVEYARD_SORT_KEYS = ["age", "newest"] as const;
export type GraveyardSortKey = (typeof GRAVEYARD_SORT_KEYS)[number];

export function isGraveyardSortKey(value: string): value is GraveyardSortKey {
  return (GRAVEYARD_SORT_KEYS as readonly string[]).includes(value);
}

/** Every candidate the graveyard could ever show: a launch with a
    token_activity row of zero buys, whatever its age -- the age gate is
    applied by the caller with a bound `nowSeconds`, not baked into the SQL as
    a literal, so a fixture never has to be re-dated to stay a fixture. */
export const GRAVEYARD_QUERY = `
  SELECT l.token, l.pair_class, l.pair_token, l.creator_tax_bps, l.block, l.ts,
         a.from_block, a.sells, a.first_block_buyers, a.last_activity_ts
    FROM token_activity a
    JOIN launch l
      ON l.token = a.token
     AND l.block = (SELECT MIN(l2.block) FROM launch l2 WHERE l2.token = a.token)
   WHERE a.buys = 0
   ORDER BY l.ts ASC
   LIMIT 500
`;

/** The activity index's own scope: how many launches it holds a row for at
    all (any buy count), and the oldest one's own launch timestamp. Read from
    the same two tables the graveyard itself joins, so the caveat can never
    disagree with the query it is describing. */
export const GRAVEYARD_SCOPE_QUERY = `
  SELECT COUNT(*) AS indexed_launches, MIN(l.ts) AS earliest_ts
    FROM token_activity a
    JOIN launch l
      ON l.token = a.token
     AND l.block = (SELECT MIN(l2.block) FROM launch l2 WHERE l2.token = a.token)
`;

export interface GraveyardDbRow {
  token: string;
  pair_class: string;
  pair_token: string;
  creator_tax_bps: number | null;
  block: number;
  ts: number;
  from_block: number;
  sells: number;
  first_block_buyers: number | null;
  last_activity_ts: number;
}

export interface GraveyardScopeDbRow {
  indexed_launches: number;
  earliest_ts: number | null;
}

export interface GraveyardWindow {
  fromBlock: number;
  toBlock: number;
  label: string;
  /** Same reading as board.ts's BoardWindow.partial: true when this launch's
      own block predates what the index holds, so what a "0 buys" row reports
      is itself only partial -- trades before `fromBlock` are not in it. */
  partial: boolean;
}

export interface GraveyardRow {
  token: string;
  pairClass: string;
  pairToken: string;
  creatorTaxBps: number | null;
  launchBlock: number;
  ageSeconds: number;
  buys: 0;
  sells: number;
  /** Null when the launch's own block was never indexed; 0 when it was
      indexed and nobody bought in it. The two are never collapsed into one
      cell -- worker/src/activity.ts carries the full reasoning. */
  firstBlockBuyers: number | null;
  lastActivityAt: string;
  window: GraveyardWindow;
  pairDecimals: number | null;
  pairSymbol: string | null;
  /** The token's own name()/symbol() (2026-09-12, worker/schema.sql's
      `token_meta` cache) -- see board.ts's BoardRow for the same field. */
  name: string | null;
  symbol: string | null;
}

export interface GraveyardScope {
  ageCutoffSeconds: number;
  /** How many launches the activity index currently holds a row for, at any
      buy count -- the population this whole page can see, never the
      population of every launch pons has ever hosted. */
  indexedLaunches: number;
  /** The oldest launch the index holds a row for, or null when it holds
      none. A launch older than this was never measured, not found clean. */
  earliestIndexedLaunchAt: string | null;
  label: string;
}

function windowOf(row: GraveyardDbRow, toBlock: number): GraveyardWindow {
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

function rowOf(
  row: GraveyardDbRow,
  toBlock: number,
  nowSeconds: number,
  pairTokens: Record<string, PairTokenEntry> | null,
  dbPairTokens: Map<string, DbPairToken> | null,
  dbTokenMeta: Map<string, DbTokenMeta> | null,
): GraveyardRow {
  return {
    token: row.token,
    pairClass: row.pair_class,
    pairToken: row.pair_token,
    creatorTaxBps: row.creator_tax_bps,
    launchBlock: row.block,
    ageSeconds: Math.max(0, nowSeconds - row.ts),
    buys: 0,
    sells: row.sells,
    firstBlockBuyers: row.first_block_buyers,
    lastActivityAt: toIso(row.last_activity_ts),
    window: windowOf(row, toBlock),
    ...pairUnits(row.pair_token, dbPairTokens, pairTokens),
    ...tokenMetaOf(row.token, dbTokenMeta),
  };
}

/** Oldest-first on age (largest age first, same "highest value first"
    convention board.ts uses on every key), or the newest launch block first.
    Both order a column every row already shows -- CONSTRAINTS 1. */
function sortDbRows(rows: GraveyardDbRow[], sort: GraveyardSortKey): GraveyardDbRow[] {
  const sorted = [...rows];
  if (sort === "newest") {
    sorted.sort((a, b) => b.block - a.block);
  } else {
    sorted.sort((a, b) => a.ts - b.ts);
  }
  return sorted;
}

/** Only launches whose own block is at least GRAVEYARD_AGE_SECONDS old make
    the list -- a launch that has not yet had 72 hours to take a buy is not
    yet a graveyard candidate, it is simply young. */
export function buildGraveyardRows(
  dbRows: GraveyardDbRow[],
  cursor: CursorRow | null,
  nowSeconds: number,
  sort: GraveyardSortKey,
  limit = 200,
  pairTokens: Record<string, PairTokenEntry> | null = null,
  dbPairTokens: Map<string, DbPairToken> | null = null,
  dbTokenMeta: Map<string, DbTokenMeta> | null = null,
): GraveyardRow[] {
  const toBlock = cursor ? cursor.last_indexed_block : 0;
  const eligible = dbRows.filter((row) => nowSeconds - row.ts >= GRAVEYARD_AGE_SECONDS);
  return sortDbRows(eligible, sort)
    .slice(0, limit)
    .map((row) => rowOf(row, toBlock, nowSeconds, pairTokens, dbPairTokens, dbTokenMeta));
}

export function buildGraveyardScope(scopeRow: GraveyardScopeDbRow | null): GraveyardScope {
  const indexedLaunches = scopeRow?.indexed_launches ?? 0;
  const earliest = scopeRow?.earliest_ts ?? null;
  return {
    ageCutoffSeconds: GRAVEYARD_AGE_SECONDS,
    indexedLaunches,
    earliestIndexedLaunchAt: earliest === null ? null : toIso(earliest),
    label:
      indexedLaunches === 0
        ? "LEDGE's activity index holds no launches yet. This list is empty because nothing has been measured, not because every launch took a buy."
        : `LEDGE's activity index currently holds a record for ${indexedLaunches} launches, the oldest launched ${earliest === null ? "an unknown time" : toIso(earliest)}. A launch outside that record is not counted here at all: its absence means not measured, never a launch that took a buy.`,
  };
}

/* ============================================================================
   THE BOT POST
   ============================================================================
   One message per tick that finds new entries, never one message per token:
   a burst of 40 separate posts is the resource the rate limiter in telegram.ts
   already exists to protect, and reads worse besides. Facts only, in the order
   a reader can check them: pair, creator tax, age, sells, first-block buyers.
   No emoji, no verdict, no word claiming to know why -- "0 buys in 72 hours"
   is the whole claim, stated once at the top and never repeated as a label on
   each line. */

export interface GraveyardCandidate {
  token: string;
  pairClass: string;
  creatorTaxBps: number | null;
  ageSeconds: number;
  sells: number;
  firstBlockBuyers: number | null;
}

export function graveyardRowsToCandidates(rows: GraveyardRow[]): GraveyardCandidate[] {
  return rows.map((row) => ({
    token: row.token,
    pairClass: row.pairClass,
    creatorTaxBps: row.creatorTaxBps,
    ageSeconds: row.ageSeconds,
    sells: row.sells,
    firstBlockBuyers: row.firstBlockBuyers,
  }));
}

/** Candidates never posted before. Filtered against the set of tokens
    graveyard_posted already holds -- the persistence gate that makes "never
    repeat a launch" true across ticks rather than only within one. */
export function selectNewGraveyardEntries(
  candidates: GraveyardCandidate[],
  alreadyPosted: ReadonlySet<string>,
): GraveyardCandidate[] {
  return candidates.filter((candidate) => !alreadyPosted.has(candidate.token));
}


/* 2026-09-14: one line a reader can scan. The age is implied (every entry
   is past 72 h by definition) and the sells count on a curve nobody bought
   into confuses more than it tells, so both are gone; the launch-block
   buyers stay, because that is the coordination reading. */
function candidateLine(candidate: GraveyardCandidate): string {
  const tax = candidate.creatorTaxBps === null ? "tax not read" : `${candidate.creatorTaxBps / 100}% tax`;
  const buyers =
    candidate.firstBlockBuyers === null
      ? "launch block not indexed"
      : `${candidate.firstBlockBuyers} ${candidate.firstBlockBuyers === 1 ? "buyer" : "buyers"} in the launch block`;
  // The short form on the line; the full address is the link beneath it.
  return `${shortAddress(candidate.token)} · ${PAIR_WORDS[candidate.pairClass] ?? candidate.pairClass} pair · ${tax} · ${buyers}`;
}

const PAIR_WORDS: Record<string, string> = { eth: "ETH", stable: "stablecoin", stock: "tokenized stock", other: "other" };

/** Null when there is nothing new to post -- the caller must not send an
    empty message, and this makes the caller's "was there anything" check the
    same as this function's own return value rather than a second reading of
    the same list. */
/** Telegram refuses a message over 4,096 characters, silently from the
    caller's side. The entries are posted in chunks under that, each with
    its own heading, and each entry links to its own page (2026-09-14). */
export const TELEGRAM_MAX_CHARS = 4096;

export function graveyardPosts(candidates: GraveyardCandidate[], siteOrigin: string): string[] {
  if (candidates.length === 0) return [];
  const heading =
    candidates.length === 1
      ? "1 launch took no buys in its first 72 hours."
      : `${candidates.length} launches took no buys in their first 72 hours.`;
  const lines = candidates.map((c) => `${candidateLine(c)}\n${siteOrigin}/t/${c.token}`);
  const footer = `${siteOrigin}/graveyard`;
  const posts: string[] = [];
  let current: string[] = [heading, ""];
  const length = (parts: string[]) => parts.join("\n").length + 1 + footer.length + 1;
  for (const line of lines) {
    if (length([...current, line]) > TELEGRAM_MAX_CHARS && current.length > 2) {
      posts.push([...current, "", footer].join("\n"));
      current = [`${heading} (continued)`, ""];
    }
    current.push(line);
  }
  posts.push([...current, "", footer].join("\n"));
  return posts;
}

export function graveyardPostText(
  candidates: GraveyardCandidate[],
  siteOrigin: string,
): string | null {
  // One builder since 2026-09-14: the first chunk of graveyardPosts, which
  // links every entry to its own page. Null when there is nothing to post.
  return graveyardPosts(candidates, siteOrigin)[0] ?? null;
}
