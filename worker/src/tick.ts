/* The minute indexer.

   It ingests two event topics from the Pons factory and writes what it sees.
   It aggregates nothing: the Number is computed hourly by pipeline/stats.py,
   and this table exists only to answer "when exactly did this token launch".
   D1 is canonical for nothing and wiping it costs at most a re-index of the
   retention window.

   Failure posture, matching crawl.py: any throw leaves last_indexed_block
   exactly where it was, records the error, increments the failure count, and
   returns. There is no aggressive retry -- the next tick is 60 seconds away
   and simply covers a wider window. A 429 is the same: the cursor holds.

   Reorg overlap: every tick re-reads the last REORG_OVERLAP_BLOCKS blocks it
   already indexed. Re-delivered logs are deduped on (txHash, logIndex) in
   memory and by the token primary key in SQLite, so a re-read is free and a
   short reorg cannot drop a launch. */

import type { Env } from "./env";
import { RpcClient, LOG_WINDOW_BLOCKS, MAX_BATCH, RpcUnavailable } from "./rpc";
import {
  TOPIC_TOKEN_LAUNCHED,
  TOPIC_POOL_GRADUATED,
  TOPIC_CURVE_BUY,
  TOPIC_CURVE_SELL,
  decodeCurveTrade,
  type CurveTradeLog,
  SELECTOR_GET_LAUNCHED_TOKEN,
  decodeLaunchedToken,
  decodePoolGraduated,
  decodeTokenLaunched,
  encodeAddressCall,
  type PoolGraduatedLog,
  type RawLog,
  type TokenLaunchedLog,
} from "./pons";
import { pairClassOf } from "./buckets";
import { activityBlocks, planActivity, type ActivityRow } from "./activity";
import { loadPairTokens } from "./numberFile";
import { readReservesAndPairTokens, RESERVE_POPULATION_QUERY, type CurveTarget } from "./reserve";
import { ZERO_ADDRESS } from "./decimals";
import {
  GRAVEYARD_QUERY,
  buildGraveyardRows,
  graveyardPostText,
  graveyardRowsToCandidates,
  selectNewGraveyardEntries,
  type GraveyardDbRow,
} from "./graveyard";
import { sendMessage, withinLimits } from "./telegram";

/** One minute of chain. The cron is `* * * * *` and Robinhood Chain runs at
    about 0.1 s a block, so this is both how far a tick advances and how far
    back a cold cursor starts -- one quantity, one constant. */
export const BLOCKS_PER_TICK = 600;
/** Where a cold cursor starts: one minute of chain behind the head. */
export const COLD_START_BLOCKS = BLOCKS_PER_TICK;
/** Blocks re-read on every tick so a short reorg cannot drop a launch.

    It was 200 -- a third of one tick's own advance, which is not an overlap
    at all: a reorg reaching back further than the blocks this pass happened
    to re-read was invisible to it. Two ticks' advance is the floor: whatever
    the previous pass wrote is inside the range the next pass re-reads and
    reconciles against the chain. */
export const REORG_OVERLAP_BLOCKS = BLOCKS_PER_TICK * 2;
/** A bounded catch-up: an outage must not produce a tick that blows the
    subrequest budget. What it does not reach, the next minute reaches.

    Sized for the free plan's 50 subrequests per invocation, measured live:
    5,000 blocks (~1,200 launches) needed 10 log calls plus ~48 header and
    factory-view batches and died with "Too many subrequests". 1,800 blocks
    is three ticks of chain: 4 log calls, ~8 header batches, ~8 factory
    batches, one KV read -- about 21, leaving room for the fallback endpoint
    to double a failed call. Catching up from an hour behind takes ~20 ticks. */
export const MAX_CATCHUP_BLOCKS = BLOCKS_PER_TICK * 3;
/** The gap past which catching up is not worth attempting, so the cursor jumps
    to the head instead and says it did.

    Catch-up nets MAX_CATCHUP_BLOCKS minus one tick of chain per minute, which
    is 1,200 blocks a minute here. A gap of this size therefore takes about
    eight hours of unbroken ticking to close, and every minute of that serves a
    "live" board showing hours-old data.

    On 2026-09-10 the indexer stalled and was found 2.95 MILLION blocks behind,
    about 83 hours. Closing that would have taken 41 hours of flawless ticking,
    during which the live layer would have been useless. Nothing in the code
    noticed; it ground away at 1,800 blocks a minute against a chain producing
    594, and only a manual check found it.

    Jumping is the right answer and it costs nothing that matters. **D1 is
    canonical for nothing.** The launch and graduation record lives in the repo
    and is rebuilt hourly by the Python pipeline, which has its own backfill for
    exactly this. The Worker's job is the LIVE layer, and a live layer that is
    three days behind is not a degraded live layer, it is a broken one.

    The skipped range is recorded on the cursor rather than passed over in
    silence, so `/api/health` can say a gap was skipped and how big it was. */
export const MAX_RECOVERABLE_GAP = 600_000;
/** How many `eth_getLogs` subrequests one tick may spend. The rest of the
    Worker's allowance goes to block headers, the factory view and KV. */
export const LOG_SUBREQUEST_BUDGET = 20;
/** Seven days. ~133,000 launch rows, ~25 MB, against a 5 GB free limit. */
export const RETENTION_SECONDS = 604_800;

/** What a range costs: one window per LOG_WINDOW_BLOCKS, two topics each. */
export function logSubrequests(from: number, to: number): number {
  if (to < from) return 0;
  return Math.ceil((to - from + 1) / LOG_WINDOW_BLOCKS) * 2;
}

/** What one tick's log reads cost.

    The factory pair (TokenLaunched, PoolGraduated) is read over the whole
    re-read range; the curve pair (CurveBuy, CurveSell) only over the blocks
    above the previous cursor, which is a subset of it. Twice the factory cost
    is therefore an upper bound on the pair of pairs, and the window is fitted
    against the bound rather than against the steady state -- two extra
    requests a minute in practice, four windows' worth at the catch-up limit. */
export function tickLogSubrequests(from: number, to: number): number {
  return logSubrequests(from, to) * 2;
}

/** The widest `to` at or below the one asked for whose range fits the budget.

    A range too wide to read is not a range to refuse: the blocks are still
    there, and refusing means the next tick asks for exactly the same ones and
    refuses again, for ever. Halving converges in a handful of steps, the tick
    reads what it can, and the cursor advances to what it actually read -- so
    every pass makes progress and the catch-up finishes. */
export function fitWindow(from: number, to: number, budget = LOG_SUBREQUEST_BUDGET): number {
  let end = to;
  while (end > from && tickLogSubrequests(from, end) > budget) {
    end = from + Math.floor((end - from) / 2);
  }
  return end;
}

/** A block header that did not come back. It is not a log with no timestamp:
    it is a pass that cannot be completed, because the whole dataset rests on
    the header being the time a thing happened (METHOD.md "Source"). */
export class MissingBlockHeader extends Error {
  constructor(block: number) {
    super(`no block header for block ${block}: the tick cannot timestamp what it read`);
    this.name = "MissingBlockHeader";
  }
}

export interface TickResult {
  ok: boolean;
  from: number;
  to: number;
  launches: number;
  graduations: number;
  /** Curve trade logs read in this pass, and how many of them belonged to no
      launch LEDGE holds. */
  trades?: number;
  unattributed?: number;
  skipped?: "rate_limited";
  error?: string;
}

/** Dedupe key. Both indexers use (txHash, logIndex); a token primary key
    catches the rest. */
export function logKey(log: { txHash: string; logIndex: number }): string {
  return `${log.txHash.toLowerCase()}:${log.logIndex}`;
}

export function dedupeLogs<T extends { txHash: string; logIndex: number }>(logs: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const log of logs) {
    const key = logKey(log);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(log);
  }
  return out;
}

async function readCursor(db: D1Database): Promise<{ last_indexed_block: number } | null> {
  const row = await db
    .prepare("SELECT last_indexed_block FROM cursor WHERE id = 1")
    .first<{ last_indexed_block: number }>();
  return row ?? null;
}

/** Windows of at most LOG_WINDOW_BLOCKS. The public endpoint rate-limits
    anything wider. */
export function logWindows(from: number, to: number): Array<[number, number]> {
  const windows: Array<[number, number]> = [];
  let start = from;
  while (start <= to) {
    const end = Math.min(to, start + LOG_WINDOW_BLOCKS - 1);
    windows.push([start, end]);
    start = end + 1;
  }
  return windows;
}

async function fetchLogs(
  rpc: RpcClient,
  factory: string,
  from: number,
  to: number,
): Promise<{ launches: TokenLaunchedLog[]; graduations: PoolGraduatedLog[] }> {
  const launches: TokenLaunchedLog[] = [];
  const graduations: PoolGraduatedLog[] = [];
  for (const [start, end] of logWindows(from, to)) {
    const launched = (await rpc.getLogs(start, end, factory, TOPIC_TOKEN_LAUNCHED)) as RawLog[];
    for (const log of launched) launches.push(decodeTokenLaunched(log));
    const graduated = (await rpc.getLogs(start, end, factory, TOPIC_POOL_GRADUATED)) as RawLog[];
    for (const log of graduated) graduations.push(decodePoolGraduated(log));
  }
  return { launches: dedupeLogs(launches), graduations: dedupeLogs(graduations) };
}

/** The two curve topics, over the blocks this pass folds into the counters.

    No address filter and none possible: every launch deploys its own curve,
    so there is nothing to filter on and the emitting curve is read out of
    each log's own `address` field (RESEARCH-PHASE2-3.md section 0). */
async function fetchCurveTrades(
  rpc: RpcClient,
  from: number,
  to: number,
): Promise<CurveTradeLog[]> {
  if (to < from) return [];
  const trades: CurveTradeLog[] = [];
  for (const [start, end] of logWindows(from, to)) {
    for (const [topic, side] of [
      [TOPIC_CURVE_BUY, "buy"],
      [TOPIC_CURVE_SELL, "sell"],
    ] as const) {
      const logs = (await rpc.getLogs(start, end, null, topic)) as RawLog[];
      for (const log of logs) trades.push(decodeCurveTrade(log, side));
    }
  }
  return dedupeLogs(trades);
}

/** D1 caps a statement's bound parameters, so every IN list is chunked. */
function chunk<T>(items: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function selectChunked<T>(
  db: D1Database,
  sql: (placeholders: string) => string,
  keys: string[],
): Promise<T[]> {
  if (keys.length === 0) return [];
  const results = await db.batch<T>(
    chunk(keys).map((part) =>
      db.prepare(sql(part.map(() => "?").join(","))).bind(...part),
    ),
  );
  return results.flatMap((result) => result.results ?? []);
}

/** Curve to the token whose launch deployed it, and that launch's block.

    The mapping is free at launch time -- TokenLaunched carries both as
    indexed topics -- so it is read back out of `launch`, which already holds
    it, rather than duplicated into a table with a retention rule of its own.
    Launches folded in this same pass are not in D1 yet and are merged in
    from memory, so a token bought in its own launch block is attributed. */
async function resolveCurves(
  db: D1Database,
  trades: CurveTradeLog[],
  launches: TokenLaunchedLog[],
): Promise<{ curveToToken: Map<string, string>; launchBlockOf: Map<string, number> }> {
  const curveToToken = new Map<string, string>();
  const launchBlockOf = new Map<string, number>();
  for (const launch of launches) {
    curveToToken.set(launch.curve, launch.token);
    const held = launchBlockOf.get(launch.token);
    if (held === undefined || launch.block < held) launchBlockOf.set(launch.token, launch.block);
  }
  const unknown = [...new Set(trades.map((t) => t.curve))].filter((c) => !curveToToken.has(c));
  const rows = await selectChunked<{ curve: string; token: string; block: number }>(
    db,
    (placeholders) => `SELECT curve, token, block FROM launch WHERE curve IN (${placeholders})`,
    unknown,
  );
  for (const row of rows) {
    curveToToken.set(row.curve, row.token);
    const held = launchBlockOf.get(row.token);
    if (held === undefined || row.block < held) launchBlockOf.set(row.token, row.block);
  }
  return { curveToToken, launchBlockOf };
}

async function readActivityRows(
  db: D1Database,
  tokens: string[],
): Promise<Map<string, ActivityRow>> {
  const rows = await selectChunked<ActivityRow>(
    db,
    (placeholders) => `SELECT * FROM token_activity WHERE token IN (${placeholders})`,
    [...new Set(tokens)],
  );
  return new Map(rows.map((row) => [row.token, row]));
}

/** Block-header timestamps, batched. Never a wall clock: the whole dataset
    rests on the header being the time a thing happened. */
async function fetchBlockTimestamps(rpc: RpcClient, blocks: number[]): Promise<Map<number, number>> {
  const distinct = [...new Set(blocks)];
  const out = new Map<number, number>();
  if (distinct.length === 0) return out;
  const results = await rpc.callBatch(
    distinct.map((block) => ({
      method: "eth_getBlockByNumber",
      params: ["0x" + block.toString(16), false],
    })),
  );
  distinct.forEach((block, i) => {
    const result = results[i] as { timestamp?: string } | null;
    if (result?.timestamp) out.set(block, Number(BigInt(result.timestamp)));
  });
  /* Every block that carried a log must have a header. Skipping the log and
     advancing the cursor past its block loses it for ever, and reports ok
     while doing it. Failing holds the cursor, and the next tick reads the
     same blocks again. */
  for (const block of distinct) {
    if (!out.has(block)) throw new MissingBlockHeader(block);
  }
  return out;
}

/** creatorTaxBps, pairToken and graduationThreshold, batched over the factory
    view. A token whose call fails keeps a null tax and a null threshold --
    the cohort lookup has no bucket for it and the board renders no fill for
    it, both honest outcomes for the same missing read (REPOSITION.md B1:
    graduationThreshold is word 5 of the same 15-word tuple, so this is not a
    second RPC call). */
async function fetchTokenConfigs(
  rpc: RpcClient,
  factory: string,
  tokens: string[],
): Promise<Map<string, { pairToken: string; creatorTaxBps: number; graduationThresholdWei: string }>> {
  const out = new Map<
    string,
    { pairToken: string; creatorTaxBps: number; graduationThresholdWei: string }
  >();
  if (tokens.length === 0) return out;
  const results = await rpc.callBatch(
    tokens.map((token) => ({
      method: "eth_call",
      params: [{ to: factory, data: encodeAddressCall(SELECTOR_GET_LAUNCHED_TOKEN, token) }, "latest"],
    })),
  );
  tokens.forEach((token, i) => {
    const decoded = decodeLaunchedToken(results[i] as string | null);
    if (decoded?.exists && decoded.creatorTaxBps !== null) {
      out.set(token, {
        pairToken: decoded.pairToken,
        creatorTaxBps: decoded.creatorTaxBps,
        graduationThresholdWei: decoded.graduationThresholdWei,
      });
    }
  });
  return out;
}

/** The graveyard's own post (worker/src/graveyard.ts carries the full
    reasoning). Runs after the tick's own D1 write has already landed, so it
    reads the freshest cursor and rows, and it never touches the tick's own
    result -- a Telegram outage or a missing TELEGRAM_GRAVEYARD_CHAT_ID is not
    an indexing failure, and must not be reported as one. */
async function announceGraveyard(env: Env, db: D1Database, nowSeconds: number, toBlock: number): Promise<void> {
  if (!env.TELEGRAM_GRAVEYARD_CHAT_ID) return;

  const rowsResult = await db.prepare(GRAVEYARD_QUERY).all<GraveyardDbRow>();
  const dbRows = rowsResult.results ?? [];
  const rows = buildGraveyardRows(
    dbRows,
    { last_indexed_block: toBlock, last_success_at: nowSeconds, consecutive_failures: 0 },
    nowSeconds,
    "age",
  );
  if (rows.length === 0) return;

  const candidates = graveyardRowsToCandidates(rows);
  const posted = await selectChunked<{ token: string }>(
    db,
    (placeholders) => `SELECT token FROM graveyard_posted WHERE token IN (${placeholders})`,
    candidates.map((c) => c.token),
  );
  const newEntries = selectNewGraveyardEntries(candidates, new Set(posted.map((p) => p.token)));
  if (newEntries.length === 0) return;

  const text = graveyardPostText(newEntries, env.SITE_ORIGIN);
  if (text === null) return;

  const chatId = env.TELEGRAM_GRAVEYARD_CHAT_ID;
  if (!(await withinLimits(db, chatId, nowSeconds))) return; // retried next tick, never skipped silently

  await sendMessage(env, chatId, text);
  await db.batch(
    newEntries.map((entry) =>
      db
        .prepare("INSERT OR IGNORE INTO graveyard_posted (token, posted_at) VALUES (?, ?)")
        .bind(entry.token, nowSeconds),
    ),
  );
}

async function recordFailure(db: D1Database, nowSeconds: number, message: string): Promise<void> {
  await db
    .prepare(
      `UPDATE cursor SET last_tick_at = ?, consecutive_failures = consecutive_failures + 1, last_error = ? WHERE id = 1`,
    )
    .bind(nowSeconds, message.slice(0, 500))
    .run();
}

/** `client` is a test seam: production passes nothing and the tick opens its
    own connection at the Phase 1 envelope. */
export async function tick(
  env: Env,
  nowSeconds = Math.floor(Date.now() / 1000),
  client?: RpcClient,
): Promise<TickResult> {
  const db = env.LEDGE_DB;
  const factory = env.FACTORY_ADDRESS.toLowerCase();
  const rpc = client ?? new RpcClient(env.RPC_URL, undefined, env.RPC_URL_FALLBACK);

  let from = 0;
  let to = 0;
  try {
    const head = await rpc.getHeadBlock();
    const cursor = await readCursor(db);

    if (!cursor) {
      const start = Math.max(0, head - COLD_START_BLOCKS);
      await db
        .prepare(
          `INSERT INTO cursor (id, last_indexed_block, last_tick_at, last_success_at, consecutive_failures, last_error)
           VALUES (1, ?, ?, ?, 0, NULL)`,
        )
        .bind(start, nowSeconds, nowSeconds)
        .run();
      return { ok: true, from: start, to: start, launches: 0, graduations: 0 };
    }

    /* Hopelessly behind: jump rather than grind. See MAX_RECOVERABLE_GAP. */
    const gap = head - cursor.last_indexed_block;
    if (gap > MAX_RECOVERABLE_GAP) {
      const resumeFrom = Math.max(0, head - COLD_START_BLOCKS);
      await db
        .prepare(
          "UPDATE cursor SET last_indexed_block = ?, skipped_from = ?, skipped_to = ?, consecutive_failures = 0, last_error = ? WHERE id = 1",
        )
        .bind(
          resumeFrom,
          cursor.last_indexed_block,
          resumeFrom,
          `skipped ${gap} blocks to rejoin the head; the repo record is canonical and unaffected`,
        )
        .run();
      return {
        ok: true,
        from: cursor.last_indexed_block,
        to: resumeFrom,
        launches: 0,
        graduations: 0,
      };
    }

    from = Math.max(0, cursor.last_indexed_block + 1 - REORG_OVERLAP_BLOCKS);
    to = fitWindow(from, Math.min(head, cursor.last_indexed_block + MAX_CATCHUP_BLOCKS));
    if (to < from) {
      return { ok: true, from, to: cursor.last_indexed_block, launches: 0, graduations: 0 };
    }
    /* The part of this range that was already indexed. Rows in it that the
       fresh logs no longer carry were reorged out and must go with them. */
    const overlapTo = Math.min(to, cursor.last_indexed_block);

    const { launches, graduations } = await fetchLogs(rpc, factory, from, to);

    /* The counters advance strictly above the previous cursor. The overlap
       below it is re-read so that launches and graduations can be reconciled
       against the chain, and those are keyed on the log's own identity so a
       re-read costs nothing. A counter has no such key -- folding a block
       twice counts every trade in it twice -- so the curve topics are read
       over the new blocks alone. See worker/src/activity.ts. */
    const countFrom = cursor.last_indexed_block + 1;
    const trades = await fetchCurveTrades(rpc, countFrom, to);
    const { curveToToken, launchBlockOf } = await resolveCurves(db, trades, launches);
    /* Launches whose own block this pass folds: the only ones whose first
       block is in hand, and so the only ones whose first-block buyers can be
       counted. */
    const newLaunches = new Map<string, number>();
    for (const launch of launches) {
      if (launch.block >= countFrom && !newLaunches.has(launch.token)) {
        newLaunches.set(launch.token, launch.block);
        launchBlockOf.set(launch.token, launch.block);
      }
    }
    /* Every token this pass touches, including the launches it seeds a row
       for: the fold writes rows whole, so a row it has not read is a row it
       would overwrite with zeros. */
    const touched = [
      ...trades.map((t) => curveToToken.get(t.curve)).filter((t): t is string => !!t),
      ...newLaunches.keys(),
    ];
    const existingActivity = await readActivityRows(db, touched);

    const timestamps = await fetchBlockTimestamps(rpc, [
      ...launches.map((l) => l.block),
      ...graduations.map((g) => g.block),
      ...activityBlocks(trades, curveToToken, existingActivity),
    ]);

    const activity = planActivity({
      trades,
      curveToToken,
      launchBlockOf,
      newLaunches,
      existing: existingActivity,
      timestamps,
    });

    const configs = await fetchTokenConfigs(
      rpc,
      factory,
      launches.slice(0, MAX_BATCH * 4).map((l) => l.token),
    );
    const pairTokens = await loadPairTokens(env, nowSeconds * 1000);

    const statements: D1PreparedStatement[] = [];

    /* THE RE-READ IS RECONCILED, NOT MERELY RE-INSERTED (B6).

       Re-reading the overlap and then only inserting what is new is a slower
       way of writing once: a log the chain has since discarded stayed for its
       full seven days, so /api/token answered `graduated: true` for a
       graduation that never happened, and a re-mined launch kept the block
       and timestamp of the fork that lost.

       The range is therefore cleared and rewritten from the fresh logs, in
       the same batch -- one D1 transaction, so no reader ever sees the gap.
       A row whose (tx_hash, log_index) is still on chain is written back
       unchanged; one that is not simply does not come back. D1 caps a
       statement at 100 bound parameters, so an explicit NOT IN over the
       fresh keys is not available at these volumes; clearing the range says
       the same thing and says it in two statements. */
    if (overlapTo >= from) {
      statements.push(
        db.prepare("DELETE FROM launch WHERE block BETWEEN ? AND ?").bind(from, overlapTo),
        db.prepare("DELETE FROM graduation WHERE block BETWEEN ? AND ?").bind(from, overlapTo),
      );
    }

    for (const launch of launches) {
      const ts = timestamps.get(launch.block);
      if (ts === undefined) continue; // unreachable: a missing header threw above
      const config = configs.get(launch.token);
      const pairToken = config?.pairToken ?? launch.pairToken;
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO launch
               (token, curve, pair_token, pair_class, creator_tax_bps, graduation_threshold, block, ts, tx_hash, log_index)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            launch.token,
            launch.curve,
            pairToken,
            pairClassOf(pairToken, pairTokens),
            config ? config.creatorTaxBps : null,
            config ? config.graduationThresholdWei : null,
            launch.block,
            ts,
            launch.txHash,
            launch.logIndex,
          ),
      );
    }
    for (const graduation of graduations) {
      const ts = timestamps.get(graduation.block);
      if (ts === undefined) continue;
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO graduation
               (token, block, ts, pair_token_amount, tx_hash, log_index)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            graduation.token,
            graduation.block,
            ts,
            graduation.pairTokenAmount,
            graduation.txHash,
            graduation.logIndex,
          ),
      );
    }

    /* One row per token touched, written whole: the fold read the previous
       row out of D1 above and produced its successor, because a uint256 sum
       is BigInt addition and SQLite cannot do it in an UPDATE. The read
       happened before this batch and the write happens inside it, and the
       tick is the only writer. */
    for (const row of activity.rows) {
      /* reserve_wei/reserve_block are carried forward from whatever this
         token held before this REPLACE, never zeroed by it: this loop folds
         the other nine columns and has no reserve reading of its own, and an
         INSERT OR REPLACE sets every column its statement does not name back
         to its default -- NULL -- which would silently erase a real reading
         on every token this tick merely traded. */
      const previous = existingActivity.get(row.token);
      statements.push(
        db
          .prepare(
            `INSERT OR REPLACE INTO token_activity
               (token, from_block, buys, sells, quote_in, quote_out, first_buy_ts, last_activity_ts, first_block_buyers, reserve_wei, reserve_block)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            row.token,
            row.from_block,
            row.buys,
            row.sells,
            row.quote_in,
            row.quote_out,
            row.first_buy_ts,
            row.last_activity_ts,
            row.first_block_buyers,
            previous?.reserve_wei ?? null,
            previous?.reserve_block ?? null,
          ),
      );
    }
    if (activity.unattributed > 0) {
      statements.push(
        db
          .prepare(
            `INSERT INTO activity_unattributed (id, logs, last_seen_at) VALUES (1, ?, ?)
             ON CONFLICT (id) DO UPDATE SET logs = logs + excluded.logs, last_seen_at = excluded.last_seen_at`,
          )
          .bind(activity.unattributed, nowSeconds),
      );
    }

    /* The curve reserve read (2026-09-12), extended the same day to also
       cache pair-token decimals()/symbol() the board cannot otherwise show
       units for (worker/schema.sql's `pair_token` table). Both are one
       Multicall3 call, spent from the same subrequest budget as everything
       else this tick does -- readReservesAndPairTokens folds the reserve
       calls and the pair-token calls into one aggregate3 array rather than
       making two eth_calls, so this costs exactly what the reserve read
       alone used to. Downstream of the tick's own job -- the activity fold
       above and the cursor write below -- so nothing here may block or delay
       either: a budget already spent, a malformed response, or any other
       failure is caught and logged, and every row this tick does not read
       keeps whatever reading (or NULL, "never read") it already held. The
       next tick tries again. */
    try {
      const populationResult = await db
        .prepare(RESERVE_POPULATION_QUERY)
        .all<{ token: string; curve: string; pair_token: string }>();
      const population = populationResult.results ?? [];
      const targets: CurveTarget[] = population.map((row) => ({
        token: row.token,
        curve: row.curve,
        pairToken: row.pair_token,
      }));

      /* Only genuinely unknown pair tokens are worth a call: the zero
         address is defined as ETH/18 and never read, and `pair_token` is a
         read-once cache -- an address already in it, success or failure, is
         skipped rather than re-read every minute. */
      const candidatePairTokens = [
        ...new Set(
          population
            .map((row) => row.pair_token?.toLowerCase())
            .filter((address): address is string => !!address && address !== ZERO_ADDRESS),
        ),
      ];
      const knownPairTokens = await selectChunked<{ address: string }>(
        db,
        (placeholders) => `SELECT address FROM pair_token WHERE address IN (${placeholders})`,
        candidatePairTokens,
      );
      const known = new Set(knownPairTokens.map((row) => row.address.toLowerCase()));
      const unknownPairTokens = candidatePairTokens.filter((address) => !known.has(address));

      if (targets.length > 0 || unknownPairTokens.length > 0) {
        const { reserves, pairTokens } = await readReservesAndPairTokens(
          rpc,
          targets,
          unknownPairTokens,
          head,
        );
        for (const reading of reserves) {
          if (reading.reserveWei === null) continue; // never write a failed sub-call as a fresh reading
          statements.push(
            db
              .prepare(`UPDATE token_activity SET reserve_wei = ?, reserve_block = ? WHERE token = ?`)
              .bind(reading.reserveWei, head, reading.token),
          );
        }
        for (const reading of pairTokens) {
          statements.push(
            db
              .prepare(
                `INSERT INTO pair_token (address, decimals, symbol, read_block) VALUES (?, ?, ?, ?)
                 ON CONFLICT (address) DO UPDATE SET decimals = excluded.decimals, symbol = excluded.symbol, read_block = excluded.read_block`,
              )
              .bind(reading.address.toLowerCase(), reading.decimals, reading.symbol, head),
          );
        }
      }
    } catch (error) {
      console.error("reserve read skipped", error instanceof Error ? error.message : String(error));
    }

    statements.push(
      db
        .prepare(
          `UPDATE cursor SET last_indexed_block = ?, last_tick_at = ?, last_success_at = ?,
                             consecutive_failures = 0, last_error = NULL
           WHERE id = 1`,
        )
        .bind(to, nowSeconds, nowSeconds),
    );
    /* Retention, in this order and with this condition (W2).

       Both tables held seven days keyed on their own timestamp, so a launch
       that graduated five hours after it launched was evicted five hours
       before its graduation was -- and for those five hours the graduation
       had no launch to be a graduation OF: no time-to-graduation, and a
       lookup that reported the token unindexed while still holding its
       graduation. Graduations are pruned first, and a launch is kept as long
       as any surviving graduation still references it. */
    statements.push(
      db.prepare("DELETE FROM graduation WHERE ts < ?").bind(nowSeconds - RETENTION_SECONDS),
    );
    /* Activity is pruned on its own last event, under the same graduation
       hold, and BEFORE the launch that carries it -- a launch is what maps a
       curve to a token, so evicting one whose curve is still trading would
       turn every later trade on it into an unattributed reading. An activity
       row never predates its launch, so the two always age out together and
       the window an activity row names is never wider than what was read. */
    statements.push(
      db
        .prepare(
          `DELETE FROM token_activity
             WHERE last_activity_ts < ?
               AND token NOT IN (SELECT token FROM graduation)`,
        )
        .bind(nowSeconds - RETENTION_SECONDS),
    );
    statements.push(
      db
        .prepare(
          `DELETE FROM launch
             WHERE ts < ?
               AND token NOT IN (SELECT token FROM graduation)
               AND token NOT IN (SELECT token FROM token_activity)`,
        )
        .bind(nowSeconds - RETENTION_SECONDS),
    );
    statements.push(
      db.prepare("DELETE FROM tg_usage WHERE hour_key < ?").bind(Math.floor((nowSeconds - 86_400) / 3600)),
    );

    await db.batch(statements);

    try {
      await announceGraveyard(env, db, nowSeconds, to);
    } catch (error) {
      // The graveyard post is downstream of a successful index write and must
      // never turn an indexed tick into a reported failure. Logged, not thrown.
      console.error("graveyard announcement failed", error instanceof Error ? error.message : String(error));
    }

    return {
      ok: true,
      from,
      to,
      launches: launches.length,
      graduations: graduations.length,
      trades: trades.length,
      unattributed: activity.unattributed,
    };
  } catch (error) {
    const rateLimited = error instanceof RpcUnavailable && (error.rateLimited || rpc.rateLimitSeen);
    const message = error instanceof Error ? error.message : String(error);
    try {
      await recordFailure(db, nowSeconds, message);
    } catch {
      // A cursor that cannot be written is itself the outage. Nothing to do
      // here but let the next tick try again.
    }
    return {
      ok: false,
      from,
      to,
      launches: 0,
      graduations: 0,
      ...(rateLimited ? { skipped: "rate_limited" as const } : {}),
      error: message,
    };
  }
}
