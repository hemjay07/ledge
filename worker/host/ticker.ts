/* Drives worker/src/ticker.ts from the box: one message per launch, posted
   once and edited in place on every run. The message id lives in a small
   JSON file (TICKER_STATE_PATH), not in D1: a schema change for one launch
   is not worth a migration, and a file the ledge user owns survives
   restarts and redeploys (the checkout is reset, /home/ledge is not). */

import { readFile, writeFile } from "node:fs/promises";
import type { Env } from "../src/env";
import type { LookupOutcome } from "../src/service";
import { countdownText, pastWindow, tickerText } from "../src/ticker";

export interface TickerState {
  chatId: string;
  messageId: number;
  lastText: string;
  final: boolean;
}

export interface TickerConfig {
  chatId: string;
  /** Null before the launch: the message is a countdown until it is set. */
  address: string | null;
  launchAt: string | null;
  hours: number;
  siteOrigin: string;
}

export interface TickerDeps {
  lookup: (address: string, nowMs: number) => Promise<LookupOutcome>;
  post: (chatId: string, text: string) => Promise<number | null>;
  edit: (chatId: string, messageId: number, text: string) => Promise<boolean>;
  /** The per-chat hourly limit, consulted only for the one post. */
  allowed: (chatId: string) => Promise<boolean>;
  readState: () => Promise<TickerState | null>;
  writeState: (state: TickerState) => Promise<void>;
}

export type TickerResult = "posted" | "edited" | "unchanged" | "skipped" | "final";

export function fileStateStore(path: string): Pick<TickerDeps, "readState" | "writeState"> {
  return {
    readState: async () => {
      try {
        return JSON.parse(await readFile(path, "utf8")) as TickerState;
      } catch {
        return null;
      }
    },
    writeState: async (state) => writeFile(path, JSON.stringify(state, null, 2) + "\n"),
  };
}

async function nextText(config: TickerConfig, deps: TickerDeps, nowMs: number): Promise<{ text: string | null; final: boolean }> {
  const nowSeconds = Math.floor(nowMs / 1000);
  if (config.address === null) return { text: countdownText(config.launchAt, config.siteOrigin), final: false };
  const outcome = await deps.lookup(config.address, nowMs);
  const final = pastWindow(outcome, nowSeconds, config.hours);
  return { text: tickerText(outcome, config.address, nowSeconds, config.siteOrigin, final), final };
}

/** One run: read the state, compose the text, post or edit, save. A message
    already marked final is never touched again. */
export async function runTicker(config: TickerConfig, deps: TickerDeps, nowMs = Date.now()): Promise<TickerResult> {
  const saved = await deps.readState();
  const state = saved && saved.chatId === config.chatId ? saved : null;
  if (state?.final) return "final";

  const { text, final } = await nextText(config, deps, nowMs);
  if (text === null) return "skipped";

  if (state === null) {
    if (!(await deps.allowed(config.chatId))) return "skipped";
    const messageId = await deps.post(config.chatId, text);
    if (messageId === null) return "skipped";
    await deps.writeState({ chatId: config.chatId, messageId, lastText: text, final });
    return "posted";
  }

  if (text === state.lastText && !final) return "unchanged";
  if (!(await deps.edit(config.chatId, state.messageId, text))) return "skipped";
  await deps.writeState({ ...state, lastText: text, final });
  return final ? "final" : "edited";
}

/** Reads the ticker's own settings from the process environment. Null when
    no chat is configured or neither an address nor a launch time is set. */
export function tickerConfigFromEnv(env: NodeJS.ProcessEnv, siteOrigin: string): TickerConfig | null {
  const chatId = env.TELEGRAM_TICKER_CHAT_ID || env.TELEGRAM_GRAVEYARD_CHAT_ID;
  const address = env.LEDGE_TOKEN_ADDRESS?.toLowerCase() || null;
  const launchAt = env.LEDGE_LAUNCH_AT || null;
  if (!chatId || (address === null && launchAt === null)) return null;
  return { chatId, address, launchAt, hours: Number(env.TICKER_HOURS ?? 24), siteOrigin };
}

/** Wires the real Telegram, lookup and limit calls to the config. */
export function tickerDepsFor(
  env: Env,
  statePath: string,
  real: {
    lookup: TickerDeps["lookup"];
    post: (env: Env, chatId: string, text: string) => Promise<number | null>;
    edit: (env: Env, chatId: string, messageId: number, text: string) => Promise<boolean>;
    allowed: (env: Env, chatId: string) => Promise<boolean>;
  },
): TickerDeps {
  return {
    lookup: real.lookup,
    post: (chatId, text) => real.post(env, chatId, text),
    edit: (chatId, messageId, text) => real.edit(env, chatId, messageId, text),
    allowed: (chatId) => real.allowed(env, chatId),
    ...fileStateStore(statePath),
  };
}
