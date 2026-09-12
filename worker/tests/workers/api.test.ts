import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import worker from "../../src/index";
import { SELECTOR_GET_LAUNCHED_TOKEN } from "../../src/pons";
import {
  SELECTOR_GRADUATED,
  SELECTOR_GRADUATION_THRESHOLD,
  SELECTOR_REAL_QUOTE_RESERVE,
} from "../../src/curve";
import curveFixtures from "../fixtures/curves.json";
import { SELECTOR_DECIMALS, kvDecimalsKey } from "../../src/decimals";
import { reset, seedCursor } from "./setup";
import numberFixture from "../fixtures/number.json";


const ADDRESS = "0x23fe54b3bf9e1d2816822043c0b02b6a12f98fe2";

function word(value: bigint): string {
  return "0x" + value.toString(16).padStart(64, "0");
}

function bareWord(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

/** getLaunchedToken's 15-word tuple, as the factory would answer it. */
function launchedTokenReturn(options: { exists?: boolean; taxBps?: number; phase?: number } = {}) {
  const words = Array.from({ length: 15 }, () => bareWord(0n));
  words[1] = bareWord(BigInt(LIVE_CURVE.curve));
  words[5] = bareWord(4_200_000_000_000_000_000n);
  words[8] = bareWord(BigInt(options.taxBps ?? 300));
  words[10] = bareWord(BigInt(options.phase ?? 0));
  words[14] = bareWord(options.exists === false ? 0n : 1n);
  return "0x" + words.join("");
}

/** The chain, stubbed at the global fetch the RPC client uses. */
function stubChain(handler: (body: any[]) => unknown) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("robinhood")) {
      const payload = JSON.parse(String(init?.body ?? "[]"));
      const result = handler(payload);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not stubbed", { status: 500 });
  });
}

/* The chain answers by selector: the factory view returns the launch tuple,
   and the three curve views return the live curve the research recorded. */
const LIVE_CURVE = curveFixtures.live;

function chainAnswers(returnData: string | null, curveAnswers = true) {
  stubChain((payload) =>
    payload.map((request: any) => {
      if (request.method !== "eth_call") return { id: request.id, result: null };
      const data: string = request.params[0].data;
      if (data.startsWith(SELECTOR_GET_LAUNCHED_TOKEN)) {
        return { id: request.id, result: returnData };
      }
      if (!curveAnswers) return { id: request.id, result: null };
      if (data === SELECTOR_GRADUATED) return { id: request.id, result: word(0n) };
      if (data === SELECTOR_REAL_QUOTE_RESERVE) {
        return { id: request.id, result: word(BigInt(LIVE_CURVE.realQuoteReserve)) };
      }
      if (data === SELECTOR_GRADUATION_THRESHOLD) {
        return { id: request.id, result: word(BigInt(LIVE_CURVE.graduationThreshold)) };
      }
      return { id: request.id, result: null };
    }),
  );
}

async function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`https://api.ledge.tools${path}`), env);
}

async function seedLaunch(ts: number): Promise<void> {
  await env.LEDGE_DB.prepare(
    `INSERT OR REPLACE INTO launch VALUES (?, '0xf6e8', '0x0000000000000000000000000000000000000000', 'eth', 300, '4200000000000000000', 56172001, ?, '0xtx', 0)`,
  )
    .bind(ADDRESS, ts)
    .run();
}

beforeEach(async () => {
  await reset();
  await seedCursor(56_172_588, Math.floor(Date.now() / 1000));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/token/{address}", () => {
  it("answers the documented shape for an indexed Pons token", async () => {
    await seedLaunch(Math.floor(Date.now() / 1000) - 811);
    chainAnswers(launchedTokenReturn());
    const response = await get(`/api/token/${ADDRESS}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toContain("max-age=15");

    const body = (await response.json()) as any;
    expect(body.schemaVersion).toBe(1);
    expect(body.address).toBe(ADDRESS);
    expect(body.venue).toBe("pons");
    expect(body.source).toBe("chain");
    expect(body.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    // Class B
    expect(body.state.indexed).toBe(true);
    expect(body.state.phaseLabel).toBe("on the bonding curve");
    expect(body.state.elapsedSeconds).toBeGreaterThanOrEqual(810);
    // R1: the fill, read from this launch's OWN curve
    expect(body.config.pairSymbol).toBe("ETH");
    expect(body.config.pairDecimals).toBe(18);
    expect(body.text).toContain("Curve fill: 2.245 ETH of 4.2 ETH (53.5% of the threshold).");
    expect(body.state.curveFilledShare).toBe(LIVE_CURVE.expected.share);
    expect(body.state.curveFilledWei).toBe(LIVE_CURVE.expected.filledWei);
    expect(body.state.graduationThresholdWei).toBe(LIVE_CURVE.expected.thresholdWei);
    expect(body.state.fillNote).toBeNull();

    // Class A: every object carries its n, its window and its crawledAt
    for (const key of ["h24", "allTime"]) {
      const w = body.cohort[key];
      expect(w.launches, key).toBeTypeOf("number");
      expect(w.window, key).toBeTruthy();
      expect(w.crawledAt, key).toBe(numberFixture.crawledAt);
      if (w.insufficient) expect(w.rate, key).toBeNull();
    }
    expect(body.placement.n).toBeTypeOf("number");
    expect(body.placement.crawledAt).toBe(numberFixture.crawledAt);
    // asserted against the configured origin, not a literal: the test follows
    // the deployment's own SITE_ORIGIN instead of duplicating it
    expect(body.text).toContain(`${env.SITE_ORIGIN}/method`);
  });

  it("refuses anything that is not a 20-byte hex address", async () => {
    const response = await get("/api/token/not-an-address");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      schemaVersion: 1,
      error: "bad_address",
      message: "Not a 20-byte hex address.",
    });
  });

  it("names the factory when the token did not come from it", async () => {
    chainAnswers(launchedTokenReturn({ exists: false }));
    const response = await get(`/api/token/${ADDRESS}`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as any;
    expect(body.error).toBe("not_a_pons_token");
    expect(body.factory).toBe(env.FACTORY_ADDRESS);
    expect(body.message).toContain(env.FACTORY_ADDRESS);
  });

  it("returns 200 with a partial, not a 404, when the launch is not indexed", async () => {
    chainAnswers(launchedTokenReturn());
    const response = await get(`/api/token/${ADDRESS}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.error).toBe("not_indexed");
    expect(body.lastIndexedBlock).toBe(56_172_588);
    // four correct facts survive the one missing one
    expect(body.partial.config.pairClass).toBe("eth");
    expect(body.partial.config.taxBucket).toBe("2-3%");
    expect(body.partial.cohort.allTime.launches).toBeGreaterThan(0);
    expect(body.partial.state.phase).toBe(0);
    expect(body.partial.state.elapsedSeconds).toBeNull();
    expect(body.partial.placement).toBeNull();
  });

  it("says the RPC did not answer rather than estimating anything", async () => {
    stubChain(() => new Response("boom", { status: 503 }));
    const response = await get(`/api/token/${ADDRESS}`);
    expect(response.status).toBe(503);
    const body = (await response.json()) as any;
    expect(body.error).toBe("rpc_down");
    expect(body.message).toContain("Nothing is being estimated");
    expect(body.retryAfterSeconds).toBe(30);
  }, 30_000);

  it("shows live state alone when the published reading is not loadable", async () => {
    await env.LEDGE_KV.delete("number:current");
    const { resetNumberCache } = await import("../../src/numberFile");
    resetNumberCache();
    await seedLaunch(Math.floor(Date.now() / 1000) - 100);
    stubChain((payload) =>
      payload.map((r: any) => ({ id: r.id, result: r.method === "eth_call" ? launchedTokenReturn() : null })),
    );
    const response = await get(`/api/token/${ADDRESS}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.error).toBe("number_unavailable");
    expect(body.partial.cohort).toBeNull();
    expect(body.partial.state.indexed).toBe(true);
    expect(body.partial.text).toContain("No cohort has been published");
  });

  it("prints no percentage without an n anywhere in the rendered text", async () => {
    await seedLaunch(Math.floor(Date.now() / 1000) - 811);
    chainAnswers(launchedTokenReturn());
    const body = (await (await get(`/api/token/${ADDRESS}`)).json()) as any;
    for (const line of String(body.text).split("\n")) {
      if (!/\d%/.test(line)) continue;
      const isConfigLine = /ETH|Stablecoin|Tokenized stock|Other/.test(line);
      expect(isConfigLine || /n=|\bof \d|graduations measured/.test(line), line).toBe(true);
    }
  });
});

describe("GET /api/live", () => {
  interface SeedOptions {
    token: string;
    pairClass?: string;
    creatorTaxBps?: number | null;
    graduationThreshold?: string | null;
    launchBlock: number;
    launchTs: number;
    graduated?: boolean;
    buys?: number;
    sells?: number;
    quoteIn?: string;
    quoteOut?: string;
    firstBlockBuyers?: number | null;
    lastActivityTs: number;
    fromBlock?: number;
    /** The reserve read (worker/src/reserve.ts / worker/src/tick.ts). Absent
        by default -- a row seeded with neither is the "never read" case, and
        board.ts must render no fill for it regardless of whether a threshold
        is known. */
    reserveWei?: string | null;
    reserveBlock?: number | null;
  }

  /* One row on the board is one launch row plus one token_activity row --
     board.ts inner-joins the two, so a token with no activity row never
     appears (the ~121-row population REPOSITION.md measured). */
  function seedRow(opts: SeedOptions): D1PreparedStatement[] {
    const fromBlock = opts.fromBlock ?? opts.launchBlock;
    return [
      env.LEDGE_DB.prepare(
        `INSERT INTO launch VALUES (?, '0xc', '0x0', ?, ?, ?, ?, ?, ?, 0)`,
      ).bind(
        opts.token,
        opts.pairClass ?? "eth",
        opts.creatorTaxBps ?? null,
        opts.graduationThreshold ?? null,
        opts.launchBlock,
        opts.launchTs,
        `0xtx${opts.token}`,
      ),
      env.LEDGE_DB.prepare(
        `INSERT INTO token_activity VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        opts.token,
        fromBlock,
        opts.buys ?? 1,
        opts.sells ?? 0,
        opts.quoteIn ?? "0",
        opts.quoteOut ?? "0",
        null,
        opts.lastActivityTs,
        opts.firstBlockBuyers === undefined ? 1 : opts.firstBlockBuyers,
        opts.reserveWei ?? null,
        opts.reserveBlock ?? null,
      ),
      ...(opts.graduated
        ? [
            env.LEDGE_DB.prepare(`INSERT INTO graduation VALUES (?, ?, ?, '1', ?, 0)`).bind(
              opts.token,
              opts.launchBlock + 1,
              opts.lastActivityTs,
              `0xgrad${opts.token}`,
            ),
          ]
        : []),
    ];
  }

  it("prints one row per token, with the token address, its counts, and its reserve fill", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.batch([
      ...seedRow({
        token: "0x111111111111111111111111111111111111111a",
        pairClass: "eth",
        creatorTaxBps: 300,
        graduationThreshold: "4200000000000000000",
        launchBlock: 56_172_500,
        launchTs: now - 30,
        buys: 41,
        sells: 12,
        quoteIn: "1743200000000000000",
        quoteOut: "220000000000000000",
        firstBlockBuyers: 7,
        lastActivityTs: now - 5,
        reserveWei: "2245000000000000000",
        reserveBlock: 56_172_580,
      }),
      ...seedRow({
        token: "0x222222222222222222222222222222222222222b",
        pairClass: "stable",
        creatorTaxBps: 0,
        graduationThreshold: "8090000000",
        launchBlock: 56_172_400,
        launchTs: now - 60,
        graduated: true,
        buys: 3,
        sells: 1,
        quoteIn: "100",
        quoteOut: "20",
        lastActivityTs: now - 10,
      }),
    ]);
    const response = await get("/api/live");
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;

    // R1: the token address is permitted -- CONSTRAINTS 2 bans a wallet or a
    // deployer as a subject, never the token itself.
    expect(body.count).toBe(2);
    const tokens = body.rows.map((r: any) => r.token);
    expect(tokens).toContain("0x111111111111111111111111111111111111111a");
    expect(tokens).toContain("0x222222222222222222222222222222222222222b");
    expect(body.sortedBy).toBe("lastActivity");
    expect(body.lastIndexedBlock).toBe(56_172_588);

    const row = body.rows.find((r: any) => r.token === "0x111111111111111111111111111111111111111a");
    expect(row.pairClass).toBe("eth");
    expect(row.pairToken).toBe("0x0");
    expect(row.creatorTaxBps).toBe(300);
    expect(row.launchBlock).toBe(56_172_500);
    expect(row.ageSeconds).toBeGreaterThanOrEqual(30);
    expect(row.graduated).toBe(false);
    expect(row.buys).toBe(41);
    expect(row.sells).toBe(12);
    expect(row.quoteIn).toBe("1743200000000000000");
    expect(row.quoteOut).toBe("220000000000000000");
    expect(row.netQuoteWei).toBe("1523200000000000000");
    expect(row.firstBlockBuyers).toBe(7);
    expect(row.window.fromBlock).toBe(56_172_500);
    expect(row.window.toBlock).toBe(56_172_588);
    expect(row.window.partial).toBe(false);
    expect(row.window.label).toContain("56172500");
    expect(row.window.label).toContain("56172588");
    // R2b: never a lone percentage -- the threshold is labelled and both
    // figures it is measured against travel outside the fill object too.
    // 2026-09-12: this used to assert an INDEXED net-quote fill
    // ("not read from the curve" in the label) -- that figure was wrong by
    // orders of magnitude on wash-traded curves (CONSTRAINTS.md-adjacent
    // finding: -1.40 ETH indexed against 0.007 ETH actually held) and is
    // replaced by a real reserve_wei/reserve_block reading, taken by
    // worker/src/reserve.ts and written by worker/src/tick.ts.
    expect(row.fill.graduationThresholdWei).toBe("4200000000000000000");
    expect(row.fill.reserveWei).toBe("2245000000000000000");
    expect(row.fill.readAtBlock).toBe(56_172_580);
    expect(row.fill.label).toContain("read from the curve at block 56172580");
    expect(row.fill.label).not.toMatch(/\d+(\.\d+)?%/);

    const graduated = body.rows.find((r: any) => r.token === "0x222222222222222222222222222222222222222b");
    expect(graduated.graduated).toBe(true);
  });

  it("renders no fill for a row whose launch carries no threshold, rather than guessing one", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.batch(
      seedRow({
        token: "0x333333333333333333333333333333333333333c",
        pairClass: "other",
        creatorTaxBps: null,
        graduationThreshold: null,
        launchBlock: 56_172_300,
        launchTs: now - 200,
        lastActivityTs: now - 100,
      }),
    );
    const body = (await (await get("/api/live")).json()) as any;
    expect(body.rows[0].fill).toBeNull();
    expect(body.rows[0].creatorTaxBps).toBeNull();
  });

  // 2026-09-12: graduated() drains the curve to a reserve of 0 -- the exact
  // reading a naive fill would misread as "just started", not "finished".
  // `graduated` on the row (read from the `graduation` table, independent of
  // this reading) must stay true, and the fill itself must still be shown as
  // the real reserve_wei that was read, never suppressed because it is 0.
  it("shows a graduated row's real fill, reserve 0, rather than hiding it", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.batch(
      seedRow({
        token: "0xdddddddddddddddddddddddddddddddddddddddd",
        pairClass: "eth",
        graduationThreshold: "4200000000000000000",
        graduated: true,
        launchBlock: 56_172_100,
        launchTs: now - 500,
        lastActivityTs: now - 30,
        reserveWei: "0",
        reserveBlock: 56_172_580,
      }),
    );
    const body = (await (await get("/api/live")).json()) as any;
    const row = body.rows[0];
    expect(row.graduated).toBe(true);
    expect(row.fill).not.toBeNull();
    expect(row.fill.reserveWei).toBe("0");
    expect(row.fill.graduationThresholdWei).toBe("4200000000000000000");
    expect(row.fill.readAtBlock).toBe(56_172_580);
  });

  it("marks a row's window partial when its own launch block was never indexed", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.batch(
      seedRow({
        token: "0x444444444444444444444444444444444444444d",
        launchBlock: 56_100_000,
        fromBlock: 56_150_000,
        launchTs: now - 5000,
        firstBlockBuyers: null,
        lastActivityTs: now - 100,
      }),
    );
    const body = (await (await get("/api/live")).json()) as any;
    expect(body.rows[0].window.partial).toBe(true);
    expect(body.rows[0].window.label).toContain("predates LEDGE's indexed record");
    expect(body.rows[0].firstBlockBuyers).toBeNull();
  });

  it("sorts by the requested column and names that column in the payload", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.batch([
      ...seedRow({
        token: "0x555555555555555555555555555555555555555e",
        launchBlock: 1,
        launchTs: now - 10,
        buys: 3,
        lastActivityTs: now - 10,
      }),
      ...seedRow({
        token: "0x666666666666666666666666666666666666666f",
        launchBlock: 2,
        launchTs: now - 20,
        buys: 99,
        lastActivityTs: now - 20,
      }),
    ]);
    const body = (await (await get("/api/live?sort=buys")).json()) as any;
    expect(body.sortedBy).toBe("buys");
    expect(body.rows[0].token).toBe("0x666666666666666666666666666666666666666f");
    expect(body.rows[0].buys).toBe(99);
  });

  /* `age` orders biggest-first like every other key, so it puts the OLDEST
     launch first. `newest` is the opposite ordering a discovery reader wants,
     on the launch block itself. Both are orderings of a shown quantity. */
  it("orders age oldest-first and newest by launch block, opposite ways round", async () => {
    const now = Math.floor(Date.now() / 1000);
    const older = "0x777777777777777777777777777777777777777a";
    const newer = "0x888888888888888888888888888888888888888b";
    await env.LEDGE_DB.batch([
      ...seedRow({ token: older, launchBlock: 10, launchTs: now - 900, lastActivityTs: now - 10 }),
      ...seedRow({ token: newer, launchBlock: 20, launchTs: now - 30, lastActivityTs: now - 20 }),
    ]);

    const byAge = (await (await get("/api/live?sort=age")).json()) as any;
    expect(byAge.sortedBy).toBe("age");
    expect(byAge.rows[0].token).toBe(older);

    const byNewest = (await (await get("/api/live?sort=newest")).json()) as any;
    expect(byNewest.sortedBy).toBe("newest");
    expect(byNewest.rows[0].token).toBe(newer);
    expect(byNewest.rows[0].launchBlock).toBe(20);
  });

  it("refuses an unrecognised sort key with 400 rather than defaulting silently", async () => {
    const response = await get("/api/live?sort=trending");
    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.error).toBe("bad_sort");
    expect(body.message).toContain("trending");
  });

  /* W1 — the board reports the same staleness the lookup does. */
  it("declares itself stale when the tick has failed since its last success", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.prepare(
      `INSERT OR REPLACE INTO cursor
         (id, last_indexed_block, last_tick_at, last_success_at, consecutive_failures, last_error)
       VALUES (1, 56172588, ?, ?, 2, 'an outage')`,
    )
      .bind(now, now - 10)
      .run();
    const body = (await (await get("/api/live")).json()) as any;
    expect(body.live.stale).toBe(true);
  });

  it("never returns more than 200 rows", async () => {
    const now = Math.floor(Date.now() / 1000);
    const statements = Array.from({ length: 210 }, (_, i) =>
      seedRow({
        token: `0x${i.toString(16).padStart(40, "0")}`,
        launchBlock: i,
        launchTs: now - i,
        lastActivityTs: now - i,
      }),
    ).flat();
    await env.LEDGE_DB.batch(statements);
    const body = (await (await get("/api/live")).json()) as any;
    expect(body.rows).toHaveLength(200);
  });

  /* REPOSITION.md's whole feasibility argument for this board: 121 live
     curves read individually would be 121+ subrequests against a free-plan
     budget of 50. This pins the guarantee that the board reads D1 only, at
     roughly that population, so a future change that adds a per-row RPC read
     is caught here rather than in production. */
  it("costs zero chain subrequests at the measured population, however many rows it reads", async () => {
    const now = Math.floor(Date.now() / 1000);
    const statements = Array.from({ length: 121 }, (_, i) =>
      seedRow({
        token: `0x${(i + 1).toString(16).padStart(40, "0")}`,
        launchBlock: i,
        launchTs: now - i,
        graduationThreshold: "4200000000000000000",
        creatorTaxBps: 100,
        buys: i,
        lastActivityTs: now - i,
      }),
    ).flat();
    await env.LEDGE_DB.batch(statements);

    let chainCalls = 0;
    vi.stubGlobal("fetch", async () => {
      chainCalls += 1;
      return new Response("not stubbed", { status: 500 });
    });
    try {
      const response = await get("/api/live");
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.count).toBe(121);
      expect(chainCalls).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the other endpoints", () => {
  it("serves /api/number byte-identically from KV", async () => {
    const response = await get("/api/number");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await response.text()).toBe(JSON.stringify(numberFixture));
  });

  it("reports the two clocks on /api/health", async () => {
    const body = (await (await get("/api/health")).json()) as any;
    expect(body.lastIndexedBlock).toBe(56_172_588);
    expect(body.consecutiveFailures).toBe(0);
    expect(body.numberCrawledAt).toBe(numberFixture.crawledAt);
  });

  it("serves /t/{address} as HTML with per-address unfurl metadata", async () => {
    await seedLaunch(Math.floor(Date.now() / 1000) - 811);
    chainAnswers(launchedTokenReturn());
    const response = await get(`/t/${ADDRESS}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain(`<meta property="og:image" content="${env.SITE_ORIGIN}/og/t/${ADDRESS}.png">`);
    expect(html).toContain(`${env.SITE_ORIGIN}/t/${ADDRESS}`);
    expect(html).toContain("minute 13");
    // 2026-09-12, REVAMP.md 1.1: the old shell printed a static "LEDGE.TOOLS"
    // <h1>; the rebuilt page carries the site's own top bar instead, whose
    // mark reads "LEDGE" and links home, matching site/components/TopBar.tsx.
    expect(html).toContain('class="topbar-mark">LEDGE</a>');
    // the facts are in the HTML, not only in a script
    expect(html).toContain("graduated");
  });

  // 2026-09-12, REVAMP.md 1.1: the decision surface gained the site's own
  // shell, a redirecting lookup form, and a collapsed long form.
  it("the shell carries the top bar's form and all four nav links", async () => {
    await seedLaunch(Math.floor(Date.now() / 1000) - 811);
    chainAnswers(launchedTokenReturn());
    const html = await (await get(`/t/${ADDRESS}`)).text();
    expect(html).toContain('<form class="topbar-find" method="get" action="/t">');
    expect(html).toContain('name="address"');
    for (const label of ["Live", "Graduated", "Graveyard", "Reference"]) {
      expect(html).toContain(`>${label}</a>`);
    }
  });

  it("GET /t?address= redirects to the token's own page, bare or inside a pasted URL", async () => {
    const bare = await get(`/t?address=${ADDRESS}`);
    expect(bare.status).toBe(302);
    expect(bare.headers.get("Location")).toBe(`/t/${ADDRESS}`);

    const pasted = await get(`/t?address=${encodeURIComponent(`https://ponsfamily.com/token/${ADDRESS}?ref=tg`)}`);
    expect(pasted.status).toBe(302);
    expect(pasted.headers.get("Location")).toBe(`/t/${ADDRESS}`);
  });

  it("GET /t?address= with no address 400s with the site's own wording", async () => {
    const response = await get("/t?address=not-an-address");
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("That is not a 20-byte address.");

    const missing = await get("/t");
    expect(missing.status).toBe(400);
    expect(await missing.text()).toBe("That is not a 20-byte address.");
  });

  it("the pair token's zero address prints as ETH, never as hex, on the shell", async () => {
    await seedLaunch(Math.floor(Date.now() / 1000) - 811);
    chainAnswers(launchedTokenReturn());
    const html = await (await get(`/t/${ADDRESS}`)).text();
    expect(html).toContain("ETH · creator tax");
    // The zero address legitimately appears once, inside the embedded JSON
    // data island (`config.pairToken`, for programmatic consumers) -- never
    // in the rendered cards, header or sentences a reader actually reads.
    const visible = html.split('<script type="application/json"')[0] as string;
    expect(visible).not.toContain("0x0000000000000000000000000000000000000000");
  });

  it("the sentences render inside a collapsed <details>, buyers before fill in the DOM", async () => {
    await seedLaunch(Math.floor(Date.now() / 1000) - 811);
    chainAnswers(launchedTokenReturn());
    const html = await (await get(`/t/${ADDRESS}`)).text();
    expect(html).toMatch(/<details class="fact-details">[\s\S]*<summary>As text/);
    expect(html).toMatch(/<div id="fact">[\s\S]*<\/details>/);

    const buyersAt = html.indexOf("Distinct buyers, launch block");
    const fillAt = html.indexOf(">Curve fill<");
    expect(buyersAt).toBeGreaterThan(-1);
    expect(fillAt).toBeGreaterThan(-1);
    expect(buyersAt).toBeLessThan(fillAt);
  });

  it("renders the death card as a PNG at 1200x630", async () => {
    await seedLaunch(Math.floor(Date.now() / 1000) - 811);
    chainAnswers(launchedTokenReturn());
    const response = await get(`/og/t/${ADDRESS}.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    const png = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer);
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(630);
  }, 30_000);

  it("serves the same card under the shell's own path", async () => {
    await seedLaunch(Math.floor(Date.now() / 1000) - 811);
    chainAnswers(launchedTokenReturn());
    const response = await get(`/t/${ADDRESS}/og.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
  }, 30_000);

  it("answers a preflight with GET and OPTIONS only", async () => {
    const response = await worker.fetch(
      new Request("https://api.ledge.tools/api/live", { method: "OPTIONS" }),
      env,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
  });

  it("refuses a write to a read-only surface", async () => {
    const response = await worker.fetch(
      new Request("https://api.ledge.tools/api/live", { method: "POST" }),
      env,
    );
    expect(response.status).toBe(405);
  });
});

describe("the Telegram webhook", () => {
  async function post(path: string, update: unknown, headers: Record<string, string> = {}) {
    return worker.fetch(
      new Request(`https://api.ledge.tools${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(update),
      }),
      env,
    );
  }

  it("is invisible without the secret path segment", async () => {
    const response = await post("/tg/wrong-secret", {});
    expect(response.status).toBe(404);
  });
});

describe("the Telegram abuse limits", () => {
  it("counts per chat and per hour, and stores no message text", async () => {
    const { withinLimits, PER_CHAT_HOURLY_LIMIT } = await import("../../src/telegram");
    const now = 1_788_720_000;
    for (let i = 0; i < PER_CHAT_HOURLY_LIMIT; i++) {
      expect(await withinLimits(env.LEDGE_DB, "chat-1", now), `message ${i}`).toBe(true);
    }
    // over the limit the bot goes silent rather than replying "rate limited"
    expect(await withinLimits(env.LEDGE_DB, "chat-1", now)).toBe(false);
    // a different chat is unaffected
    expect(await withinLimits(env.LEDGE_DB, "chat-2", now)).toBe(true);
    // and the next hour starts clean
    expect(await withinLimits(env.LEDGE_DB, "chat-1", now + 3600)).toBe(true);

    const columns = await env.LEDGE_DB.prepare("SELECT * FROM tg_usage LIMIT 1").first<any>();
    expect(Object.keys(columns).sort()).toEqual(["chat_id", "count", "hour_key"]);
  }, 30_000);
});

describe("the units a fill is denominated in", () => {
  const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";

  /** A USDG-paired launch, whose curve holds the graduated fixture's figures. */
  function stubUsdgChain(options: { decimals: number | null }) {
    const graduatedCurve = curveFixtures.graduated;
    stubChain((payload) =>
      payload.map((request: any) => {
        if (request.method !== "eth_call") return { id: request.id, result: null };
        const to = String(request.params[0].to).toLowerCase();
        const data: string = request.params[0].data;
        if (data.startsWith(SELECTOR_GET_LAUNCHED_TOKEN)) {
          const words = Array.from({ length: 15 }, () => bareWord(0n));
          words[1] = bareWord(BigInt(graduatedCurve.curve));
          words[4] = bareWord(BigInt(USDG));
          words[5] = bareWord(BigInt(graduatedCurve.graduationThreshold));
          words[8] = bareWord(0n);
          words[10] = bareWord(0n);
          words[14] = bareWord(1n);
          return { id: request.id, result: "0x" + words.join("") };
        }
        if (data === SELECTOR_DECIMALS && to === USDG) {
          return { id: request.id, result: options.decimals === null ? null : word(BigInt(options.decimals)) };
        }
        if (data === SELECTOR_GRADUATED) return { id: request.id, result: word(0n) };
        if (data === SELECTOR_REAL_QUOTE_RESERVE) return { id: request.id, result: word(4_045_000_000n) };
        if (data === SELECTOR_GRADUATION_THRESHOLD) {
          return { id: request.id, result: word(BigInt(graduatedCurve.graduationThreshold)) };
        }
        return { id: request.id, result: null };
      }),
    );
  }

  /* These two exercise a path that legitimately retries: an unknown or
     unreadable decimals() answer is retried before the client gives up and the
     caller prints raw base units. That is correct behaviour and it costs real
     backoff, so the tests carry a timeout that reflects it rather than
     pretending they are instant. Backoff itself was shortened on 2026-09-11
     from 1000/8000 to 250/2000, which is the right size for a job that runs
     every sixty seconds and also brought these back under control. */
  it("reads decimals() once and caches the answer in KV", async () => {
    await env.LEDGE_KV.delete(kvDecimalsKey(USDG));
    stubUsdgChain({ decimals: 6 });
    const body = (await (await get(`/api/token/${ADDRESS}`)).json()) as any;
    const partial = body.partial ?? body;
    expect(partial.config.pairDecimals).toBe(6);
    expect(partial.config.pairSymbol).toBe("USDG");
    // 4045000000 of 8090000000 at six decimals is 4,045 USDG of 8,090
    expect(partial.text).toContain("Curve fill: 4045 USDG of 8090 USDG (50.0% of the threshold).");
    expect(partial.text).not.toContain("4045000000 of");
    expect(await env.LEDGE_KV.get(kvDecimalsKey(USDG), "text")).toBe("6");
  }, 20_000);

  it("prints the raw integer and says so rather than assuming 18", async () => {
    await env.LEDGE_KV.delete(kvDecimalsKey(USDG));
    stubUsdgChain({ decimals: null });
    const body = (await (await get(`/api/token/${ADDRESS}`)).json()) as any;
    const partial = body.partial ?? body;
    expect(partial.config.pairDecimals).toBeNull();
    expect(partial.text).toContain("4045000000 of 8090000000");
    expect(partial.text).toContain("its decimals are not known");
    // an assumed 18 would have rendered this as 0.000000004 of something
    expect(partial.text).not.toContain("0.000000004");
  }, 20_000);
});

/* Phase A — the activity block on the lookup.

   Class B observations about one token: counts and block-header timestamps,
   no rates, no ordering against other tokens. The window is part of the
   object, so no consumer can render a count without the range it covers. */
describe("GET /api/token/{address} — curve activity", () => {
  async function seedActivity(): Promise<void> {
    await env.LEDGE_DB.prepare(
      `INSERT OR REPLACE INTO token_activity VALUES (?, 56172001, 41, 12, '1743200000000000000', '220000000000000000', ?, ?, 7, NULL, NULL)`,
    )
      .bind(ADDRESS, Math.floor(Date.now() / 1000) - 800, Math.floor(Date.now() / 1000) - 40)
      .run();
  }

  it("carries the counts, their window and the first-block buyers", async () => {
    await seedLaunch(Math.floor(Date.now() / 1000) - 811);
    await seedActivity();
    chainAnswers(launchedTokenReturn());
    const body = (await (await get(`/api/token/${ADDRESS}`)).json()) as any;

    expect(body.activity.buys).toBe(41);
    expect(body.activity.sells).toBe(12);
    expect(body.activity.quoteIn).toBe("1743200000000000000");
    expect(body.activity.quoteOut).toBe("220000000000000000");
    expect(body.activity.firstBuyAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.activity.lastActivityAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // the window, named in the object and named in words
    expect(body.activity.window.fromBlock).toBe(56_172_001);
    expect(body.activity.window.toBlock).toBe(56_172_588);
    expect(body.activity.window.label).toContain("56172001");
    expect(body.activity.window.label).toContain("56172588");

    // the coordination reading, with the block it was counted in
    expect(body.activity.firstBlock).toEqual({ block: 56_172_001, distinctBuyers: 7 });
  });

  it("reports no activity row as null rather than as zero", async () => {
    await seedLaunch(Math.floor(Date.now() / 1000) - 811);
    chainAnswers(launchedTokenReturn());
    const body = (await (await get(`/api/token/${ADDRESS}`)).json()) as any;
    expect(body.activity).toBeNull();
  });

  it("publishes no rate, no ordering and no verdict beside the counts", async () => {
    await seedLaunch(Math.floor(Date.now() / 1000) - 811);
    await seedActivity();
    chainAnswers(launchedTokenReturn());
    const body = (await (await get(`/api/token/${ADDRESS}`)).json()) as any;
    expect(Object.keys(body.activity).sort()).toEqual([
      "buys",
      "firstBlock",
      "firstBuyAt",
      "lastActivityAt",
      "quoteIn",
      "quoteOut",
      "sells",
      "window",
    ]);
  });
});

describe("GET /api/health", () => {
  it("reports how many curve logs could not be attributed", async () => {
    await env.LEDGE_DB.prepare(
      "INSERT OR REPLACE INTO activity_unattributed VALUES (1, 12, NULL)",
    ).run();
    const body = (await (await get("/api/health")).json()) as any;
    expect(body.unattributedCurveLogs).toBe(12);
  });
});
