/* The launch-day ticker (design brainstorm of 2026-09-16, build 3): one
   message in the room that edits itself while the LEDGE token is on its
   curve. Counts and times only, the same sentences the /t page prints, so
   the room and the page cannot disagree. No narrative, no verdict.

   This file is the text. Posting and editing live in worker/host/ticker.ts,
   which runs on the box beside the tick. */

import { formatStamp, shortAddress } from "./format";
import type { TokenResponse } from "./schema";
import type { LookupOutcome } from "./service";
import { activitySentences, cohortSuppressed, fillSentence, stateSentence } from "./text";

/** How long after launch the ticker keeps editing. A day covers every
    graduation on record and the whole of the launch-day conversation. */
export const TICKER_HOURS_DEFAULT = 24;

/** "17 Sep, 16:00 UTC" for a time in running text. */
function timeOf(iso: string): string {
  return formatStamp(iso).replace(/^Measured /, "").replace(/ \d{4} · /, ", ");
}

/** "Updated 17:12 UTC" -- the clock the reader checks against the message's
    own edit time. */
function updatedLine(nowSeconds: number): string {
  const d = new Date(nowSeconds * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `Updated ${hh}:${mm} UTC.`;
}

/** Before the token exists: the message that becomes the ticker. */
export function countdownText(launchAt: string | null, siteOrigin: string): string {
  const when = launchAt ? `launches ${timeOf(launchAt)}` : "launch";
  return [
    `LEDGE on pons: ${when}.`,
    "Once the curve exists this message becomes the live ticker: fill, buys, sells, the first outside buy. Edited every minute.",
    `Pre-registration: ${siteOrigin}/launch`,
  ].join("\n");
}

/** The address is set but the index has no launch row yet. */
export function waitingText(address: string, nowSeconds: number, siteOrigin: string): string {
  return [
    `LEDGE on pons: ${shortAddress(address)}.`,
    "Not in the index yet. Checked every minute.",
    updatedLine(nowSeconds),
    `${siteOrigin}/t/${address}`,
  ].join("\n");
}

/** The live reading. `final` closes the ticker after TICKER_HOURS. */
export function liveText(
  body: Omit<TokenResponse, "text">,
  observedMaxSeconds: number | null,
  nowSeconds: number,
  final = false,
): string {
  const lines: string[] = [`LEDGE on pons: ${shortAddress(body.address)}.`];
  const launched = body.state.launchedAt ? `Launched ${timeOf(body.state.launchedAt)}. ` : "";
  lines.push(`${launched}${stateSentence(body, observedMaxSeconds)}`);
  lines.push(fillSentence(body.state, body.config, cohortSuppressed(body)));
  lines.push(...activitySentences(body));
  const a = body.activity;
  if (a) lines.push(`Counted from block ${a.window.fromBlock} to ${a.window.toBlock}.`);
  if (body.live.stale) lines.push("The live index has not completed a pass in over 5 minutes.");
  lines.push(final ? "Final reading; the page keeps counting." : updatedLine(nowSeconds));
  lines.push(`${body.links.method.replace(/\/method$/, "")}/t/${body.address}`);
  return lines.join("\n");
}

/** Picks the message for a lookup outcome. Null means leave the message as
    it is: the chain could not be read, and a ticker must not claim anything
    it has not just read. */
export function tickerText(
  outcome: LookupOutcome,
  address: string,
  nowSeconds: number,
  siteOrigin: string,
  final = false,
): string | null {
  if (outcome.kind === "rpc_down") return null;
  if (outcome.kind === "not_a_pons_token") return waitingText(address, nowSeconds, siteOrigin);
  if (outcome.body.state.launchedAt === null) return waitingText(address, nowSeconds, siteOrigin);
  return liveText(outcome.body, outcome.observedMaxSeconds, nowSeconds, final);
}

/** True once the launch is older than the ticker's window. */
export function pastWindow(outcome: LookupOutcome, nowSeconds: number, hours: number): boolean {
  if (outcome.kind !== "ok" && outcome.kind !== "not_indexed" && outcome.kind !== "number_unavailable") return false;
  const elapsed = outcome.body.state.elapsedSeconds;
  return elapsed !== null && elapsed > hours * 3600 && nowSeconds > 0;
}
