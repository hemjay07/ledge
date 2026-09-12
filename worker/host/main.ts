/* Runs the Worker's tick() in a loop on a plain Node host, against the real
   Cloudflare D1 database over its HTTP API. No change to tick's source: this
   file only builds an Env the tick already knows how to use and drives the
   loop INDEXER.md section 2 describes.

   Usage:
     node dist/host.mjs            # loop forever, one tick per TICK_INTERVAL_MS
     node dist/host.mjs --once     # one tick, then exit (for a cutover test) */

import { readFile } from "node:fs/promises";
import type { Env } from "../src/env";
import { RpcClient } from "../src/rpc";
import { tick, type TickResult } from "../src/tick";
import { D1HttpClient } from "./d1-http";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}

/** The tick reads one thing from KV: `pair-tokens:current` (numberFile.ts
    loadPairTokens), the pair-token registry the crawl publishes from
    data/pair-tokens.json -- it decides a launch's pair_class. On the box the
    repository is checked out (the crawl runs there too), so the same file is
    read from disk. Any other key, and every write, throws: the tick has no
    business with them, and a silent stub would hide a new dependency. */
function kvStub(pairTokensPath: string): Env["LEDGE_KV"] {
  const notImplemented = (method: string) => () => {
    throw new Error(
      `LEDGE_KV.${method}() called from the host: the tick must not touch KV (see worker/host/main.ts)`,
    );
  };
  return {
    get: async (key: string) => {
      if (key !== "pair-tokens:current") notImplemented("get")();
      return JSON.parse(await readFile(pairTokensPath, "utf8"));
    },
    put: notImplemented("put"),
    delete: notImplemented("delete"),
    list: notImplemented("list"),
    getWithMetadata: notImplemented("getWithMetadata"),
  } as unknown as Env["LEDGE_KV"];
}

export interface HostConfig {
  rpcUrl: string;
  rpcUrlFallback?: string;
  factoryAddress: string;
  chainId: string;
  numberJsonUrl: string;
  siteOrigin: string;
  telegramBotToken?: string;
  telegramWebhookSecret?: string;
  telegramHeaderSecret?: string;
  telegramGraveyardChatId?: string;
  cloudflareAccountId: string;
  d1DatabaseId: string;
  d1ApiToken: string;
  tickIntervalMs: number;
  rpcBudget: number;
  /** data/pair-tokens.json in the checked-out repository (see kvStub). */
  pairTokensPath: string;
}

export function loadConfigFromEnv(): HostConfig {
  return {
    rpcUrl: requireEnv("RPC_URL"),
    rpcUrlFallback: process.env.RPC_URL_FALLBACK || undefined,
    factoryAddress: requireEnv("FACTORY_ADDRESS"),
    chainId: requireEnv("CHAIN_ID"),
    numberJsonUrl: requireEnv("NUMBER_JSON_URL"),
    siteOrigin: requireEnv("SITE_ORIGIN"),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
    telegramHeaderSecret: process.env.TELEGRAM_HEADER_SECRET || undefined,
    telegramGraveyardChatId: process.env.TELEGRAM_GRAVEYARD_CHAT_ID || undefined,
    cloudflareAccountId: requireEnv("CLOUDFLARE_ACCOUNT_ID"),
    d1DatabaseId: requireEnv("D1_DATABASE_ID"),
    d1ApiToken: requireEnv("D1_API_TOKEN"),
    tickIntervalMs: Number(process.env.TICK_INTERVAL_MS ?? 10_000),
    // The Worker used 40 because of Cloudflare's own 50-subrequest-per-invocation
    // limit. A plain Node host has no such ceiling, hence the larger default.
    rpcBudget: Number(process.env.RPC_BUDGET ?? 400),
    pairTokensPath: process.env.PAIR_TOKENS_PATH ?? "../data/pair-tokens.json",
  };
}

export function buildEnv(config: HostConfig): Env {
  const db = new D1HttpClient({
    accountId: config.cloudflareAccountId,
    databaseId: config.d1DatabaseId,
    apiToken: config.d1ApiToken,
  });
  return {
    LEDGE_DB: db as unknown as Env["LEDGE_DB"],
    LEDGE_KV: kvStub(config.pairTokensPath),
    FACTORY_ADDRESS: config.factoryAddress,
    CHAIN_ID: config.chainId,
    RPC_URL: config.rpcUrl,
    RPC_URL_FALLBACK: config.rpcUrlFallback,
    NUMBER_JSON_URL: config.numberJsonUrl,
    SITE_ORIGIN: config.siteOrigin,
    TELEGRAM_BOT_TOKEN: config.telegramBotToken,
    TELEGRAM_WEBHOOK_SECRET: config.telegramWebhookSecret,
    TELEGRAM_HEADER_SECRET: config.telegramHeaderSecret,
    TELEGRAM_GRAVEYARD_CHAT_ID: config.telegramGraveyardChatId,
  };
}

function logTick(result: TickResult): void {
  const parts = [
    `from=${result.from}`,
    `to=${result.to}`,
    `launches=${result.launches}`,
    `graduations=${result.graduations}`,
  ];
  if (result.trades !== undefined) parts.push(`trades=${result.trades}`);
  if (result.unattributed !== undefined) parts.push(`unattributed=${result.unattributed}`);
  if (!result.ok) parts.push(`ok=false`, `error=${result.error ?? "unknown"}`);
  if (result.skipped) parts.push(`skipped=${result.skipped}`);
  console.log(parts.join(" "));
}

export type TickFn = (env: Env, nowSeconds?: number, client?: RpcClient) => Promise<TickResult>;

export interface LoopOptions {
  intervalMs: number;
  once?: boolean;
  tickFn?: TickFn;
  sleep?: (ms: number) => Promise<void>;
  /** Resolves once SIGTERM/SIGINT has asked the loop to stop after the
      in-flight tick. Injectable so tests never touch real signal handlers. */
  shouldStop?: () => boolean;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Drives the tick on an interval that never overlaps: a tick that runs long
    starts the next one immediately rather than double-scheduling. An
    exception from a tick is logged and the loop continues -- the cron model
    tick.ts itself documents ("the cron is the outer retry loop"). */
export async function runLoop(env: Env, options: LoopOptions): Promise<void> {
  const tickFn = options.tickFn ?? tick;
  const sleep = options.sleep ?? realSleep;
  const shouldStop = options.shouldStop ?? (() => false);

  do {
    const startedAt = Date.now();
    try {
      const result = await tickFn(env);
      logTick(result);
    } catch (error) {
      console.error("tick threw", error instanceof Error ? error.stack ?? error.message : String(error));
    }
    if (options.once) return;
    if (shouldStop()) return;
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, options.intervalMs - elapsed);
    if (remaining > 0) await sleep(remaining);
  } while (!shouldStop());
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const config = loadConfigFromEnv();
  const env = buildEnv(config);

  let stopping = false;
  const requestStop = () => {
    stopping = true;
  };
  process.once("SIGTERM", requestStop);
  process.once("SIGINT", requestStop);

  await runLoop(env, {
    intervalMs: config.tickIntervalMs,
    once,
    // A fresh RpcClient per tick: RpcClient.subrequests never resets once
    // spent, so reusing one instance across ticks would make every tick
    // after the first fail with "subrequest budget spent" forever. tick.ts
    // itself always constructs one per invocation for the same reason --
    // each Worker cron run is a fresh invocation. This is the equivalent for
    // a loop that keeps the process alive between ticks.
    tickFn: (e, nowSeconds) =>
      tick(e, nowSeconds, new RpcClient(config.rpcUrl, undefined, config.rpcUrlFallback, undefined, config.rpcBudget)),
    shouldStop: () => stopping,
  });

  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((error) => {
    console.error("host: fatal", error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
