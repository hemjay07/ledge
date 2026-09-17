import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fileStateStore, runTicker, tickerConfigFromEnv, type TickerConfig, type TickerDeps } from "../../host/ticker";
import type { LookupOutcome } from "../../src/service";
import { countdownText, liveText, pastWindow, tickerText } from "../../src/ticker";
import { ACTIVITY, makeBody } from "./helpers";

const okBody = () => makeBody({ activity: ACTIVITY, fill: { filledWei: "1200000000000000000", thresholdWei: "10000000000000000000", share: 0.12, note: null } });

const NOW = Date.UTC(2026, 8, 17, 16, 12, 5);
const SITE = "https://ledge.tools";

type Ok = Exclude<LookupOutcome, { kind: "not_a_pons_token" } | { kind: "rpc_down" }>;
function outcome(overrides: Partial<ReturnType<typeof okBody>> = {}): Ok {
  const body = { ...okBody(), ...overrides };
  return { kind: "ok", body, text: "", observedMaxSeconds: 3600, lastIndexedBlock: body.live.lastIndexedBlock };
}

describe("ticker text", () => {
  it("counts down before the address exists", () => {
    const text = countdownText("2026-09-17T16:00:00Z", SITE);
    expect(text).toContain("launches 17 Sep, 16:00 UTC");
    expect(text).toContain(`${SITE}/launch`);
  });

  it("prints the live reading with the same sentences as the /t page, and no rate without its n", () => {
    const text = liveText(outcome().body, 3600, NOW / 1000);
    expect(text).toContain("Curve fill:");
    expect(text).toMatch(/\d+ buys?, \d+ sells?/);
    expect(text).toContain("First outside buy:");
    expect(text).toContain("Updated 16:12 UTC.");
    expect(text).toContain(`${SITE}/t/${outcome().body.address}`);
    for (const line of text.split("\n")) {
      if (/\d+(\.\d+)?%/.test(line)) expect(line).toMatch(/of the threshold|n=/);
    }
  });

  it("leaves the message alone when the chain could not be read", () => {
    expect(tickerText({ kind: "rpc_down" }, "0xabc", NOW / 1000, SITE)).toBeNull();
  });

  it("says the launch is not indexed yet rather than inventing a reading", () => {
    const text = tickerText({ kind: "not_a_pons_token" }, okBody().address, NOW / 1000, SITE);
    expect(text).toContain("Not in the index yet.");
  });

  it("closes the ticker once the launch is older than the window", () => {
    const body = okBody();
    const old = outcome({ state: { ...body.state, elapsedSeconds: 25 * 3600 } });
    expect(pastWindow(old, NOW / 1000, 24)).toBe(true);
    expect(pastWindow(outcome(), NOW / 1000, 24)).toBe(false);
    expect(liveText(old.body, 3600, NOW / 1000, true)).toContain("Final reading");
  });
});

function fakeDeps(lookup: LookupOutcome): TickerDeps & { edits: string[]; posts: string[]; state: { current: unknown } } {
  const posts: string[] = [];
  const edits: string[] = [];
  const state: { current: unknown } = { current: null };
  return {
    posts,
    edits,
    state,
    lookup: vi.fn(async () => lookup),
    post: vi.fn(async (_chat, text) => {
      posts.push(text);
      return 77;
    }),
    edit: vi.fn(async (_chat, _id, text) => {
      edits.push(text);
      return true;
    }),
    allowed: vi.fn(async () => true),
    readState: async () => state.current as never,
    writeState: async (s) => {
      state.current = s;
    },
  };
}

const CONFIG: TickerConfig = { chatId: "@ledgetools", address: okBody().address, launchAt: null, hours: 24, siteOrigin: SITE };

describe("runTicker", () => {
  it("posts once, then edits the same message", async () => {
    const deps = fakeDeps(outcome());
    expect(await runTicker(CONFIG, deps, NOW)).toBe("posted");
    expect(deps.posts).toHaveLength(1);
    expect(await runTicker(CONFIG, deps, NOW + 60_000)).toBe("edited");
    expect(deps.edit).toHaveBeenCalledWith("@ledgetools", 77, expect.stringContaining("Updated 16:13 UTC."));
    expect(deps.posts).toHaveLength(1);
  });

  it("does not edit when nothing changed", async () => {
    const deps = fakeDeps(outcome());
    await runTicker(CONFIG, deps, NOW);
    expect(await runTicker(CONFIG, deps, NOW + 1_000)).toBe("unchanged");
    expect(deps.edits).toHaveLength(0);
  });

  it("keeps the countdown message and turns it into the live ticker when the address arrives", async () => {
    const deps = fakeDeps(outcome());
    expect(await runTicker({ ...CONFIG, address: null, launchAt: "2026-09-17T16:00:00Z" }, deps, NOW)).toBe("posted");
    expect(deps.posts[0]).toContain("launches 17 Sep");
    expect(await runTicker(CONFIG, deps, NOW + 60_000)).toBe("edited");
    expect(deps.edits[0]).toContain("Curve fill:");
    expect(deps.posts).toHaveLength(1);
  });

  it("skips, and posts nothing, when the chain is down or the chat is over its limit", async () => {
    const down = fakeDeps({ kind: "rpc_down" });
    expect(await runTicker(CONFIG, down, NOW)).toBe("skipped");
    expect(down.posts).toHaveLength(0);
    const limited = fakeDeps(outcome());
    limited.allowed = vi.fn(async () => false);
    expect(await runTicker(CONFIG, limited, NOW)).toBe("skipped");
    expect(limited.posts).toHaveLength(0);
  });

  it("marks the message final past the window and never touches it again", async () => {
    const body = okBody();
    const deps = fakeDeps(outcome({ state: { ...body.state, elapsedSeconds: 25 * 3600 } }));
    await runTicker(CONFIG, deps, NOW);
    (deps.state.current as { final: boolean }).final = false; // the first post is marked final already; check the edit path too
    expect(await runTicker(CONFIG, deps, NOW + 60_000)).toBe("final");
    expect(await runTicker(CONFIG, deps, NOW + 120_000)).toBe("final");
    expect(deps.edits).toHaveLength(1);
  });

  it("persists the message id to the state file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ticker-"));
    const store = fileStateStore(join(dir, "state.json"));
    expect(await store.readState()).toBeNull();
    await store.writeState({ chatId: "@ledgetools", messageId: 5, lastText: "x", final: false });
    expect((await store.readState())?.messageId).toBe(5);
  });

  it("reads its settings from the environment", () => {
    expect(tickerConfigFromEnv({ TELEGRAM_GRAVEYARD_CHAT_ID: "@ledgetools" }, SITE)).toBeNull();
    expect(tickerConfigFromEnv({ TELEGRAM_GRAVEYARD_CHAT_ID: "@ledgetools", LEDGE_LAUNCH_AT: "2026-09-17T16:00:00Z" }, SITE)).toMatchObject({
      chatId: "@ledgetools",
      address: null,
      hours: 24,
    });
    expect(tickerConfigFromEnv({ TELEGRAM_TICKER_CHAT_ID: "-100", LEDGE_TOKEN_ADDRESS: "0xABC", TICKER_HOURS: "6" }, SITE)).toMatchObject({
      chatId: "-100",
      address: "0xabc",
      hours: 6,
    });
  });
});
