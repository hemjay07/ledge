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
   a rate, a share or a percentile. The arithmetic held here is display-only:
   `share * 100` to size one bar against one already-computed ratio (the same
   operation card.ts's own fill bar performs), and a subtraction of two of
   this token's own timestamps to say how long after launch its first buy
   landed, or how long ago its last activity was -- a Class B observation
   about one token, the same kind lookup.ts's own `elapsedSeconds` is, not an
   aggregation over a population.

   Rebuilt 2026-09-12 (REVAMP.md 1.1, "the per-token page and the lookup --
   the centre of this phase"): the page gained the site's own shell (mark,
   lookup, nav) so a reader who lands here has somewhere else to go; the
   header carries the token's address and its own facts as a single line
   instead of a repeated card; the fill card says when it was read and drops
   its bar once a curve has drained into a graduation; the sentences moved
   into a collapsed <details> so the page is not twice as long as its
   content; and first-buy / last-activity stopped saying "Measured" -- that
   word belongs to a cohort reading taken off a published file, not to the
   time of a buy this page just read off the chain.

   One fact CONSTRAINTS and REVAMP.md 1.1 both ask the meta line to carry --
   the curve's own address -- is not in TokenResponse (worker/src/schema.ts):
   lookup.ts assembles the response and schema.ts defines its shape, and this
   pass was scoped to html.ts, index.ts and the two test files only. Adding
   it means widening the contract in a file this pass does not touch, so the
   meta line below carries the launch block, the status and the measurement
   time it can state honestly, and leaves the curve's address for whoever
   next touches lookup.ts. Recorded here rather than silently dropped. */

import type { TokenResponse } from "./schema";
import { pairLabel, taxLabel } from "./buckets";
import {
  formatAge,
  formatAmount,
  formatCount,
  formatDuration,
  formatStamp,
} from "./format";
import { cohortSuppressed, freshnessLine, outcomeWord } from "./text";

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

/* ---- small time helpers, local to this file --------------------------

   Both read two of this token's own timestamps and subtract them -- the
   same kind of operation lookup.ts's own `elapsedSeconds` performs, just
   applied to a buy time or an activity time instead of "now". Neither
   touches a population, a rate or a cohort, so neither is the arithmetic
   the NO ARITHMETIC note in lookup.ts and text.ts guards against. */

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

function secondsBetween(earlierIso: string, laterIso: string): number {
  return Math.max(0, (new Date(laterIso).getTime() - new Date(earlierIso).getTime()) / 1000);
}

/* ---- the headline card: distinct buyers in the launch's own block --------

   REVAMP.md 1.1: "the most prominent reading on the page", because it costs
   real gas and snipe tax to fake. Null and 0 are kept apart on purpose -- see
   activitySentences in text.ts, which this mirrors in structure without
   sharing its sentence, since a card needs a figure and a caption, not a
   sentence. The `.fig` class carries the same display face the homepage's
   LIVE pulse uses (globals.css `.pulse-figure`), in plain ink rather than the
   accent -- this is a fact about one token, not "live and good". */
function buyersCard(body: Body): string {
  const a = body.activity;
  if (a === null) {
    return `
    <section class="card headline">
      <div class="k">Buyers in the launch block</div>
      <div class="fig fig-dash">—</div>
      <div class="note">No curve activity indexed for this token.</div>
    </section>`;
  }
  if (a.firstBlock === null) {
    return `
    <section class="card headline">
      <div class="k">Buyers in the launch block</div>
      <div class="fig fig-dash">—</div>
      <div class="note">That block was never read: this launch is older than the index.</div>
    </section>`;
  }
  const zero = a.firstBlock.distinctBuyers === 0;
  return `
    <section class="card headline">
      <div class="k">Buyers in the launch block</div>
      <div class="fig">${e(formatCount(a.firstBlock.distinctBuyers))}</div>
      <div class="note">${zero ? "The block was read, and nobody bought in it." : "Distinct wallets that bought in the block this token launched in."}</div>
    </section>`;
}

/* ---- the fill card: curve fill against THAT launch's own threshold -------

   Never 4.2 ETH assumed (CONSTRAINTS, REVAMP.md 1.1): both quantities come
   from state.curveFilledWei / state.graduationThresholdWei, already read from
   the launch's own curve, in the pair token's own units where pairDecimals is
   known. The bar's width is the one ratio state.curveFilledShare already
   carries -- not computed here, only sized.

   A graduated curve has drained: there is nothing left to read a share of,
   so the card says how it ended -- "graduated in {duration}", the exact
   words outcomeWord already renders for the header and the sentences below,
   so the two never disagree -- and prints no bar. A curve still on the
   bonding curve gets one more line than before: this page reads the curve
   live, so it says when, using the same "Measured" wording formatStamp
   already carries for a genuine measurement of the chain, taken this
   request. */
function fillCard(body: Body): string {
  const { state, config } = body;
  const suppressed = cohortSuppressed(body);

  if (state.graduated) {
    return `
    <section class="card">
      <div class="k">Fill</div>
      <div class="fig fig-2">${e(outcomeWord(body, null))}</div>
      <div class="note">The curve drained into graduation. There is nothing left to fill.</div>
    </section>`;
  }

  const readNote = `<div class="note">Read from the curve. ${e(formatStamp(body.observedAt))}.</div>`;

  if (state.curveFilledShare === null) {
    return `
    <section class="card">
      <div class="k">Fill</div>
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
      <div class="k">Fill</div>
      <div class="fig fig-2">${e(state.curveFilledWei ?? "0")} of ${e(state.graduationThresholdWei ?? "0")}</div>
      <div class="bar"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="note">In the pair token's smallest unit; its decimals are not known${e(note)}.</div>
      ${readNote}
    </section>`;
  }

  // "Never a lone percentage" (REVAMP.md 1.1): the share only appears beside
  // the two quantities it was drawn from, and only where a suppressed cohort
  // line is not sitting a few lines below it -- same reasoning as
  // fillSentence in text.ts, so the two surfaces never disagree about what is
  // withheld.
  /* The share on its own line, smaller: the quantities are the figure and
     the share is read off them. One line of large mono wrapped to three on
     a phone when the share sat inside it. */
  const shareNote = suppressed
    ? ""
    : `<div class="fig-share mono">${pct.toFixed(1)}% of the threshold</div>`;

  return `
    <section class="card">
      <div class="k">Fill</div>
      <div class="fig fig-2">${e(filled)} of ${e(threshold)}</div>${shareNote}
      <div class="bar"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
      ${note ? `<div class="note">${e(note.replace(/^ — /, ""))}</div>` : ""}
      ${readNote}
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
      <div class="k">Launches like this one — ${e(label)}</div>
      <div class="note">The published table is not loadable.</div>
    </section>`;
  }
  return `
    <section class="card">
      <div class="k">Launches like this one — ${e(label)}</div>
      <div class="grid grid-2">
        ${cohortRow("Last 24 hours", body.cohort.h24)}
        ${cohortRow("All time", body.cohort.allTime)}
      </div>
      <div class="note">Share that graduated, with the launches each share was counted over.</div>
      <!-- outcomes: what tokens in this cohort did after graduating; lands with the outcomes tracker -->
    </section>`;
}

/* ---- the activity card: what it is doing ---------------------------------

   Every figure carries the window activity.window.label says it was counted
   over, rendered verbatim, per REVAMP.md 1.1. First buy and last activity
   are stated as times, not measurements: "00:20 UTC · 35 s after launch" and
   "00:55 UTC · 35 min ago" read what happened, at the moment it happened --
   "Measured" is the word for a cohort figure taken off a published file,
   which these are not. */
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

  const first =
    a.firstBuyAt === null
      ? "no buy recorded yet"
      : body.state.launchedAt === null
        ? timeOfDay(a.firstBuyAt)
        : `${timeOfDay(a.firstBuyAt)} · ${formatDuration(secondsBetween(body.state.launchedAt, a.firstBuyAt))} after launch`;

  const last = `${timeOfDay(a.lastActivityAt)} · ${formatDuration(secondsBetween(a.lastActivityAt, body.observedAt))} ago`;

  return `
    <section class="card">
      <div class="k">Since launch</div>
      <div class="grid">
        <div class="cell"><span class="cell-k">Buys</span><span class="cell-v">${e(formatCount(a.buys))}</span></div>
        <div class="cell"><span class="cell-k">Sells</span><span class="cell-v">${e(formatCount(a.sells))}</span></div>
        <div class="cell"><span class="cell-k">Paid in</span><span class="cell-v">${quoteIn === null ? `${e(a.quoteIn)} (units unknown)` : e(quoteIn)}</span></div>
        <div class="cell"><span class="cell-k">Taken out</span><span class="cell-v">${quoteOut === null ? `${e(a.quoteOut)} (units unknown)` : e(quoteOut)}</span></div>
        <div class="cell"><span class="cell-k">First buy</span><span class="cell-v">${e(first)}</span></div>
        <div class="cell"><span class="cell-k">Last activity</span><span class="cell-v">${e(last)}</span></div>
      </div>
      <div class="note">${e(a.window.label)}.</div>
    </section>`;
}

/* ---- the token's own name/symbol, above the address (2026-09-12) ---------

   worker/schema.sql's `token_meta` cache (worker/src/reserve.ts,
   worker/src/curve.ts) reads name()/symbol() straight off the token's own
   contract -- untrusted, on-chain, attacker-controlled text, never LEDGE's
   own copy. It is HTML-escaped like everything else this file prints, and
   CSS forces it to one line with ellipsis overflow (.token-identity-line
   below) so a name a malicious deployer made absurdly long can never break
   the page's layout. It is a label, never the identity: the address is
   still printed in full immediately below it and again in the footer, and
   this line is never used in its place. */
function identityLine(body: Body): string {
  const symbol = body.config.symbol;
  const name = body.config.name;
  if (symbol === null && name === null) return "";
  const parts = [symbol, name].filter((v): v is string => v !== null).map(e);
  return `<p class="token-identity-line">${parts.join(" · ")}</p>`;
}

/* ---- the header: not a card ------------------------------------------

   The token's own address, in full, mono, wrapping rather than truncating --
   and a copy control that degrades to nothing rather than to breakage if
   JavaScript never runs: the address text is ordinary, selectable text
   either way. Then one line of the token's own facts: its pair, its tax,
   its age, and how it stands -- the same word outcomeWord gives the
   sentences below, so the header and the long form never disagree. */
function headerBlock(body: Body, observedMaxSeconds: number | null): string {
  const pairSym = body.config.pairSymbol ?? "pair not read";
  const taxPart = body.config.taxBucket === null ? "creator tax not read" : `creator tax ${e(taxLabel(body.config.taxBucket))}`;
  const agePart =
    body.state.elapsedSeconds === null
      ? "launch time not indexed"
      : `launched ${e(formatAge(body.state.elapsedSeconds))} ago`;
  const statusPart = outcomeWord(body, observedMaxSeconds);
  const line = [e(pairSym), taxPart, agePart, e(statusPart)].join(" · ");

  return `
    <div class="token-header">
      ${identityLine(body)}
      <div class="addr-row">
        <code class="addr-full mono" id="token-addr">${e(body.address)}</code>
        <button type="button" class="copy-btn" aria-label="Copy the token address" onclick="try{var t=document.getElementById('token-addr').textContent;navigator.clipboard.writeText(t);var b=this,o=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=o;},1200);}catch(err){}">Copy</button>
      </div>
      <p class="token-meta-line">${line}</p>
    </div>`;
}

/* ---- the meta line: the token's own facts, not a verdict, and quiet ------

   Not a card: REVAMP.md 1.1 puts the decision-relevant facts in the cards
   above; this is the same register the old shell's footer used, kept as a
   single line rather than a boxed grid so it reads as background, not as a
   fifth card competing with the four that answer the page's actual job. The
   curve's own address belongs here per REVAMP.md 1.1 but is not present in
   TokenResponse -- see the file-level note above. */
function metaLine(body: Body, observedMaxSeconds: number | null): string {
  const block = body.state.launchBlock === null ? "launch block not indexed" : `launch block ${e(formatCount(body.state.launchBlock))}`;
  const status = e(outcomeWord(body, observedMaxSeconds));
  const measured = e(formatStamp(body.observedAt));
  return `
    <p class="meta-line">
      ${block} · ${status} · ${measured} ·
      <a href="${e(body.links.method)}">${e(body.links.method)}</a>
    </p>`;
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

/* ---- the shell's own top bar: not a card, static HTML, no JS required.

   Same job as site/components/TopBar.tsx: the mark, the one thing a reader
   can do, and the way to everything else -- here as a plain GET form to
   `/t`, handled by index.ts's `/t?address=` route, so the lookup works with
   JavaScript never running. Reference points at /method directly rather than
   the site's own disclosure of five links: this page has no client script to
   open one, and /method is the one of the five that matters from here. */
function topBar(siteOrigin: string): string {
  return `
  <header class="topbar">
    <div class="topbar-row">
      <a href="${siteOrigin}/" class="topbar-mark">LEDGE</a>
      <form class="topbar-find" method="get" action="/t">
        <label class="topbar-find-label" for="topbar-address">Look up a token</label>
        <input id="topbar-address" name="address" class="topbar-input mono" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="Paste a token address">
        <button class="topbar-go" type="submit">Go</button>
      </form>
      <nav class="topbar-nav" aria-label="Sections">
        <a href="${siteOrigin}/live">Live</a>
        <a href="${siteOrigin}/graduated">Graduated</a>
        <a href="${siteOrigin}/graveyard">Graveyard</a>
        <a href="${siteOrigin}/token">Token</a>
        <a href="${siteOrigin}/method">Reference</a>
      </nav>
    </div>
  </header>`;
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
  const facts = text.split("\n").map((line) => `<p>${escapeHtml(line)}</p>`).join("\n        ");
  /* SYMBOL prepended to the title text.ts's headline() builds, never inside
     it -- text.ts is not touched by this change. The address stays in the
     meta line below regardless; a symbol is a label on the title, not a
     replacement for the identity the page is about. */
  const displayTitle = body.config.symbol === null ? title : `${body.config.symbol} · ${title}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(displayTitle)} — LEDGE</title>
<link rel="canonical" href="${canonical}">
<meta name="description" content="${escapeHtml(displayTitle)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(displayTitle)}">
<meta property="og:description" content="${escapeHtml(text.split("\n")[3] ?? title)}">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${ogImage}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:ital,opsz@0,6..72;1,6..72&display=swap" rel="stylesheet">
<style>
  :root {
    --ground: #EFEAE0;
    --ground-alt: #E5DFD1;
    --ink: #16130F;
    --ink-2: #45413A;
    --ink-muted: #57503F;
    --ink-3: #645E4E;
    --rule-hair: #CDC6B3;
    --rule-mid: #A9A18C;
    --rule-heavy: #16130F;
    --stale: #B3321C;
    --stale-ink: #FFFFFF;
    --fill: #2F6690;
    --font-display: "Anton", Impact, "Arial Narrow", sans-serif;
    --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --font-body: "Newsreader", Georgia, "Times New Roman", serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #121110;
      --ground-alt: #1C1A17;
      --ink: #E8E3D8;
      --ink-2: #B4AEA0;
      --ink-muted: #A39B8A;
      --ink-3: #918B80;
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
    padding: 0 0 3rem;
    font: 16px/1.5 var(--font-body);
    background: var(--ground);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  a { color: inherit; }

  /* ---- top bar: same job as site/components/TopBar.tsx, static HTML ---- */
  .topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--ground);
    border-bottom: 1px solid var(--rule-heavy);
  }
  .topbar-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    max-width: 30rem;
    margin: 0 auto;
    padding: 0.55rem 1rem;
  }
  .topbar-mark {
    font-family: var(--font-mono);
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: var(--ink);
    text-decoration: none;
    flex: none;
  }
  .topbar-find {
    display: flex;
    align-items: stretch;
    flex: 1 1 100%;
    order: 2;
    min-width: 0;
    border: 1px solid var(--rule-mid);
  }
  .topbar-find-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .topbar-input {
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    font-size: 0.8125rem;
    padding: 0.4rem 0.55rem;
  }
  .topbar-input::placeholder { color: var(--ink-3); }
  .topbar-input:focus-visible { outline: 2px solid var(--fill); outline-offset: -2px; }
  .topbar-go {
    flex: none;
    border: 0;
    border-left: 1px solid var(--rule-mid);
    background: transparent;
    color: var(--ink-2);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 0 0.7rem;
    cursor: pointer;
  }
  .topbar-go:hover, .topbar-go:focus-visible { color: var(--ink); }
  .topbar-nav {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1 1 100%;
    order: 3;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .topbar-nav a {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-2);
    text-decoration: none;
    border-bottom: 1px solid var(--rule-hair);
    white-space: nowrap;
  }
  .topbar-nav a:hover, .topbar-nav a:focus-visible { color: var(--ink); border-bottom-color: var(--ink); }

  main { max-width: 30rem; margin: 0 auto; padding: 1.5rem 1rem 0; }

  /* ---- the header: the address and the token's own facts, not a card --- */
  .token-header { margin: 0 0 1.25rem; }
  /* Untrusted, on-chain text (worker/schema.sql's token_meta cache): a
     malicious deployer's name()/symbol() must never be able to widen or
     break the page, so it is forced to exactly one line with ellipsis
     overflow, however long the underlying string is. */
  .token-identity-line {
    margin: 0 0 0.3rem;
    font-family: var(--font-mono);
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .addr-row {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .addr-full {
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    word-break: break-all;
    color: var(--ink);
    flex: 1 1 auto;
    min-width: 0;
    -webkit-user-select: all;
    user-select: all;
  }
  .copy-btn {
    flex: none;
    border: 1px solid var(--rule-mid);
    background: transparent;
    color: var(--ink-2);
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
  }
  .copy-btn:hover, .copy-btn:focus-visible { color: var(--ink); border-color: var(--ink); }
  .token-meta-line {
    margin: 0.5rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    color: var(--ink-2);
    word-break: break-word;
  }

  .card {
    border: 1px solid var(--rule-hair);
    background: var(--ground-alt);
    padding: 1rem;
    margin: 0 0 0.75rem;
  }
  .card.headline { border-color: var(--rule-mid); text-align: left; }
  .k {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-muted);
    margin: 0 0 0.4rem;
  }
  /* The homepage LIVE pulse's own display face and size (globals.css
     .pulse-figure), in ink rather than the --fill accent: this is a fact
     about one token, not "live and good news". */
  .fig {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: clamp(2.75rem, 15vw, 4.5rem);
    line-height: 0.95;
    letter-spacing: -0.01em;
    margin: 0 0 0.35rem;
    color: var(--ink);
    word-break: break-word;
  }
  .fig-2 { font-size: clamp(1.375rem, 6vw, 1.75rem); font-family: var(--font-mono); font-weight: 600; letter-spacing: 0; }
  .fig-share { font-size: 0.9375rem; color: var(--ink-2); margin-top: 0.15rem; }
  .fig-dash { color: var(--ink-muted); }
  .note { font-size: 0.8125rem; color: var(--ink-2); margin: 0.35rem 0 0; font-family: var(--font-body); }
  .note:first-child { margin-top: 0; }
  .bar {
    height: 0.5rem;
    background: var(--ground);
    border: 1px solid var(--rule-hair);
    margin: 0.6rem 0 0.5rem;
    overflow: hidden;
  }
  .bar-fill { height: 100%; background: var(--fill); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem 0.75rem; }
  .grid-2 { grid-template-columns: 1fr 1fr; }
  .cell { min-width: 0; }
  .cell-wide { grid-column: 1 / -1; }
  .cell-k {
    display: block;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-muted);
    margin: 0 0 0.15rem;
  }
  .cell-v { display: block; font-family: var(--font-mono); font-size: 0.9375rem; word-break: break-word; }
  .stale-banner {
    color: var(--stale-ink);
    background: var(--stale);
    font-family: var(--font-mono);
    font-weight: 500;
    padding: 0.6rem 0.75rem;
    font-size: 0.8125rem;
    margin: 0 0 0.75rem;
  }
  .meta-line {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--ink-muted);
    word-break: break-word;
    margin: 0.25rem 0 1.25rem;
  }
  hr { border: 0; border-top: 2px solid var(--rule-heavy); margin: 0.5rem 0 1rem; }

  /* ---- the sentences: unchanged from lookupText, collapsed by default --- */
  details.fact-details { margin: 0 0 1rem; }
  details.fact-details summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-2);
    padding: 0.1rem 0;
  }
  details.fact-details summary:hover, details.fact-details summary:focus-visible { color: var(--ink); }
  #fact { margin-top: 0.75rem; }
  #fact p { margin: 0 0 0.75rem; font-size: 0.9375rem; color: var(--ink-2); font-family: var(--font-body); }

  footer { color: var(--ink-muted); font-size: 0.8125rem; word-break: break-all; padding: 0 0 1rem; }
  footer p { margin: 0 0 0.4rem; }
</style>
</head>
<body>
  ${topBar(siteOrigin)}
  <main>
    ${liveStaleBanner(body)}
    ${staleBanner(body)}
    ${headerBlock(body, observedMaxSeconds)}
    ${buyersCard(body)}
    ${fillCard(body)}
    ${cohortCard(body)}
    ${activityCard(body)}
    ${metaLine(body, observedMaxSeconds)}
    <hr>
    <details class="fact-details">
      <summary>As text — what the bot posts</summary>
      <div id="fact">
        ${facts}
      </div>
    </details>
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
