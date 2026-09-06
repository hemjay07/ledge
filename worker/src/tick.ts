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

/** Blocks re-read on every tick so a short reorg cannot drop a launch.
    ~0.1 s a block, so 200 blocks is about 20 seconds of chain. */
export const REORG_OVERLAP_BLOCKS = 200;
/** A bounded catch-up: an outage must not produce a tick that blows the
    subrequest budget. What it does not reach, the next minute reaches. */
export const MAX_CATCHUP_BLOCKS = 5000;
/** Seven days. ~133,000 launch rows, ~25 MB, against a 5 GB free limit. */
export const RETENTION_SECONDS = 604_800;
/** Where a cold cursor starts: one minute of chain behind the head. */
export const COLD_START_BLOCKS = 600;

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
  const rpc = client ?? new RpcClient(env.RPC_URL);

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
    to = Math.min(head, cursor.last_indexed_block + MAX_CATCHUP_BLOCKS);
    if (to < from) {
      return { ok: true, from, to: cursor.last_indexed_block, launches: 0, graduations: 0 };
    }

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
    for (const launch of launches) {
      const ts = timestamps.get(launch.block);
      if (ts === undefined) continue; // no header, no timestamp, no row
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
    statements.push(
      db.prepare("DELETE FROM launch WHERE ts < ?").bind(nowSeconds - RETENTION_SECONDS),
    );
    statements.push(
      db.prepare("DELETE FROM graduation WHERE ts < ?").bind(nowSeconds - RETENTION_SECONDS),
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
