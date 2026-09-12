import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { RpcClient } from "../../src/rpc";
import { GRAVEYARD_AGE_SECONDS } from "../../src/graveyard";
import { tick } from "../../src/tick";
import { reset, seedCursor } from "./setup";

async function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`https://api.ledge.tools${path}`), env);
}

interface SeedOptions {
  token: string;
  pairClass?: string;
  creatorTaxBps?: number | null;
  launchBlock: number;
  launchTs: number;
  buys?: number;
  sells?: number;
  firstBlockBuyers?: number | null;
  lastActivityTs?: number;
}

/* One row on the graveyard is one launch row plus one token_activity row of
   zero buys -- graveyard.ts inner-joins the two exactly as board.ts does, so
   a token with no activity row never appears. */
function seedRow(opts: SeedOptions): D1PreparedStatement[] {
  return [
    env.LEDGE_DB.prepare(`INSERT INTO launch VALUES (?, '0xc', '0x0', ?, ?, NULL, ?, ?, ?, 0)`).bind(
      opts.token,
      opts.pairClass ?? "eth",
      opts.creatorTaxBps ?? null,
      opts.launchBlock,
      opts.launchTs,
      `0xtx${opts.token}`,
    ),
    env.LEDGE_DB.prepare(`INSERT INTO token_activity VALUES (?, ?, ?, ?, '0', '0', NULL, ?, ?, NULL, NULL)`).bind(
      opts.token,
      opts.launchBlock,
      opts.buys ?? 0,
      opts.sells ?? 0,
      opts.lastActivityTs ?? opts.launchTs,
      opts.firstBlockBuyers === undefined ? 0 : opts.firstBlockBuyers,
    ),
  ];
}

beforeEach(async () => {
  await reset();
  await seedCursor(56_172_588, Math.floor(Date.now() / 1000));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/graveyard", () => {
  it("lists a launch at least 72h old with zero buys, and no younger one", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.batch([
      ...seedRow({
        token: "0x111111111111111111111111111111111111111a",
        launchBlock: 56_100_000,
        launchTs: now - GRAVEYARD_AGE_SECONDS - 3_600,
        firstBlockBuyers: 0,
      }),
      ...seedRow({
        token: "0x222222222222222222222222222222222222222b",
        launchBlock: 56_172_000,
        launchTs: now - 3_600, // 1h old, not yet a candidate
      }),
    ]);
    const body = (await (await get("/api/graveyard")).json()) as any;
    expect(body.count).toBe(1);
    expect(body.rows[0].token).toBe("0x111111111111111111111111111111111111111a");
    expect(body.rows[0].buys).toBe(0);
  });

  it("never lists a token with any buys", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.batch(
      seedRow({
        token: "0x333333333333333333333333333333333333333c",
        launchBlock: 56_100_000,
        launchTs: now - GRAVEYARD_AGE_SECONDS - 3_600,
        buys: 1,
      }),
    );
    const body = (await (await get("/api/graveyard")).json()) as any;
    expect(body.count).toBe(0);
  });

  it("states the scope: how many launches the index holds and the oldest one", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.batch(
      seedRow({
        token: "0x444444444444444444444444444444444444444d",
        launchBlock: 56_100_000,
        launchTs: now - GRAVEYARD_AGE_SECONDS - 3_600,
      }),
    );
    const body = (await (await get("/api/graveyard")).json()) as any;
    expect(body.scope.indexedLaunches).toBe(1);
    expect(body.scope.earliestIndexedLaunchAt).not.toBeNull();
    expect(body.scope.label).toContain("1");
  });

  it("tells apart a first block never indexed from one indexed with no buyers", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.batch(
      seedRow({
        token: "0x555555555555555555555555555555555555555e",
        launchBlock: 56_100_000,
        launchTs: now - GRAVEYARD_AGE_SECONDS - 3_600,
        firstBlockBuyers: null,
      }),
    );
    const body = (await (await get("/api/graveyard")).json()) as any;
    expect(body.rows[0].firstBlockBuyers).toBeNull();
    expect(body.rows[0].window.partial).toBe(true);
  });

  it("refuses an unrecognised sort key", async () => {
    const response = await get("/api/graveyard?sort=trending");
    expect(response.status).toBe(400);
  });

  it("sorts oldest-first by default", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.batch([
      ...seedRow({
        token: "0x666666666666666666666666666666666666666f",
        launchBlock: 1,
        launchTs: now - GRAVEYARD_AGE_SECONDS - 1_000,
      }),
      ...seedRow({
        token: "0x777777777777777777777777777777777777777a",
        launchBlock: 2,
        launchTs: now - GRAVEYARD_AGE_SECONDS - 50_000,
      }),
    ]);
    const body = (await (await get("/api/graveyard")).json()) as any;
    expect(body.sortedBy).toBe("age");
    expect(body.rows[0].token).toBe("0x777777777777777777777777777777777777777a");
  });
});

describe("the graveyard's bot post", () => {
  const NOW = Math.floor(Date.now() / 1000);

  /** An RPC client that answers an empty, successful tick: no new launches,
      no graduations, no trades. Only the graveyard's OWN read of D1 (already
      seeded by the test) is exercised. */
  function emptyChain(head: number): RpcClient {
    return new RpcClient("http://unused", async (payload) => {
      const batch = payload as Array<{ id: number; method: string }>;
      return batch.map((request) => {
        if (request.method === "eth_blockNumber") return { id: request.id, result: "0x" + head.toString(16) };
        if (request.method === "eth_getLogs") return { id: request.id, result: [] };
        return { id: request.id, result: null };
      });
    });
  }

  function stubTelegram(): { calls: any[] } {
    const calls: any[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("api.telegram.org")) {
        calls.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response("not stubbed", { status: 500 });
    });
    return { calls };
  }

  beforeEach(async () => {
    await seedCursor(56_172_588, NOW);
  });

  it("posts newly-qualifying launches once, and never repeats them on a later tick", async () => {
    await env.LEDGE_DB.batch(
      seedRow({
        token: "0x888888888888888888888888888888888888888b",
        launchBlock: 56_100_000,
        launchTs: NOW - GRAVEYARD_AGE_SECONDS - 3_600,
      }),
    );
    const { calls } = stubTelegram();
    const envWithChat = {
      ...env,
      TELEGRAM_GRAVEYARD_CHAT_ID: "-1000",
      TELEGRAM_BOT_TOKEN: "test-token",
    } as typeof env;

    const first = await tick(envWithChat, NOW, emptyChain(56_172_588));
    expect(first.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].chat_id).toBe("-1000");
    expect(calls[0].text).toContain("0x888888888888888888888888888888888888888b");
    expect(calls[0].text).not.toMatch(/[\u{1F000}-\u{1FAFF}]/u);

    const posted = await env.LEDGE_DB.prepare("SELECT token FROM graveyard_posted").all();
    expect(posted.results).toHaveLength(1);

    const second = await tick(envWithChat, NOW + 60, emptyChain(56_172_588));
    expect(second.ok).toBe(true);
    expect(calls).toHaveLength(1); // still just the one post -- nothing new to say
  });

  it("posts nothing, and writes nothing, without a configured chat", async () => {
    await env.LEDGE_DB.batch(
      seedRow({
        token: "0x999999999999999999999999999999999999999c",
        launchBlock: 56_100_000,
        launchTs: NOW - GRAVEYARD_AGE_SECONDS - 3_600,
      }),
    );
    const { calls } = stubTelegram();
    const result = await tick(env, NOW, emptyChain(56_172_588));
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
    const posted = await env.LEDGE_DB.prepare("SELECT token FROM graveyard_posted").all();
    expect(posted.results).toHaveLength(0);
  });
});
