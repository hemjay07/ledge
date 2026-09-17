/* The daily digest: one message a day to the room, from number.json.

   the 13 Sep brainstorm (internal notes) §2: every pons account that gets quoted posts; a
   correct page at a URL waits. So the room carries, besides graduations as
   they land, one message a day with the published 24-hour figures, each
   with its n. Everything here is read from the file stats.py wrote and
   pushed to KV -- the Worker formats, it does not compute (gate 2). A file
   older than its own bound is still posted, with its age on the line,
   because a missing digest tells the room nothing and a stale one tells it
   exactly what is wrong (CONSTRAINTS 5, 7).

   Once a day, at DIGEST_HOUR_UTC, gated by a KV key for the UTC day so a
   tick that runs twice in the hour posts once. */

import type { Env } from "./env";
import { ageSeconds, formatAge, formatCount, formatDuration, formatOneIn, formatStamp, isInsufficient, rateText } from "./format";
import { loadNumber, type NumberFile } from "./numberFile";
import { sendMessage, withinLimits } from "./telegram";

export const DIGEST_HOUR_UTC = 12;
/** The one cron Cloudflare keeps (wrangler.toml [triggers]); must fire
    inside DIGEST_HOUR_UTC or shouldPostDigest refuses it. */
export const DIGEST_CRON = "5 12 * * *";
export const KV_DIGEST_POSTED = "digest:posted";

/** The UTC day a clock reading falls in, as the KV value that marks it posted. */
export function digestDayKey(nowSeconds: number): string {
  return new Date(nowSeconds * 1000).toISOString().slice(0, 10);
}

export function shouldPostDigest(nowSeconds: number, postedDay: string | null): boolean {
  if (new Date(nowSeconds * 1000).getUTCHours() !== DIGEST_HOUR_UTC) return false;
  return postedDay !== digestDayKey(nowSeconds);
}

export function digestText(file: NumberFile, nowMs: number, siteOrigin: string): string {
  const h24 = file.h24;
  const fact = { rate: h24.rate, n: h24.launches, insufficient: h24.insufficient };
  const ef = h24.excludingFast;
  const efFact = { rate: ef.rate, n: h24.launches, insufficient: ef.insufficient };
  const oneIn = !isInsufficient(efFact) && ef.oneIn !== null ? ` (${formatOneIn(ef.oneIn)})` : "";
  const ttg = h24.ttg;
  const median =
    ttg.insufficient || ttg.p50 === null
      ? `Median time to graduation: not enough data (n=${formatCount(ttg.n)}).`
      : `Half the graduations took under ${formatDuration(ttg.p50)} (n=${formatCount(ttg.n)}).`;
  const all = file.allTime;
  const allFact = { rate: all.rate, n: all.launches, insufficient: all.insufficient };
  const stamp = formatStamp(file.crawledAt);
  const day = stamp.replace(/^Measured /, "").replace(/ \d{4} · .*$/, "");
  const clock = stamp.replace(/^.* · /, "");
  const since = file.firstIndexedAt ? formatStamp(file.firstIndexedAt).replace(/^Measured /, "").replace(/ \d{4} · .*$/, "") : null;

  // 2026-09-14: written as a short report for a feed -- a dated heading,
  // the day's figures, the first-buy shares, the whole record, the stamp.
  const lines = [
    `pons, ${day} — the last 24 hours`,
    "",
    `${formatCount(h24.launches)} launches. ${formatCount(h24.graduations)} graduated, ${rateText(fact)}.`,
    `Leaving out graduations under ${formatDuration(ef.cutoffSeconds)}: ${formatCount(ef.graduations)}, ${rateText(efFact)}${oneIn}.`,
    median,
  ];
  const fb = file.firstBuy?.cohorts.all[0];
  if (fb) {
    const n = { n: fb.n, insufficient: fb.insufficient };
    lines.push(
      "",
      `First outside buy, launches at least an hour old (n=${formatCount(fb.n)}): ${rateText({ rate: fb.within1sShare, ...n })} within 1 s, ${rateText({ rate: fb.within5sShare, ...n })} within 5 s, ${rateText({ rate: fb.noneShare, ...n })} none.`,
    );
  }
  lines.push(
    "",
    `${since ? `Since ${since}: ` : "Whole record: "}${formatCount(all.graduations)} of ${formatCount(all.launches)} launches graduated, ${rateText(allFact)}.`,
    `Measured ${clock}, ${formatAge(ageSeconds(file.crawledAt, nowMs))} ago. ${siteOrigin}/method`,
  );
  return lines.join("\n");
}

/** Runs beside the tick from the scheduled handler. Never throws into the
    tick: a Telegram outage or a missing chat id is not an indexing failure. */
export async function announceDigest(env: Env, nowMs: number): Promise<void> {
  if (!env.TELEGRAM_GRAVEYARD_CHAT_ID) return;
  const nowSeconds = Math.floor(nowMs / 1000);
  const posted = await env.LEDGE_KV.get(KV_DIGEST_POSTED, "text");
  if (!shouldPostDigest(nowSeconds, posted)) return;

  const file = await loadNumber(env, nowMs);
  if (!file) return;

  const chatId = env.TELEGRAM_GRAVEYARD_CHAT_ID;
  if (!(await withinLimits(env.LEDGE_DB, chatId, nowSeconds))) return; // next tick, same hour
  // The day is marked only once Telegram accepted the message; a refused
  // send is tried again on the next tick inside the hour.
  if (await sendMessage(env, chatId, digestText(file, nowMs, env.SITE_ORIGIN))) {
    await env.LEDGE_KV.put(KV_DIGEST_POSTED, digestDayKey(nowSeconds));
  }
}
