/* The /t/{address} shell.

   Static export cannot produce per-address HTML for an unbounded address
   space, and one static shell can only carry one og:image -- which would make
   every card unfurl identically. So this is rendered per request, proxied
   through Vercel so the shareable URL stays on the apex domain (section 4).

   REVAMP.md 1.1: this is the decision surface. A reader pastes an address on
   a phone and has to find "is anything real here", "how far along is it" and
   "what did tokens like it do" without reading a paragraph. So the facts are
   laid out as a stack of cards above the sentences, in that order, and the
   sentences -- unchanged, from lookupText -- stay below as the readable long
   form. Every figure below is read straight off `body`; nothing here derives
   a rate, a share or a percentile. The only arithmetic is `share * 100` to
   size one bar against one already-computed ratio, the same operation
   card.ts's own fill bar performs. */

import type { TokenResponse } from "./schema";
import { pairLabel, taxLabel } from "./buckets";
import {
  formatAmount,
  formatCount,
  formatStamp,
} from "./format";
import { cohortSuppressed, freshnessLine, minuteLabel, outcomeWord } from "./text";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function e(value: string | number): string {
  return escapeHtml(String(value));
}

type Body = Omit<TokenResponse, "text">;

/* ---- the headline card: distinct buyers in the launch's own block --------

   REVAMP.md 1.1: "the most prominent reading on the page", because it costs
   real gas and snipe tax to fake. Null and 0 are kept apart on purpose -- see
   activitySentences in text.ts, which this mirrors in structure without
   sharing its sentence, since a card needs a figure and a caption, not a
   sentence. */
function buyersCard(body: Body): string {
  const a = body.activity;
  if (a === null) {
    return `
    <section class="card headline">
      <div class="k">Distinct buyers, launch block</div>
      <div class="fig fig-dash">—</div>
      <div class="note">No curve activity indexed for this token.</div>
    </section>`;
  }
  if (a.firstBlock === null) {
    return `
    <section class="card headline">
      <div class="k">Distinct buyers, launch block</div>
      <div class="fig fig-dash">—</div>
      <div class="note">That block was not indexed.</div>
    </section>`;
  }
  const zero = a.firstBlock.distinctBuyers === 0;
  return `
    <section class="card headline">
      <div class="k">Distinct buyers, launch block ${e(formatCount(a.firstBlock.block))}</div>
      <div class="fig">${e(formatCount(a.firstBlock.distinctBuyers))}</div>
      <div class="note">${zero ? "Block indexed. Nobody bought in it." : "Bought in the block the token launched in."}</div>
    </section>`;
}

/* ---- the fill card: curve fill against THAT launch's own threshold -------

   Never 4.2 ETH assumed (CONSTRAINTS, REVAMP.md 1.1): both quantities come
   from state.curveFilledWei / state.graduationThresholdWei, already read from
   the launch's own curve, in the pair token's own units where pairDecimals is
   known. The bar's width is the one ratio state.curveFilledShare already
   carries -- not computed here, only sized. A graduated curve reads a full
   bar with fillNote saying it was pinned there at graduation (curve.ts
   FILL_GRADUATED); that reading is untouched. */
function fillCard(body: Body): string {
  const { state, config } = body;
  const suppressed = cohortSuppressed(body);

  if (state.curveFilledShare === null) {
    return `
    <section class="card">
      <div class="k">Curve fill</div>
      <div class="fig fig-2 fig-dash">not available</div>
      <div class="note">${e(state.fillNote ?? "not available")}</div>
    </section>`;
  }

  const decimals = config.pairDecimals;
  const filled = decimals === null ? null : formatAmount(state.curveFilledWei ?? "0", decimals, config.pairSymbol);
  const threshold = decimals === null ? null : formatAmount(state.graduationThresholdWei ?? "0", decimals, config.pairSymbol);
  const pct = Math.max(0, Math.min(100, state.curveFilledShare * 100));
  const note = state.fillNote === null ? "" : ` — ${state.fillNote}`;

  if (filled === null || threshold === null) {
    return `
    <section class="card">
      <div class="k">Curve fill</div>
      <div class="fig fig-2">${e(state.curveFilledWei ?? "0")} of ${e(state.graduationThresholdWei ?? "0")}</div>
      <div class="bar"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="note">In the pair token's smallest unit; its decimals are not known${e(note)}.</div>
    </section>`;
  }

  // "Never a lone percentage" (REVAMP.md 1.1): the share only appears beside
  // the two quantities it was drawn from, and only where a suppressed cohort
  // line is not sitting a few lines below it -- same reasoning as
  // fillSentence in text.ts, so the two surfaces never disagree about what is
  // withheld.
  const shareNote = suppressed ? "" : ` (${pct.toFixed(1)}% of the threshold)`;

  return `
    <section class="card">
      <div class="k">Curve fill</div>
      <div class="fig fig-2">${e(filled)} of ${e(threshold)}${shareNote}</div>
      <div class="bar"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
      ${note ? `<div class="note">${e(note.replace(/^ — /, ""))}</div>` : ""}
    </section>`;
}

/* ---- the activity card: what it is doing ---------------------------------

   Every figure carries the window activity.window.label says it was counted
   over, rendered verbatim, per REVAMP.md 1.1. */
function activityCard(body: Body): string {
  const a = body.activity;
  if (a === null) {
    return `
    <section class="card">
      <div class="k">Activity</div>
      <div class="note">No curve activity indexed for this token.</div>
    </section>`;
  }
  const decimals = body.config.pairDecimals;
  const quoteIn = decimals === null ? null : formatAmount(a.quoteIn, decimals, body.config.pairSymbol);
  const quoteOut = decimals === null ? null : formatAmount(a.quoteOut, decimals, body.config.pairSymbol);
  const first = a.firstBuyAt === null ? "no buy recorded yet" : formatStamp(a.firstBuyAt);

  return `
    <section class="card">
      <div class="k">Activity, ${e(a.window.label)}</div>
      <div class="grid">
        <div class="cell"><span class="cell-k">Buys</span><span class="cell-v">${e(formatCount(a.buys))}</span></div>
        <div class="cell"><span class="cell-k">Sells</span><span class="cell-v">${e(formatCount(a.sells))}</span></div>
        <div class="cell"><span class="cell-k">Quote in</span><span class="cell-v">${quoteIn === null ? `${e(a.quoteIn)} (units unknown)` : e(quoteIn)}</span></div>
        <div class="cell"><span class="cell-k">Quote out</span><span class="cell-v">${quoteOut === null ? `${e(a.quoteOut)} (units unknown)` : e(quoteOut)}</span></div>
        <div class="cell"><span class="cell-k">First buy</span><span class="cell-v">${e(first)}</span></div>
        <div class="cell"><span class="cell-k">Last activity</span><span class="cell-v">${e(formatStamp(a.lastActivityAt))}</span></div>
      </div>
    </section>`;
}

/* ---- the cohort card: what tokens like it did, with its n ----------------

   `w` is a Class A object straight off number.json (schema.ts's cohortWindow):
   it already carries `rate`, `insufficient` and `launches`. This only chooses
   which two windows to show and how to word the n < 30 case, exactly as
   cohortSentence in text.ts does for the sentence form. */
function cohortRow(label: string, w: NonNullable<TokenResponse["cohort"]>["allTime"]): string {
  if (!w) return `<div class="cell"><span class="cell-k">${e(label)}</span><span class="cell-v">not published</span></div>`;
  if (w.insufficient || w.rate === null) {
    return `<div class="cell"><span class="cell-k">${e(label)}</span><span class="cell-v">not enough data (n=${e(formatCount(w.launches))})</span></div>`;
  }
  const d = w.launches >= 1000 ? 2 : 1;
  const pct = `${(w.rate * 100).toFixed(d)}%`;
  return `<div class="cell"><span class="cell-k">${e(label)}</span><span class="cell-v">${e(pct)} (n=${e(formatCount(w.launches))})</span></div>`;
}

function cohortCard(body: Body): string {
  const label = `${pairLabel(body.config.pairClass)} · ${body.config.taxBucket === null ? "tax not read" : taxLabel(body.config.taxBucket)}`;
  if (!body.cohort) {
    return `
    <section class="card">
      <div class="k">Tokens configured this way — ${e(label)}</div>
      <div class="note">The published table is not loadable.</div>
    </section>`;
  }
  return `
    <section class="card">
      <div class="k">Tokens configured this way — ${e(label)}</div>
      <div class="grid grid-2">
        ${cohortRow("Last 24 hours", body.cohort.h24)}
        ${cohortRow("All time", body.cohort.allTime)}
      </div>
      <div class="note">Share of launches that graduated.</div>
    </section>`;
}

/* ---- the meta strip: the token's own facts, not a verdict ---------------- */
function metaCard(body: Body, observedMaxSeconds: number | null): string {
  const status = outcomeWord(body, observedMaxSeconds);
  return `
    <section class="card meta">
      <div class="grid grid-2">
        <div class="cell"><span class="cell-k">Address</span><span class="cell-v mono">${e(body.address)}</span></div>
        <div class="cell"><span class="cell-k">Pair</span><span class="cell-v mono">${e(body.config.pairToken)}</span></div>
        <div class="cell"><span class="cell-k">Creator tax</span><span class="cell-v">${body.config.taxBucket === null ? "not read" : e(taxLabel(body.config.taxBucket))}</span></div>
        <div class="cell"><span class="cell-k">Age</span><span class="cell-v">${e(minuteLabel(body.state.elapsedSeconds))}</span></div>
        <div class="cell cell-wide"><span class="cell-k">Status</span><span class="cell-v">${e(status)}</span></div>
      </div>
    </section>`;
}

function staleBanner(body: Body): string {
  if (!body.freshness || !body.freshness.stale) return "";
  const line = freshnessLine(body.freshness);
  return line ? `<div class="stale-banner">${e(line)}</div>` : "";
}

function liveStaleBanner(body: Body): string {
  if (!body.live.stale) return "";
  return `<div class="stale-banner">The live index has not completed a pass in over 5 minutes. Nothing above is being estimated.</div>`;
}

export function tokenShell(
  body: Body,
  text: string,
  title: string,
  siteOrigin: string,
  observedMaxSeconds: number | null = null,
): string {
  const address = body.address;
  const ogImage = `${siteOrigin}/og/t/${address}.png`;
  const canonical = `${siteOrigin}/t/${address}`;
  const facts = text.split("\n").map((line) => `<p>${escapeHtml(line)}</p>`).join("\n      ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — LEDGE</title>
<link rel="canonical" href="${canonical}">
<meta name="description" content="${escapeHtml(title)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(text.split("\n")[3] ?? title)}">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${ogImage}">
<style>
  :root {
    --ground: #EFEAE0;
    --ground-alt: #E5DFD1;
    --ink: #16130F;
    --ink-2: #45413A;
    --ink-muted: #57503F;
    --rule-hair: #CDC6B3;
    --rule-mid: #A9A18C;
    --rule-heavy: #16130F;
    --stale: #B3321C;
    --stale-ink: #FFFFFF;
    --fill: #2F6690;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #121110;
      --ground-alt: #1C1A17;
      --ink: #E8E3D8;
      --ink-2: #B4AEA0;
      --ink-muted: #A39B8A;
      --rule-hair: #38342C;
      --rule-mid: #565046;
      --rule-heavy: #E8E3D8;
      --stale: #F2704A;
      --stale-ink: #121110;
      --fill: #6FA8D8;
    }
  }
  * { box-sizing: border-box; }
  html { background: var(--ground); color: var(--ink); color-scheme: light dark; }
  body {
    margin: 0;
    padding: 1.5rem 1rem 3rem;
    font: 16px/1.5 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--ground);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  main { max-width: 30rem; margin: 0 auto; }
  h1 {
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.22em;
    margin: 0 0 1.25rem;
    color: var(--ink);
  }
  .card {
    border: 1px solid var(--rule-hair);
    background: var(--ground-alt);
    padding: 1rem;
    margin: 0 0 0.75rem;
  }
  .card.headline {
    border-color: var(--rule-mid);
    text-align: left;
  }
  .k {
    font-size: 0.6875rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-muted);
    margin: 0 0 0.4rem;
  }
  .fig {
    font-size: clamp(2.5rem, 15vw, 3.25rem);
    font-weight: 600;
    line-height: 1.05;
    margin: 0 0 0.35rem;
    word-break: break-word;
  }
  .fig-2 { font-size: clamp(1.25rem, 6vw, 1.625rem); font-weight: 600; }
  .fig-dash { color: var(--ink-muted); }
  .note { font-size: 0.8125rem; color: var(--ink-2); margin: 0; }
  .bar {
    height: 0.5rem;
    background: var(--ground);
    border: 1px solid var(--rule-hair);
    margin: 0.6rem 0 0.5rem;
    overflow: hidden;
  }
  .bar-fill { height: 100%; background: var(--fill); }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem 0.75rem;
  }
  .grid-2 { grid-template-columns: 1fr 1fr; }
  .cell { min-width: 0; }
  .cell-wide { grid-column: 1 / -1; }
  .cell-k {
    display: block;
    font-size: 0.6875rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-muted);
    margin: 0 0 0.15rem;
  }
  .cell-v {
    display: block;
    font-size: 0.9375rem;
    word-break: break-word;
  }
  .cell-v.mono { font-size: 0.8125rem; }
  .stale-banner {
    color: var(--stale-ink);
    background: var(--stale);
    padding: 0.5rem 0.75rem;
    font-size: 0.8125rem;
    margin: 0 0 0.75rem;
  }
  hr { border: 0; border-top: 2px solid var(--rule-heavy); margin: 1.75rem 0 1rem; }
  #fact p { margin: 0 0 0.75rem; font-size: 0.9375rem; color: var(--ink-2); }
  footer { color: var(--ink-muted); font-size: 0.8125rem; word-break: break-all; }
  footer p { margin: 0 0 0.4rem; }
  a { color: inherit; }
</style>
</head>
<body>
  <main>
    <h1>LEDGE.TOOLS</h1>
    ${liveStaleBanner(body)}
    ${staleBanner(body)}
    ${buyersCard(body)}
    ${fillCard(body)}
    ${activityCard(body)}
    ${cohortCard(body)}
    ${metaCard(body, observedMaxSeconds)}
    <hr>
    <div id="fact">
      ${facts}
    </div>
    <hr>
    <footer>
      <p>${escapeHtml(body.address)}</p>
      <p><a href="${siteOrigin}/method">${siteOrigin}/method</a></p>
    </footer>
  </main>
  <script type="application/json" id="ledge-data">${JSON.stringify(body).replace(/</g, "\\u003c")}</script>
</body>
</html>`;
}
