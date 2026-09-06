/* The Telegram bot. Webhook only -- no polling, no process.

   It has no template of its own: every reply comes from text.ts, so a
   sentence the bot prints is a sentence the API and the card print. That is
   the enforcement mechanism for "the bot never renders a verdict", not a
   promise about tone.

   Abuse limits: 20 messages an hour per chat, 5,000 a day globally, counted
   in tg_usage as (chat_id, hour, count) and nothing else -- message text is
   never stored. Over the limit the bot goes silent rather than replying "rate
   limited": a reply is itself the resource being abused.

   In groups it answers only /command@... and messages that are exactly an
   address. It never answers an edited message. */

import type { Env } from "./env";
import { normaliseAddress } from "./format";

export const PER_CHAT_HOURLY_LIMIT = 20;
export const GLOBAL_HOURLY_LIMIT = 500;
const GLOBAL_KEY = "__global__";

export interface TgMessage {
  chat: { id: number | string; type: string };
  text?: string;
  entities?: unknown[];
}

export interface TgUpdate {
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
}

export type TgIntent =
  | { kind: "silence" }
  | { kind: "number" }
  | { kind: "help" }
  | { kind: "method" }
  | { kind: "lookup"; address: string }
  | { kind: "unknown_dm" };

/** What the bot understands. A group must address it explicitly or paste an
    address on its own; anything else is silence. */
export function classify(message: TgMessage, botName: string): TgIntent {
  const raw = (message.text ?? "").trim();
  if (raw === "") return { kind: "silence" };

  const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
  const address = normaliseAddress(raw);
  if (address) return { kind: "lookup", address };

  const command = raw.split(/\s+/)[0] ?? "";
  const addressed = command.includes("@");
  const bare = command.replace(`@${botName}`, "").toLowerCase();

  if (isGroup && !addressed) return { kind: "silence" };

  if (bare === "/number") return { kind: "number" };
  if (bare === "/start" || bare === "/help") return { kind: "help" };
  if (bare === "/method") return { kind: "method" };
  return isGroup ? { kind: "silence" } : { kind: "unknown_dm" };
}

export const HELP_TEXT = (siteOrigin: string): string =>
  [
    "LEDGE measures one thing on Robinhood Chain: how many Pons launches graduate, out of how many, over a stated window. Every figure carries its denominator and the time it was computed.",
    "",
    "/number — the current reading",
    "an address — what has happened to launches configured like that one",
    "",
    `${siteOrigin}/method`,
  ].join("\n");

export const UNKNOWN_DM_TEXT = "Two things: /number, or a 20-byte address.";

/** Hour-bucketed counters. Returns false when the chat or the day is over its
    limit, and the caller then sends nothing at all. */
export async function withinLimits(
  db: D1Database,
  chatId: string,
  nowSeconds: number,
): Promise<boolean> {
  const hourKey = Math.floor(nowSeconds / 3600);
  const rows = await db.batch<{ count: number }>([
    db.prepare("SELECT count FROM tg_usage WHERE chat_id = ? AND hour_key = ?").bind(chatId, hourKey),
    db.prepare("SELECT count FROM tg_usage WHERE chat_id = ? AND hour_key = ?").bind(GLOBAL_KEY, hourKey),
  ]);
  const chatCount = rows[0]?.results[0]?.count ?? 0;
  const globalCount = rows[1]?.results[0]?.count ?? 0;
  if (chatCount >= PER_CHAT_HOURLY_LIMIT || globalCount >= GLOBAL_HOURLY_LIMIT) return false;

  const bump = (id: string) =>
    db
      .prepare(
        `INSERT INTO tg_usage (chat_id, hour_key, count) VALUES (?, ?, 1)
         ON CONFLICT(chat_id, hour_key) DO UPDATE SET count = count + 1`,
      )
      .bind(id, hourKey);
  await db.batch([bump(chatId), bump(GLOBAL_KEY)]);
  return true;
}

export async function sendMessage(env: Env, chatId: number | string, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
}
