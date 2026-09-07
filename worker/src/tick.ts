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
import { loadPairTokens } from "./numberFile";

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

/** The widest `to` at or below the one asked for whose range fits the budget.

    A range too wide to read is not a range to refuse: the blocks are still
    there, and refusing means the next tick asks for exactly the same ones and
    refuses again, for ever. Halving converges in a handful of steps, the tick
    reads what it can, and the cursor advances to what it actually read -- so
    every pass makes progress and the catch-up finishes. */
export function fitWindow(from: number, to: number, budget = LOG_SUBREQUEST_BUDGET): number {
  let end = to;
  while (end > from && logSubrequests(from, end) > budget) {
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

/** creatorTaxBps and pairToken, batched over the factory view. A token whose
    call fails keeps a null tax -- the cohort lookup then has no bucket for it
    and says so, which is the honest outcome. */
async function fetchTokenConfigs(
  rpc: RpcClient,
  factory: string,
  tokens: string[],
): Promise<Map<string, { pairToken: string; creatorTaxBps: number }>> {
  const out = new Map<string, { pairToken: string; creatorTaxBps: number }>();
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
      out.set(token, { pairToken: decoded.pairToken, creatorTaxBps: decoded.creatorTaxBps });
    }
  });
  return out;
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

    from = Math.max(0, cursor.last_indexed_block + 1 - REORG_OVERLAP_BLOCKS);
    to = fitWindow(from, Math.min(head, cursor.last_indexed_block + MAX_CATCHUP_BLOCKS));
    if (to < from) {
      return { ok: true, from, to: cursor.last_indexed_block, launches: 0, graduations: 0 };
    }
    /* The part of this range that was already indexed. Rows in it that the
       fresh logs no longer carry were reorged out and must go with them. */
    const overlapTo = Math.min(to, cursor.last_indexed_block);

    const { launches, graduations } = await fetchLogs(rpc, factory, from, to);

    const timestamps = await fetchBlockTimestamps(rpc, [
      ...launches.map((l) => l.block),
      ...graduations.map((g) => g.block),
    ]);

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
               (token, curve, pair_token, pair_class, creator_tax_bps, block, ts, tx_hash, log_index)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            launch.token,
            launch.curve,
            pairToken,
            pairClassOf(pairToken, pairTokens),
            config ? config.creatorTaxBps : null,
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
    statements.push(
      db
        .prepare(
          `DELETE FROM launch
             WHERE ts < ?
               AND token NOT IN (SELECT token FROM graduation)`,
        )
        .bind(nowSeconds - RETENTION_SECONDS),
    );
    statements.push(
      db.prepare("DELETE FROM tg_usage WHERE hour_key < ?").bind(Math.floor((nowSeconds - 86_400) / 3600)),
    );

    await db.batch(statements);
    return { ok: true, from, to, launches: launches.length, graduations: graduations.length };
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
