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
    `INSERT OR REPLACE INTO launch VALUES (?, '0xf6e8', '0x0000000000000000000000000000000000000000', 'eth', 300, 56172001, ?, '0xtx', 0)`,
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
  it("renders the population with no address and no ticker in it", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.batch([
      env.LEDGE_DB.prepare(
        `INSERT INTO launch VALUES ('0xaaa', '0xc', '0x0', 'eth', 300, 10, ?, '0xt1', 0)`,
      ).bind(now - 30),
      env.LEDGE_DB.prepare(
        `INSERT INTO launch VALUES ('0xbbb', '0xc', '0x0', 'stable', 0, 11, ?, '0xt2', 0)`,
      ).bind(now - 60),
      env.LEDGE_DB.prepare(
        `INSERT INTO graduation VALUES ('0xbbb', 12, ?, '1', '0xt3', 0)`,
      ).bind(now - 10),
    ]);
    const response = await get("/api/live");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("0xaaa");
    expect(text).not.toContain("0xbbb");

    const body = JSON.parse(text);
    expect(body.count).toBe(2);
    expect(body.rows[0]).toEqual({
      pairClass: "stable",
      taxBucket: "0%",
      ageSeconds: expect.any(Number),
      graduated: true,
    });
    expect(body.lastIndexedBlock).toBe(56_172_588);
  });

  /* W1 — the board reports the same staleness the lookup does. */
  it("declares itself stale when the tick has failed since its last success", async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.LEDGE_DB.prepare(
      `INSERT OR REPLACE INTO cursor VALUES (1, 56172588, ?, ?, 2, 'an outage')`,
    )
      .bind(now, now - 10)
      .run();
    const body = (await (await get("/api/live")).json()) as any;
    expect(body.live.stale).toBe(true);
  });

  it("never returns more than 200 rows", async () => {
    const now = Math.floor(Date.now() / 1000);
    const statements = Array.from({ length: 210 }, (_, i) =>
      /* One row per LOG, so each carries its own (tx_hash, log_index): the
         durable key is the log's identity, not the token's. */
      env.LEDGE_DB.prepare(
        `INSERT INTO launch VALUES (?, '0xc', '0x0', 'eth', 0, ?, ?, ?, 0)`,
      ).bind(
        `0x${i.toString(16).padStart(40, "0")}`,
        i,
        now - i,
        `0xt${i.toString(16)}`,
      ),
    );
    await env.LEDGE_DB.batch(statements);
    const body = (await (await get("/api/live")).json()) as any;
    expect(body.rows).toHaveLength(200);
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
    expect(html).toContain("LEDGE.TOOLS");
    // the facts are in the HTML, not only in a script
    expect(html).toContain("graduated");
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
  });

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
  });
});

/* Phase A — the activity block on the lookup.

   Class B observations about one token: counts and block-header timestamps,
   no rates, no ordering against other tokens. The window is part of the
   object, so no consumer can render a count without the range it covers. */
describe("GET /api/token/{address} — curve activity", () => {
  async function seedActivity(): Promise<void> {
    await env.LEDGE_DB.prepare(
      `INSERT OR REPLACE INTO token_activity VALUES (?, 56172001, 41, 12, '1743200000000000000', '220000000000000000', ?, ?, 7)`,
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
