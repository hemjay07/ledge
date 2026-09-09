import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { RpcClient } from "../../src/rpc";
import { MAX_CATCHUP_BLOCKS, REORG_OVERLAP_BLOCKS, RETENTION_SECONDS, dedupeLogs, logWindows, tick } from "../../src/tick";
import { TOPIC_TOKEN_LAUNCHED, TOPIC_POOL_GRADUATED, TOPIC_CURVE_BUY, TOPIC_CURVE_SELL } from "../../src/pons";
import { reset, seedCursor } from "./setup";

const NOW = 1_788_720_000;
const FACTORY = env.FACTORY_ADDRESS.toLowerCase();

function pad(value: string): string {
  return value.replace(/^0x/, "").padStart(64, "0");
}
function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function launchLog(
  token: string,
  block: number,
  logIndex: number,
  txHash: string,
  curve = "0xf6e86610771ee7838cabe2f9c376265ca25ef04c",
) {
  return {
    address: FACTORY,
    topics: [
      TOPIC_TOKEN_LAUNCHED,
      "0x" + pad(token),
      "0x" + pad(curve),
      "0x" + pad("0x96cb8eb2e349e64ba47b1015890a2fe7584c369b"),
    ],
    data: "0x" + word(0n) + word(0n) + word(4_200_000_000_000_000_000n),
    blockNumber: "0x" + block.toString(16),
    transactionHash: txHash,
    logIndex: "0x" + logIndex.toString(16),
  };
}

function graduationLog(token: string, block: number, logIndex: number, txHash: string) {
  return {
    address: FACTORY,
    topics: [TOPIC_POOL_GRADUATED, "0x" + pad(token)],
    data: "0x" + word(1n) + word(2n) + word(4_200_000_000_000_000_152n),
    blockNumber: "0x" + block.toString(16),
    transactionHash: txHash,
    logIndex: "0x" + logIndex.toString(16),
  };
}

function buyLog(curve: string, buyer: string, quoteIn: bigint, block: number, logIndex = 0) {
  return {
    address: curve,
    topics: [TOPIC_CURVE_BUY, "0x" + pad(buyer), "0x" + pad(buyer)],
    data: "0x" + word(quoteIn) + word(1n) + word(0n) + word(0n),
    blockNumber: "0x" + block.toString(16),
    transactionHash: `0xb${block}${logIndex}`,
    logIndex: "0x" + logIndex.toString(16),
  };
}

function sellLog(curve: string, seller: string, quoteOut: bigint, block: number, logIndex = 0) {
  return {
    address: curve,
    topics: [TOPIC_CURVE_SELL, "0x" + pad(seller), "0x" + pad(seller)],
    data: "0x" + word(9n) + word(quoteOut) + word(0n) + word(0n),
    blockNumber: "0x" + block.toString(16),
    transactionHash: `0xs${block}${logIndex}`,
    logIndex: "0x" + logIndex.toString(16),
  };
}

/** A chain that answers from a fixed set of logs, exactly as the endpoint
    would: one topic per eth_getLogs, batched blocks and calls by id. */
function fakeChain(options: {
  head: number;
  launches: ReturnType<typeof launchLog>[];
  graduations: ReturnType<typeof graduationLog>[];
  buys?: ReturnType<typeof buyLog>[];
  sells?: ReturnType<typeof sellLog>[];
  timestampOf?: (block: number) => number;
  fault?: { code: number; message: string };
  taxBps?: number;
}) {
  const calls = { getLogs: 0, batches: 0 };
  const timestampOf = options.timestampOf ?? ((block: number) => NOW - (options.head - block));
  const client = new RpcClient("http://unused", async (payload) => {
    if (options.fault) return options.fault;
    const batch = payload as Array<{ id: number; method: string; params: any[] }>;
    if (batch.length > 1) calls.batches += 1;
    return batch.map((request) => {
      if (request.method === "eth_blockNumber") {
        return { id: request.id, result: "0x" + options.head.toString(16) };
      }
      if (request.method === "eth_getLogs") {
        calls.getLogs += 1;
        const filter = request.params[0];
        const from = Number(BigInt(filter.fromBlock));
        const to = Number(BigInt(filter.toBlock));
        const pools: Record<string, any[]> = {
          [TOPIC_TOKEN_LAUNCHED]: options.launches,
          [TOPIC_POOL_GRADUATED]: options.graduations,
          [TOPIC_CURVE_BUY]: options.buys ?? [],
          [TOPIC_CURVE_SELL]: options.sells ?? [],
        };
        const pool = pools[filter.topics[0]] ?? [];
        return {
          id: request.id,
          result: pool.filter((log) => {
            const block = Number(BigInt(log.blockNumber));
            return block >= from && block <= to;
          }),
        };
      }
      if (request.method === "eth_getBlockByNumber") {
        const block = Number(BigInt(request.params[0]));
        return { id: request.id, result: { timestamp: "0x" + timestampOf(block).toString(16) } };
      }
      if (request.method === "eth_call") {
        // a 15-word getLaunchedToken tuple: pairToken 0x0, tax, phase 0, exists 1
        const words = Array.from({ length: 15 }, () => word(0n));
        words[8] = word(BigInt(options.taxBps ?? 300));
        words[14] = word(1n);
        return { id: request.id, result: "0x" + words.join("") };
      }
      return { id: request.id, result: null };
    });
  });
  return { client, calls };
}

const TOKEN_A = "0x00000000000000000000000000000000000000aa";
const TOKEN_B = "0x00000000000000000000000000000000000000bb";

describe("windowing", () => {
  it("never asks the endpoint for more than 1,000 blocks at once", () => {
    const windows = logWindows(1, 2500);
    expect(windows).toEqual([
      [1, 1000],
      [1001, 2000],
      [2001, 2500],
    ]);
  });
});

describe("dedupe on (txHash, logIndex)", () => {
  it("keeps one row for a log delivered twice", () => {
    const logs = [
      { txHash: "0xAB", logIndex: 3, token: TOKEN_A },
      { txHash: "0xab", logIndex: 3, token: TOKEN_A },
      { txHash: "0xab", logIndex: 4, token: TOKEN_B },
    ];
    expect(dedupeLogs(logs)).toHaveLength(2);
  });

  it("keeps two logs from one transaction at different indexes", () => {
    expect(
      dedupeLogs([
        { txHash: "0xab", logIndex: 0 },
        { txHash: "0xab", logIndex: 1 },
      ]),
    ).toHaveLength(2);
  });
});

describe("the tick", () => {
  beforeEach(async () => {
    await reset();
  });

  it("starts cold one minute behind the head, indexing nothing on that pass", async () => {
    const { client } = fakeChain({ head: 100_000, launches: [], graduations: [] });
    const result = await tick(env, NOW, client);
    expect(result.ok).toBe(true);
    const cursor = await env.LEDGE_DB.prepare("SELECT * FROM cursor").first<any>();
    expect(cursor.last_indexed_block).toBe(100_000 - 600);
  });

  it("writes launches and graduations with block-header timestamps", async () => {
    await seedCursor(1000, NOW);
    const { client } = fakeChain({
      head: 1100,
      launches: [launchLog(TOKEN_A, 1050, 3, "0xtx1")],
      graduations: [graduationLog(TOKEN_B, 1060, 7, "0xtx2")],
      timestampOf: (block) => NOW - 1000 + block,
    });
    const result = await tick(env, NOW, client);
    expect(result.ok).toBe(true);

    const launch = await env.LEDGE_DB.prepare("SELECT * FROM launch").first<any>();
    expect(launch.token).toBe(TOKEN_A);
    expect(launch.ts).toBe(NOW - 1000 + 1050); // the header, never a wall clock
    expect(launch.pair_class).toBe("eth");
    expect(launch.creator_tax_bps).toBe(300);
    expect(launch.log_index).toBe(3);

    const graduation = await env.LEDGE_DB.prepare("SELECT * FROM graduation").first<any>();
    expect(graduation.token).toBe(TOKEN_B);
    expect(graduation.pair_token_amount).toBe("4200000000000000152");
  });

  it("re-reads the reorg overlap and writes no duplicate on the second pass", async () => {
    await seedCursor(1000, NOW);
    const chain = {
      head: 1100,
      launches: [launchLog(TOKEN_A, 1050, 3, "0xtx1")],
      graduations: [] as any[],
    };
    await tick(env, NOW, fakeChain(chain).client);
    const first = await env.LEDGE_DB.prepare("SELECT count(*) AS n FROM launch").first<any>();
    expect(first.n).toBe(1);

    // the same logs are delivered again inside the overlap
    await tick(env, NOW + 60, fakeChain({ ...chain, head: 1150 }).client);
    const second = await env.LEDGE_DB.prepare("SELECT count(*) AS n FROM launch").first<any>();
    expect(second.n).toBe(1);
  });

  it("asks for the overlap window, not only the new blocks", async () => {
    await seedCursor(5000, NOW);
    let lowest = Number.MAX_SAFE_INTEGER;
    const client = new RpcClient("http://unused", async (payload) => {
      const batch = payload as Array<{ id: number; method: string; params: any[] }>;
      return batch.map((request) => {
        if (request.method === "eth_blockNumber") return { id: request.id, result: "0x1450" };
        if (request.method === "eth_getLogs") {
          lowest = Math.min(lowest, Number(BigInt(request.params[0].fromBlock)));
          return { id: request.id, result: [] };
        }
        return { id: request.id, result: null };
      });
    });
    await tick(env, NOW, client);
    expect(lowest).toBe(5001 - REORG_OVERLAP_BLOCKS);
  });

  it("holds the cursor and counts the failure when the chain does not answer", async () => {
    await seedCursor(1000, NOW);
    const { client } = fakeChain({
      head: 1100,
      launches: [],
      graduations: [],
      fault: { code: 429, message: "slow down" },
    });
    const result = await tick(env, NOW, client);
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe("rate_limited");
    const cursor = await env.LEDGE_DB.prepare("SELECT * FROM cursor").first<any>();
    expect(cursor.last_indexed_block).toBe(1000); // untouched
    expect(cursor.consecutive_failures).toBe(1);
    expect(cursor.last_error).toBeTruthy();
  }, 30_000);

  it("clears the failure count on the next pass that succeeds", async () => {
    await env.LEDGE_DB.prepare(
      `INSERT OR REPLACE INTO cursor VALUES (1, 1000, ?, ?, 3, 'earlier outage')`,
    )
      .bind(NOW, NOW - 600)
      .run();
    const { client } = fakeChain({ head: 1100, launches: [], graduations: [] });
    await tick(env, NOW, client);
    const cursor = await env.LEDGE_DB.prepare("SELECT * FROM cursor").first<any>();
    expect(cursor.consecutive_failures).toBe(0);
    expect(cursor.last_error).toBeNull();
  });

  it("prunes rows past the retention window and keeps the rest", async () => {
    await seedCursor(500_000, NOW);
    await env.LEDGE_DB.prepare(
      `INSERT INTO launch VALUES ('0xold', '0xc', '0x0', 'eth', 0, NULL, 1, ?, '0xt', 0)`,
    )
      .bind(NOW - RETENTION_SECONDS - 1)
      .run();
    await env.LEDGE_DB.prepare(
      `INSERT INTO launch VALUES ('0xkeep', '0xc', '0x0', 'eth', 0, NULL, 2, ?, '0xt', 1)`,
    )
      .bind(NOW - RETENTION_SECONDS + 60)
      .run();
    const { client } = fakeChain({ head: 500_100, launches: [], graduations: [] });
    await tick(env, NOW, client);
    const rows = await env.LEDGE_DB.prepare("SELECT token FROM launch ORDER BY token").all();
    expect(rows.results.map((r: any) => r.token)).toEqual(["0xkeep"]);
  });

  it("bounds the catch-up after an outage rather than blowing the budget", async () => {
    await seedCursor(1000, NOW);
    const { client } = fakeChain({ head: 900_000, launches: [], graduations: [] });
    const result = await tick(env, NOW, client);
    expect(result.to).toBe(1000 + MAX_CATCHUP_BLOCKS);
  }, 60_000);

});

/* B6 — the durable key.

   ARCHITECTURE.md section 5 is binding on both indexers: "Dedupe is on
   (txHash, logIndex) only -- never on token address, because a token can in
   principle appear twice and because a reorg replay produces identical keys."
   D1 keyed `launch` and `graduation` on `token`, which is a different claim:
   that a token can be launched once and graduate once, for ever. Under a
   reorg it is false, and INSERT OR IGNORE then silently kept the row the
   chain had just discarded. */
describe("the durable key is the log's own identity", () => {
  beforeEach(async () => {
    await reset();
  });

  it("holds two rows for one token seen in two different logs", async () => {
    await env.LEDGE_DB.batch([
      env.LEDGE_DB.prepare(
        `INSERT INTO launch VALUES (?, '0xc', '0x0', 'eth', 0, NULL, 10, 100, '0xaa', 0)`,
      ).bind(TOKEN_A),
      env.LEDGE_DB.prepare(
        `INSERT INTO launch VALUES (?, '0xc', '0x0', 'eth', 0, NULL, 11, 101, '0xbb', 0)`,
      ).bind(TOKEN_A),
    ]);
    const rows = await env.LEDGE_DB.prepare("SELECT count(*) AS n FROM launch").first<any>();
    expect(rows.n).toBe(2);
  });

  it("refuses a second row for the same (tx_hash, log_index)", async () => {
    await env.LEDGE_DB.prepare(
      `INSERT INTO launch VALUES (?, '0xc', '0x0', 'eth', 0, NULL, 10, 100, '0xaa', 0)`,
    )
      .bind(TOKEN_A)
      .run();
    await expect(
      env.LEDGE_DB.prepare(
        `INSERT INTO launch VALUES (?, '0xc', '0x0', 'eth', 0, NULL, 10, 100, '0xaa', 0)`,
      )
        .bind(TOKEN_B)
        .run(),
    ).rejects.toThrow();
  });

  it("keeps the same two claims for graduations", async () => {
    await env.LEDGE_DB.batch([
      env.LEDGE_DB.prepare(`INSERT INTO graduation VALUES (?, 10, 100, '1', '0xaa', 0)`).bind(TOKEN_A),
      env.LEDGE_DB.prepare(`INSERT INTO graduation VALUES (?, 11, 101, '1', '0xbb', 0)`).bind(TOKEN_A),
    ]);
    const rows = await env.LEDGE_DB.prepare("SELECT count(*) AS n FROM graduation").first<any>();
    expect(rows.n).toBe(2);
  });
});

/* B6 — what the reorg overlap is FOR.

   The tick re-reads the overlap on every pass and did nothing with the
   answer beyond inserting what was new. A log that the chain has since
   discarded stayed in the table for its full seven days, and /api/token
   served `graduated: true` for a graduation that never happened. Re-reading
   a range and then ignoring what the re-read no longer contains is not a
   reorg defence; it is a slower way of writing once. */
describe("a log the chain no longer has", () => {
  beforeEach(async () => {
    await reset();
  });

  it("deletes a graduation that was reorged out of the overlap", async () => {
    await seedCursor(5000, NOW);
    const graduation = graduationLog(TOKEN_B, 5050, 1, "0xtxg");
    await tick(env, NOW, fakeChain({ head: 5100, launches: [], graduations: [graduation] }).client);
    expect(
      (await env.LEDGE_DB.prepare("SELECT count(*) AS n FROM graduation").first<any>()).n,
    ).toBe(1);

    // the next pass re-reads the same range and the log is gone from it
    await tick(env, NOW + 60, fakeChain({ head: 5160, launches: [], graduations: [] }).client);
    expect(
      (await env.LEDGE_DB.prepare("SELECT count(*) AS n FROM graduation").first<any>()).n,
    ).toBe(0);
  });

  it("re-mines a launch onto its new block rather than keeping the old one", async () => {
    await seedCursor(5000, NOW);
    await tick(
      env,
      NOW,
      fakeChain({
        head: 5100,
        launches: [launchLog(TOKEN_A, 5050, 3, "0xtxold")],
        graduations: [],
        timestampOf: (block) => NOW - 10_000 + block,
      }).client,
    );
    const before = await env.LEDGE_DB.prepare("SELECT * FROM launch").first<any>();
    expect(before.block).toBe(5050);

    await tick(
      env,
      NOW + 60,
      fakeChain({
        head: 5160,
        launches: [launchLog(TOKEN_A, 5062, 0, "0xtxnew")],
        graduations: [],
        timestampOf: (block) => NOW - 10_000 + block,
      }).client,
    );
    const rows = await env.LEDGE_DB.prepare("SELECT * FROM launch").all();
    expect(rows.results).toHaveLength(1);
    expect((rows.results[0] as any).block).toBe(5062);
    expect((rows.results[0] as any).ts).toBe(NOW - 10_000 + 5062);
    expect((rows.results[0] as any).tx_hash).toBe("0xtxnew");
  });

  it("leaves rows below the re-read range alone", async () => {
    await seedCursor(5000, NOW);
    await env.LEDGE_DB.prepare(
      `INSERT INTO launch VALUES ('0xbefore', '0xc', '0x0', 'eth', 0, NULL, 10, ?, '0xt', 0)`,
    )
      .bind(NOW - 3600)
      .run();
    await tick(env, NOW, fakeChain({ head: 5100, launches: [], graduations: [] }).client);
    const rows = await env.LEDGE_DB.prepare("SELECT token FROM launch").all();
    expect(rows.results.map((r: any) => r.token)).toEqual(["0xbefore"]);
  });
});

/* B8 — a block header that did not come back.

   The tick skipped the log and advanced the cursor over its block, so the
   log was lost for good and the pass returned ok. A missing header is not a
   log with no timestamp; it is a pass that cannot be completed, and the whole
   dataset rests on the header being the time a thing happened (METHOD.md
   "Source"). */
describe("a missing block header", () => {
  beforeEach(async () => {
    await reset();
  });

  function chainWithNoHeaders() {
    return new RpcClient("http://unused", async (payload) => {
      const batch = payload as Array<{ id: number; method: string; params: any[] }>;
      return batch.map((request) => {
        if (request.method === "eth_blockNumber") return { id: request.id, result: "0x1450" };
        if (request.method === "eth_getLogs") {
          return {
            id: request.id,
            result:
              request.params[0].topics[0] === TOPIC_TOKEN_LAUNCHED
                ? [launchLog(TOKEN_A, 1050, 3, "0xtx1")]
                : [],
          };
        }
        if (request.method === "eth_getBlockByNumber") return { id: request.id, result: null };
        return { id: request.id, result: null };
      });
    });
  }

  it("fails the tick rather than dropping the log", async () => {
    await seedCursor(1000, NOW);
    const result = await tick(env, NOW, chainWithNoHeaders());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/header/i);
  });

  it("holds the cursor so the next pass reads the same blocks again", async () => {
    await seedCursor(1000, NOW);
    await tick(env, NOW, chainWithNoHeaders());
    const cursor = await env.LEDGE_DB.prepare("SELECT * FROM cursor").first<any>();
    expect(cursor.last_indexed_block).toBe(1000);
    expect(cursor.consecutive_failures).toBe(1);
    expect(cursor.last_error).toBeTruthy();
  });

  it("writes nothing at all on that pass", async () => {
    await seedCursor(1000, NOW);
    await tick(env, NOW, chainWithNoHeaders());
    const rows = await env.LEDGE_DB.prepare("SELECT count(*) AS n FROM launch").first<any>();
    expect(rows.n).toBe(0);
  });
});

/* W2 — retention against a launch's own graduation.

   Seven days of launches, seven days of graduations, both keyed on their own
   timestamp: a launch that graduated five hours after it launched was evicted
   five hours before its graduation was, and for those five hours the
   graduation had no launch to be a graduation OF. */
describe("retention keeps a launch as long as its graduation", () => {
  beforeEach(async () => {
    await reset();
  });

  it("keeps a launch just past the cutoff whose graduation is still inside it", async () => {
    await seedCursor(500_000, NOW);
    await env.LEDGE_DB.batch([
      env.LEDGE_DB.prepare(
        `INSERT INTO launch VALUES ('0xslow', '0xc', '0x0', 'eth', 0, NULL, 10, ?, '0xt1', 0)`,
      ).bind(NOW - RETENTION_SECONDS - 3600),
      env.LEDGE_DB.prepare(`INSERT INTO graduation VALUES ('0xslow', 20, ?, '1', '0xt2', 0)`).bind(
        NOW - RETENTION_SECONDS + 3600,
      ),
    ]);
    await tick(env, NOW, fakeChain({ head: 500_100, launches: [], graduations: [] }).client);
    const rows = await env.LEDGE_DB.prepare("SELECT token FROM launch").all();
    expect(rows.results.map((r: any) => r.token)).toEqual(["0xslow"]);
  });

  it("still evicts a launch past the cutoff that never graduated", async () => {
    await seedCursor(500_000, NOW);
    await env.LEDGE_DB.prepare(
      `INSERT INTO launch VALUES ('0xgone', '0xc', '0x0', 'eth', 0, NULL, 10, ?, '0xt1', 0)`,
    )
      .bind(NOW - RETENTION_SECONDS - 3600)
      .run();
    await tick(env, NOW, fakeChain({ head: 500_100, launches: [], graduations: [] }).client);
    const rows = await env.LEDGE_DB.prepare("SELECT count(*) AS n FROM launch").first<any>();
    expect(rows.n).toBe(0);
  });
});

/* Phase A — the curve index.

   Curves are deployed per launch: ~564 CurveBuy/CurveSell events a minute
   across ~19,000 live curves, filtered by topic0 alone because there is no
   address to filter on. What is stored is never the events -- 812,000 rows a
   day would not fit the plan -- but one folded row per token, ~121 of them
   touched in any five-minute window. */
describe("curve activity", () => {
  const CURVE_A = "0x00000000000000000000000000000000000000c1";
  const CURVE_B = "0x00000000000000000000000000000000000000c2";
  const BUYER_1 = "0x0000000000000000000000000000000000000b01";
  const BUYER_2 = "0x0000000000000000000000000000000000000b02";

  beforeEach(async () => {
    await reset();
  });

  async function activityOf(token: string) {
    return env.LEDGE_DB.prepare("SELECT * FROM token_activity WHERE token = ?")
      .bind(token)
      .first<any>();
  }

  it("folds buys and sells onto the token whose curve emitted them", async () => {
    await seedCursor(1000, NOW);
    const { client } = fakeChain({
      head: 1100,
      launches: [launchLog(TOKEN_A, 1050, 0, "0xtx1", CURVE_A)],
      graduations: [],
      buys: [buyLog(CURVE_A, BUYER_1, 300n, 1051), buyLog(CURVE_A, BUYER_2, 200n, 1052)],
      sells: [sellLog(CURVE_A, BUYER_1, 120n, 1053)],
      timestampOf: (block) => NOW - 1100 + block,
    });
    const result = await tick(env, NOW, client);
    expect(result.ok).toBe(true);

    const row = await activityOf(TOKEN_A);
    expect(row.buys).toBe(2);
    expect(row.sells).toBe(1);
    expect(row.quote_in).toBe("500");
    expect(row.quote_out).toBe("120");
    expect(row.from_block).toBe(1050); // the launch block, not the first trade
    expect(row.first_buy_ts).toBe(NOW - 1100 + 1051);
    expect(row.last_activity_ts).toBe(NOW - 1100 + 1053);
  });

  it("counts the distinct buyers in the launch's own block", async () => {
    await seedCursor(1000, NOW);
    const { client } = fakeChain({
      head: 1100,
      launches: [launchLog(TOKEN_A, 1050, 0, "0xtx1", CURVE_A)],
      graduations: [],
      buys: [
        buyLog(CURVE_A, BUYER_1, 10n, 1050, 1),
        buyLog(CURVE_A, BUYER_1, 10n, 1050, 2),
        buyLog(CURVE_A, BUYER_2, 10n, 1050, 3),
        buyLog(CURVE_A, BUYER_2, 10n, 1060, 0),
      ],
      timestampOf: (block) => NOW - 1100 + block,
    });
    await tick(env, NOW, client);
    const row = await activityOf(TOKEN_A);
    expect(row.first_block_buyers).toBe(2);
    expect(row.buys).toBe(4);
  });

  it("records a launch nobody bought as a row saying so", async () => {
    await seedCursor(1000, NOW);
    const { client } = fakeChain({
      head: 1100,
      launches: [launchLog(TOKEN_A, 1050, 0, "0xtx1", CURVE_A)],
      graduations: [],
      timestampOf: (block) => NOW - 1100 + block,
    });
    await tick(env, NOW, client);
    const row = await activityOf(TOKEN_A);
    expect(row.buys).toBe(0);
    expect(row.first_block_buyers).toBe(0);
    expect(row.first_buy_ts).toBeNull();
  });

  /* The overlap exists so a reorg cannot leave a launch behind, and launches
     and graduations are rewritten from the fresh logs because they are keyed
     on the log's own identity. A counter cannot be un-added, so the counters
     fold only the blocks above the previous cursor -- exactly once each. */
  it("does not count a trade twice when its block is re-read", async () => {
    await seedCursor(1000, NOW);
    const chain = {
      launches: [launchLog(TOKEN_A, 1050, 0, "0xtx1", CURVE_A)],
      graduations: [] as any[],
      buys: [buyLog(CURVE_A, BUYER_1, 300n, 1051)],
      timestampOf: (block: number) => NOW - 1100 + block,
    };
    await tick(env, NOW, fakeChain({ ...chain, head: 1100 }).client);
    expect((await activityOf(TOKEN_A)).buys).toBe(1);

    await tick(env, NOW + 60, fakeChain({ ...chain, head: 1160 }).client);
    expect((await activityOf(TOKEN_A)).buys).toBe(1);
  });

  it("counts a log whose curve it cannot place rather than dropping it", async () => {
    await seedCursor(1000, NOW);
    const { client } = fakeChain({
      head: 1100,
      launches: [launchLog(TOKEN_A, 1050, 0, "0xtx1", CURVE_A)],
      graduations: [],
      buys: [buyLog(CURVE_A, BUYER_1, 10n, 1051), buyLog(CURVE_B, BUYER_1, 10n, 1052)],
      timestampOf: (block) => NOW - 1100 + block,
    });
    const result = await tick(env, NOW, client);
    expect(result.unattributed).toBe(1);
    const meta = await env.LEDGE_DB.prepare("SELECT * FROM activity_unattributed").first<any>();
    expect(meta.logs).toBe(1);
    expect((await activityOf(TOKEN_A)).buys).toBe(1);
  });

  it("attributes a trade to a launch indexed on an earlier pass", async () => {
    await seedCursor(1000, NOW);
    await tick(
      env,
      NOW,
      fakeChain({
        head: 1100,
        launches: [launchLog(TOKEN_A, 1050, 0, "0xtx1", CURVE_A)],
        graduations: [],
        timestampOf: (block) => NOW - 1100 + block,
      }).client,
    );
    await tick(
      env,
      NOW + 60,
      fakeChain({
        head: 1700,
        launches: [],
        graduations: [],
        buys: [buyLog(CURVE_A, BUYER_1, 77n, 1650)],
        timestampOf: (block) => NOW - 1100 + block,
      }).client,
    );
    const row = await activityOf(TOKEN_A);
    expect(row.buys).toBe(1);
    expect(row.quote_in).toBe("77");
    expect(row.first_block_buyers).toBe(0); // measured on the pass that read block 1050
  });

  /* REPOSITION.md: two extra eth_getLogs per tick, and nothing else against
     the subrequest budget. */
  it("spends two extra log requests a tick and no more", async () => {
    await seedCursor(10_000, NOW);
    const { client, calls } = fakeChain({ head: 10_600, launches: [], graduations: [] });
    await tick(env, NOW, client);
    // 1,800 blocks of factory range at 1,000 a window, two topics: 4. The
    // 600 new blocks carry the two curve topics: 2.
    expect(calls.getLogs).toBe(6);
  });
});

/* Retention (requirement 5). An activity row is pruned by the same seven-day
   rule, and the chain of dependencies runs one way: a graduation keeps its
   launch, and activity keeps the launch that carries the curve the activity
   was attributed by. Evicting the launch under a live curve would turn every
   later trade on it into an unattributed reading. */
describe("retention reaches the activity rows", () => {
  beforeEach(async () => {
    await reset();
  });

  async function tickOnce() {
    await tick(env, NOW, fakeChain({ head: 500_100, launches: [], graduations: [] }).client);
  }

  it("prunes an activity row whose last event is past the cutoff", async () => {
    await seedCursor(500_000, NOW);
    await env.LEDGE_DB.prepare(
      `INSERT INTO token_activity VALUES ('0xold', 10, 1, 0, '1', '0', ?, ?, 1)`,
    )
      .bind(NOW - RETENTION_SECONDS - 10, NOW - RETENTION_SECONDS - 10)
      .run();
    await tickOnce();
    const rows = await env.LEDGE_DB.prepare("SELECT count(*) AS n FROM token_activity").first<any>();
    expect(rows.n).toBe(0);
  });

  it("keeps a launch past the cutoff whose curve is still trading", async () => {
    await seedCursor(500_000, NOW);
    await env.LEDGE_DB.batch([
      env.LEDGE_DB.prepare(
        `INSERT INTO launch VALUES ('0xlive', '0xc', '0x0', 'eth', 0, NULL, 10, ?, '0xt1', 0)`,
      ).bind(NOW - RETENTION_SECONDS - 3600),
      env.LEDGE_DB.prepare(
        `INSERT INTO token_activity VALUES ('0xlive', 10, 3, 0, '3', '0', ?, ?, 1)`,
      ).bind(NOW - RETENTION_SECONDS - 3000, NOW - 60),
    ]);
    await tickOnce();
    const rows = await env.LEDGE_DB.prepare("SELECT token FROM launch").all();
    expect(rows.results.map((r: any) => r.token)).toEqual(["0xlive"]);
  });

  it("keeps an activity row while its graduation is still held", async () => {
    await seedCursor(500_000, NOW);
    await env.LEDGE_DB.batch([
      env.LEDGE_DB.prepare(`INSERT INTO graduation VALUES ('0xgrad', 20, ?, '1', '0xt2', 0)`).bind(
        NOW - 60,
      ),
      env.LEDGE_DB.prepare(
        `INSERT INTO token_activity VALUES ('0xgrad', 10, 3, 0, '3', '0', ?, ?, 1)`,
      ).bind(NOW - RETENTION_SECONDS - 3000, NOW - RETENTION_SECONDS - 10),
    ]);
    await tickOnce();
    const rows = await env.LEDGE_DB.prepare("SELECT token FROM token_activity").all();
    expect(rows.results.map((r: any) => r.token)).toEqual(["0xgrad"]);
  });
});

/* Requirement 5 — reconciliation. The aggregates are the only record of
   812,000 events a day, so they have to agree with a replay of the same logs:
   the same trades folded in one pass and folded in three reach the same row. */
describe("the aggregates against a replay of the same logs", () => {
  const CURVE_A = "0x00000000000000000000000000000000000000c1";
  const BUYER_1 = "0x0000000000000000000000000000000000000b01";
  const BUYER_2 = "0x0000000000000000000000000000000000000b02";

  const launches = [launchLog(TOKEN_A, 1050, 0, "0xtx1", CURVE_A)];
  const buys = [
    buyLog(CURVE_A, BUYER_1, 11n, 1050, 1),
    buyLog(CURVE_A, BUYER_2, 22n, 1050, 2),
    buyLog(CURVE_A, BUYER_1, 44n, 1300, 0),
    buyLog(CURVE_A, BUYER_2, 88n, 1900, 0),
  ];
  const sells = [sellLog(CURVE_A, BUYER_1, 3n, 1301), sellLog(CURVE_A, BUYER_2, 5n, 1901)];
  const timestampOf = (block: number) => NOW - 2000 + block;

  async function rowAfter(heads: number[]) {
    await reset();
    await seedCursor(1000, NOW);
    let clock = NOW;
    for (const head of heads) {
      await tick(
        env,
        clock,
        fakeChain({ head, launches, graduations: [], buys, sells, timestampOf }).client,
      );
      clock += 60;
    }
    const row = await env.LEDGE_DB.prepare("SELECT * FROM token_activity WHERE token = ?")
      .bind(TOKEN_A)
      .first<any>();
    return row;
  }

  it("reaches the same counters in one pass and in three", async () => {
    const once = await rowAfter([2000]);
    const thrice = await rowAfter([1200, 1600, 2000]);
    expect(thrice).toEqual(once);
  });

  it("counts every log the replay contains, exactly once", async () => {
    const row = await rowAfter([1200, 1600, 2000]);
    expect(row.buys).toBe(buys.length);
    expect(row.sells).toBe(sells.length);
    expect(row.quote_in).toBe("165");
    expect(row.quote_out).toBe("8");
    expect(row.first_block_buyers).toBe(2);
  });
});

/* The measured cost of a minute, at the volume the chain actually runs at.

   ~564 curve events a minute across ~121 distinct curves, ~13 launches a
   minute, against a free-plan budget of 50 subrequests per invocation. This
   counts every request the tick puts on the wire -- one per batch, one per
   log query -- so the budget can be read off the assertion rather than
   argued about. */
describe("what one minute of chain costs", () => {
  beforeEach(async () => {
    await reset();
  });

  it("stays inside the subrequest budget at the measured event rate", async () => {
    const base = 100_000;
    await seedCursor(base, NOW);

    const curves: string[] = [];
    const seeds: D1PreparedStatement[] = [];
    for (let i = 0; i < 121; i++) {
      const curve = "0x" + (i + 1).toString(16).padStart(40, "0");
      const token = "0x" + (i + 1001).toString(16).padStart(40, "0");
      curves.push(curve);
      seeds.push(
        env.LEDGE_DB.prepare(
          `INSERT INTO launch VALUES (?, ?, '0x0', 'eth', 0, NULL, ?, ?, ?, 0)`,
        ).bind(token, curve, base - 500 + i, NOW - 600, `0xseed${i}`),
      );
    }
    await env.LEDGE_DB.batch(seeds);

    const buys = [];
    const sells = [];
    for (let i = 0; i < 564; i++) {
      const curve = curves[i % curves.length] as string;
      const block = base + 1 + (i % 600);
      if (i % 3 === 2) sells.push(sellLog(curve, "0x" + "b1".padStart(40, "0"), 1n, block, i));
      else buys.push(buyLog(curve, "0x" + "b2".padStart(40, "0"), 1n, block, i));
    }
    const launches = Array.from({ length: 13 }, (_, i) =>
      launchLog(
        "0x" + (i + 5000).toString(16).padStart(40, "0"),
        base + 10 + i,
        i,
        `0xnew${i}`,
        "0x" + (i + 9000).toString(16).padStart(40, "0"),
      ),
    );

    let sent = 0;
    const inner = fakeChain({
      head: base + 600,
      launches,
      graduations: [],
      buys,
      sells,
      timestampOf: (block) => NOW - 600 + (block - base),
    });
    const counting = new RpcClient("http://unused", async (payload) => {
      sent += 1;
      return (inner.client as any).transport(payload);
    });

    const result = await tick(env, NOW, counting);
    expect(result.ok).toBe(true);
    expect(result.trades).toBe(564);
    expect(result.launches).toBe(13);

    /* Measured, not bounded loosely. Thirteen requests: one eth_blockNumber,
       four factory log queries over the 1,800-block re-read, two curve log
       queries over the 600 new blocks (the two extra REPOSITION.md budgeted
       for), five batches carrying the block headers the counters need and
       the factory view for the new launches. D1 adds four calls -- the
       cursor read, the curve lookup, the activity read and the write batch.
       Seventeen against a free-plan allowance of fifty. */
    expect(sent).toBe(13);
    expect(sent).toBeLessThan(50);
    const rows = await env.LEDGE_DB.prepare(
      "SELECT count(*) AS n, sum(buys) AS b, sum(sells) AS s FROM token_activity",
    ).first<any>();
    expect(rows.b).toBe(buys.length);
    expect(rows.s).toBe(sells.length);
    expect(result.unattributed).toBe(0);
  }, 120_000);
});

/* The fold writes a row whole, because a uint256 sum is BigInt addition and
   SQLite cannot do it in an UPDATE. A row it seeds without reading first is
   therefore a row it silently zeroes, so every token a pass touches -- the
   launches it seeds as well as the curves that traded -- is read back first. */
describe("a pass that seeds a row for a token it already holds", () => {
  beforeEach(async () => {
    await reset();
  });

  it("keeps the counters a previous pass wrote", async () => {
    await seedCursor(5000, NOW);
    await env.LEDGE_DB.prepare(
      `INSERT INTO token_activity VALUES (?, 4000, 9, 2, '900', '20', ?, ?, 3)`,
    )
      .bind(TOKEN_A, NOW - 400, NOW - 300)
      .run();
    await tick(
      env,
      NOW,
      fakeChain({
        head: 5100,
        launches: [launchLog(TOKEN_A, 5050, 0, "0xtx1", "0x00000000000000000000000000000000000000c1")],
        graduations: [],
        timestampOf: (block) => NOW - 1100 + block,
      }).client,
    );
    const row = await env.LEDGE_DB.prepare("SELECT * FROM token_activity WHERE token = ?")
      .bind(TOKEN_A)
      .first<any>();
    expect(row.buys).toBe(9);
    expect(row.quote_in).toBe("900");
  });
});
