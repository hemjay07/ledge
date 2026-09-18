/* Figure cards: a self-attributing image for the figures a post carries.

   2026-09-16, for the launch week. A screenshot of a table travels without
   its stamp, its n, or the site's name; these cards carry all three, drawn
   from number.json's own values. Nothing is computed here (gate 2 applies:
   this file formats what stats.py published). A figure under the floor
   prints "not enough data (n=...)" and no percentage, like every surface.

   /og/figure/{name}.png, names in FIGURE_NAMES. The graveyard card needs
   the live index's count, which the handler passes in; without it there is
   no card rather than a stale one. */

import { CARD_HEIGHT, CARD_WIDTH, type Card, type CardText } from "./card";
import { formatAge, formatAmount, formatCount, formatDuration, formatShareOfOne, formatStamp, rateText, shortAddress } from "./format";
import type { FirstBuyCohortRow, NumberFile } from "./numberFile";
import { pairLabel, taxLabel } from "./buckets";
import type { TokenResponse } from "./schema";
import { placementText } from "./text";
import { isInsufficient } from "./format";

const GROUND = "#EFEAE0";
const INK = "#16130F";
const INK_MUTED = "#57503F";
const PAD = 64;
/** The widest a line of the mono face fits between the pads at 28-30 px.
    A longer line runs off the card (2026-09-16: the graduation card's
    third line clipped at "Half the graduations took"). */
export const MAX_LINE_CHARS = 64;

/** Cuts a line to the card's width at a word boundary, with an ellipsis.
    Plex Mono advances 0.6 em, so the width in characters follows the size:
    64 at 28 px, 68 at 26 px, 74 at 24 px. */
function clip(line: string, size = 28): string {
  return clipTo(line, Math.floor((CARD_WIDTH - 2 * PAD) / (size * 0.6)));
}
function clipTo(line: string, max: number): string {
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export const FIGURE_NAMES = ["firstbuy", "graduation", "graveyard"] as const;

export interface GraveyardFigure {
  total: number;
  watched: number;
  since: string;
}

function text(t: string, x: number, y: number, size: number, weight: 400 | 600 = 400, fill = INK, anchor: CardText["anchor"] = "start", letterSpacing?: number): CardText {
  return { text: t, x, y, size, weight, fill, anchor, letterSpacing };
}

function frame(kicker: string, lines: CardText[], stamp: string): Card {
  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    ground: GROUND,
    texts: [
      text(kicker, PAD, 88, 22, 600, INK_MUTED, "start", 4),
      ...lines,
      text("LEDGE.TOOLS", PAD, 578, 22, 600, INK, "start", 5),
      text(stamp, CARD_WIDTH - PAD, 578, 22, 400, INK_MUTED, "end"),
    ],
    rules: [
      { y: 108, fill: INK },
      { y: 540, fill: INK },
    ],
  };
}

function firstBuyLines(row: FirstBuyCohortRow, label: string): CardText[] {
  const n = { n: row.n, insufficient: row.insufficient };
  if (row.insufficient) {
    return [
      text(label, PAD, 200, 30, 400, INK_MUTED),
      text(`not enough data (n=${row.n})`, PAD, 330, 64, 600),
    ];
  }
  const w1 = rateText({ rate: row.within1sShare, ...n });
  const w5 = rateText({ rate: row.within5sShare, ...n });
  const none = rateText({ rate: row.noneShare, ...n });
  return [
    text(label, PAD, 190, 30, 400, INK_MUTED),
    text(w1, PAD, 330, 150, 600),
    text("took their first outside buy within 1 s of the launch block.", PAD, 392, 30),
    text(`${w5} within 5 s. ${none} none within an hour. n=${formatCount(row.n)}.`, PAD, 470, 30),
  ];
}

export function figureCard(name: string, file: NumberFile, graveyard: GraveyardFigure | null): Card | null {
  const stamp = formatStamp(file.crawledAt);

  if (name === "firstbuy") {
    const row = file.firstBuy?.cohorts.all[0];
    if (!row) return null;
    return frame("PONS · FIRST OUTSIDE BUY · LAUNCHES AT LEAST AN HOUR OLD", firstBuyLines(row, "Of every pons launch at least an hour old,"), stamp);
  }

  const band = name.match(/^firstbuy-tax-(.+)$/);
  if (band) {
    const row = file.firstBuy?.cohorts.taxBucket.find((r) => r.bucket === band[1]);
    if (!row) return null;
    return frame(`PONS · FIRST OUTSIDE BUY · ${taxLabel(row.bucket)} CREATOR TAX`, firstBuyLines(row, `Of launches with a ${taxLabel(row.bucket)} creator tax,`), stamp);
  }

  if (name === "graduation") {
    const w = file.allTime;
    const fact = { rate: w.rate, n: w.launches, insufficient: w.insufficient };
    const ef = { rate: w.excludingFast.rate, n: w.launches, insufficient: w.excludingFast.insufficient };
    const median = w.ttg.insufficient || w.ttg.p50 === null ? `median: not enough data (n=${formatCount(w.ttg.n)})` : `Half the graduations took under ${formatDuration(w.ttg.p50)} (n=${formatCount(w.ttg.n)}).`;
    return frame(
      "PONS · GRADUATIONS · SINCE THE RECORD BEGAN",
      [
        text(rateText(fact), PAD, 330, 150, 600),
        text(`of ${formatCount(w.launches)} launches graduated (${formatCount(w.graduations)}).`, PAD, 392, 30),
        text(`${rateText(ef)} leaving out graduations under ${formatDuration(w.excludingFast.cutoffSeconds)}.`, PAD, 458, 28),
        text(median, PAD, 500, 28),
      ],
      stamp,
    );
  }

  if (name === "graveyard") {
    if (!graveyard) return null;
    return frame(
      "PONS · THE GRAVEYARD · NO BUY IN THE FIRST 72 HOURS",
      [
        text(formatCount(graveyard.total), PAD, 330, 150, 600),
        text("launches took no buy in their first 72 hours,", PAD, 392, 30),
        text(`of the ${formatCount(graveyard.watched)} the live index has watched since ${formatStamp(graveyard.since).replace(/^Measured /, "").replace(/ · .*$/, "")}.`, PAD, 470, 28),
      ],
      stamp,
    );
  }

  return null;
}


/* The token card (2026-09-18): one token's own facts, for a post about that
   token. The share card (/og/t) leads with the cohort rate and a minute
   count; a quote-post needs the token first. Fill is the big number; the
   counts, the launch block and the first outside buy follow; the cohort
   sits last with its n. Nothing here is computed: every figure is read off
   the lookup body, and every sentence is the wording the /t page prints. */
export function tokenCard(body: Omit<TokenResponse, "text">, nowSeconds: number): Card {
  const s = body.state;
  const c = body.config;
  const a = body.activity;
  // The symbol as the headline; the short address, unclipped, when there is none.
  const sym = c.symbol ? c.symbol.toUpperCase() : shortAddress(body.address);
  const headline = c.symbol ? clipTo(sym, 16) : sym;
  const age = s.elapsedSeconds === null ? "age not indexed" : `${formatAge(s.elapsedSeconds)} old`;
  const state = s.graduated
    ? s.timeToGraduationSeconds === null ? "graduated" : `graduated in ${formatDuration(s.timeToGraduationSeconds)}`
    : "on the curve";
  // The kicker is wide-tracked (4 px at 22 px): about 58 characters fit.
  const kicker = clipTo(`PONS · ${state} · ${age}`.toUpperCase(), 58);

  const lines: CardText[] = [];
  // The name is the headline (2026-09-18): a quote-post is about this token.
  // Anton caps at 118 px fit about 16 characters across the card.
  lines.push(text(headline, PAD, 250, headline.length > 10 ? 96 : 118, 600));

  const holds = s.curveFilledWei !== null && s.curveFilledWei !== "0";
  if (s.curveFilledShare !== null) {
    const filled = c.pairDecimals === null ? null : formatAmount(s.curveFilledWei ?? "0", c.pairDecimals, c.pairSymbol);
    const threshold = c.pairDecimals === null ? null : formatAmount(s.graduationThresholdWei ?? "0", c.pairDecimals, c.pairSymbol);
    const share = formatShareOfOne(s.curveFilledShare, holds);
    lines.push(text(clip(filled && threshold ? `${share} of the curve filled: ${filled} of ${threshold}.` : `${share} of the curve filled.`), PAD, 312, 32, 600));
  } else {
    lines.push(text(clip(`Curve fill: ${s.fillNote ?? "not available"}.`), PAD, 318, 32, 600));
  }

  if (a) {
    const buyers = a.firstBlock === null ? "launch block not indexed" : `${formatCount(a.firstBlock.distinctBuyers)} ${a.firstBlock.distinctBuyers === 1 ? "buyer" : "buyers"} in the launch block`;
    lines.push(text(clip(`${formatCount(a.buys)} ${a.buys === 1 ? "buy" : "buys"} · ${formatCount(a.sells)} ${a.sells === 1 ? "sell" : "sells"} · ${buyers}.`), PAD, 366, 28));
    const fob = a.firstOutsideBuy;
    const first = fob === null
      ? a.launchTxBuy === null ? "First outside buy: not recorded." : "First outside buy: none yet."
      : fob.inLaunchBlock ? "First outside buy: in the launch block itself."
      : fob.delaySeconds === null ? "First outside buy: none yet."
      : `First outside buy: ${formatDuration(fob.delaySeconds)} after the launch block.`;
    lines.push(text(clip(first), PAD, 404, 28));
  } else {
    lines.push(text("Curve activity: not indexed for this launch.", PAD, 366, 28));
  }

  /* Where this launch sits on the published table of graduation times
     (text.ts placementText, the wording the vector gate pins). Stated the
     same way whether it flatters the token or not: "56% of graduations were
     done within 5 min (n=4,376); this launch was not." */
  const placed = placementText(body.placement, s.graduated);
  // 24 px: 74 characters fit, and the pinned sentence is 73.
  if (placed && !placed.startsWith("The table")) lines.push(text(clip(placed, 24), PAD, 448, 24));

  const w = body.cohort?.allTime ?? null;
  if (w) {
    const fact = { rate: w.rate, n: w.launches, insufficient: w.insufficient };
    const ef = { rate: w.excludingFast.rate, n: w.launches, insufficient: w.excludingFast.insufficient };
    const who = `${pairLabel(c.pairClass)} · ${c.taxBucket === null ? "tax not read" : `${taxLabel(c.taxBucket)} tax`}`;
    lines.push(text(clip(`Launches like this (${who}), n=${formatCount(w.launches)}:`, 24), PAD, 484, 24, 400, INK_MUTED));
    const line = isInsufficient(fact)
      ? rateText(fact)
      : `${rateText(fact)} graduated · ${rateText(ef)} leaving out graduations under ${formatDuration(w.excludingFast.cutoffSeconds)}.`;
    lines.push(text(clip(line, 24), PAD, 514, 24, 400, INK_MUTED));
  }

  return frame(kicker, lines, `Read ${formatStamp(new Date(nowSeconds * 1000).toISOString()).replace(/^Measured /, "")}`);
}
