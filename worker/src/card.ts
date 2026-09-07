/* The death card: 1200x630, bone and ink, set in IBM Plex Mono.

   Same posture as the share card in site/scripts/og.mjs, and for the same
   reason: this is the copy of a figure that travels furthest from the page, so
   it is the copy that must not be able to invent a percentage. Every number on
   it comes from text.ts, which gets it from number.json. An insufficient
   cohort prints "not enough data (n=...)" here exactly as it does on the
   sheet.

   Cropped, the card must still say LEDGE.TOOLS and carry its measurement
   stamp, so the strip is at the foot and the ground is uniform.

   WHY THE SVG IS WRITTEN BY HAND (research item R7, answered by building it):
   satori cannot run in a Worker. It depends on yoga-layout and harfbuzzjs,
   both of which instantiate WebAssembly from bytes at runtime, which workerd
   refuses -- a Worker may only use a wasm module imported at build time. Yoga
   has an injection path; harfbuzz does not. Since the card is one fixed
   monospaced layout with no flow to solve, a layout engine was never buying
   much: the positions below are the layout, and resvg-wasm (which DOES accept
   a build-time module) rasterises it. */

import {
  formatAmount,
  formatCount,
  formatShareOfOne,
  formatStamp,
  isInsufficient,
  rateText,
  shortAddress,
} from "./format";
import { FILL_GRADUATED, FILL_GRADUATED_CARD } from "./curve";
import { cohortSuppressed, headline } from "./text";
import { pairLabel, taxLabel } from "./buckets";
import type { TokenResponse } from "./schema";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const MONO = "IBM Plex Mono";

const GROUND = "#EFEAE0";
const INK = "#16130F";
const INK_MUTED = "#57503F";
const INK_3 = "#645E4E";
const STALE = "#B3321C";

const PAD = 64;

export interface CardText {
  text: string;
  x: number;
  y: number;
  size: number;
  weight: 400 | 600;
  fill: string;
  anchor: "start" | "middle" | "end";
  letterSpacing?: number;
}

export interface CardRule {
  y: number;
  fill: string;
}

export interface Card {
  width: number;
  height: number;
  ground: string;
  texts: CardText[];
  rules: CardRule[];
}

/** IBM Plex Mono advances at 0.6 em, so every line's width is countable
    without measuring a glyph. */
export const ADVANCE = 0.6;

export function widthOf(text: string, size: number, letterSpacing = 0): number {
  return text.length * (size * ADVANCE + letterSpacing);
}

/* The card is one fixed plate and the strings on it vary in length: a headline
   reads "minute 14 · died · cohort 1.2% (n=156) · ETH · 3%" for one token and
   "launch time not indexed · graduated · cohort not enough data (n=0) ·
   Stablecoin · 0%" for another, half again as long. Rather than truncate — which
   would drop the denominator off the end of the very line the denominator rule
   exists for — the type is set down until the whole line fits. */
export function fit(
  text: string,
  preferred: number,
  maxWidth: number,
  letterSpacing = 0,
  minimum = 14,
): number {
  if (widthOf(text, preferred, letterSpacing) <= maxWidth) return preferred;
  if (text.length === 0) return preferred;
  const fitted = (maxWidth / text.length - letterSpacing) / ADVANCE;
  return Math.max(minimum, Math.floor(fitted));
}

/** A long gloss is broken across lines rather than set smaller. */
function wrap(line: string, maxChars: number): string[] {
  const words = line.split(" ");
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length > maxChars && current !== "") {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== "") out.push(current);
  return out;
}

/* The card mirrors text.ts's fill sentence in the pair token's own units, with
   the graduated note in its short form and the trailing full stop dropped --
   a card line is a label, not a sentence. */
function fillLine(
  state: Omit<TokenResponse, "text">["state"],
  config: Omit<TokenResponse, "text">["config"],
  suppressed: boolean,
): string {
  if (state.curveFilledShare === null) {
    return `Curve fill: ${state.fillNote ?? "not available"}`;
  }
  const decimals = config.pairDecimals;
  const threshold =
    decimals === null ? null : formatAmount(state.graduationThresholdWei ?? "0", decimals, config.pairSymbol);

  if (state.fillNote === FILL_GRADUATED) {
    return `Curve fill: ${FILL_GRADUATED_CARD}, ${threshold ?? state.graduationThresholdWei}`;
  }
  const filled =
    decimals === null ? null : formatAmount(state.curveFilledWei ?? "0", decimals, config.pairSymbol);
  if (filled === null || threshold === null) {
    return `Curve fill: ${state.curveFilledWei} of ${state.graduationThresholdWei} (units not known)`;
  }
  if (suppressed) return `Curve fill: ${filled} of ${threshold}`;
  const holdsSomething = state.curveFilledWei !== null && state.curveFilledWei !== "0";
  return `Curve fill: ${filled} of ${threshold} (${formatShareOfOne(state.curveFilledShare, holdsSomething)})`;
}

/** The card, as positioned text. Exported so a test can read every string the
    card would print without a font, a wasm module, or a rasterising pass. */
export function cardTree(
  body: Omit<TokenResponse, "text">,
  observedMaxSeconds: number | null,
): Card {
  const cohortWindow = body.cohort?.allTime ?? body.cohort?.h24 ?? null;
  const fact = cohortWindow
    ? { rate: cohortWindow.rate, n: cohortWindow.launches, insufficient: cohortWindow.insufficient }
    : { rate: null, n: 0, insufficient: true };
  const posterIsFigure = cohortWindow !== null && !isInsufficient(fact);
  const poster = cohortWindow ? rateText(fact) : "cohort not published";

  const tax = body.config.taxBucket === null ? "tax not read" : taxLabel(body.config.taxBucket);
  const gloss = cohortWindow
    ? `of ${formatCount(cohortWindow.launches)} launches paired with ${pairLabel(body.config.pairClass)} at ${tax} graduated`
    : "no cohort has been published for this configuration";

  const plate = CARD_WIDTH - PAD * 2;
  const headlineText = headline(body, observedMaxSeconds);
  const HEADLINE_SPACING = 1.2;
  const address = shortAddress(body.address);
  /* The fill line shares its row with the address, so it may only have the
     plate minus that column and a gutter. */
  const fillColumn = plate - widthOf(address, 24) - 40;
  const fill = fillLine(body.state, body.config, cohortSuppressed(body));

  const texts: CardText[] = [
    {
      text: headlineText,
      x: PAD,
      y: 110,
      size: fit(headlineText, 26, plate, HEADLINE_SPACING),
      weight: 600,
      fill: INK_MUTED,
      anchor: "start",
      letterSpacing: HEADLINE_SPACING,
    },
    {
      text: poster,
      x: PAD,
      y: posterIsFigure ? 300 : 250,
      size: fit(poster, posterIsFigure ? 168 : 50, plate),
      weight: 600,
      fill: posterIsFigure ? INK : INK_3,
      anchor: "start",
    },
  ];

  const stamp = body.cohort ? formatStamp(body.cohort.crawledAt) : "not measured";

  wrap(gloss, 58).forEach((line, i) => {
    texts.push({
      text: line,
      x: PAD,
      y: 380 + i * 40,
      size: 30,
      weight: 400,
      fill: INK_MUTED,
      anchor: "start",
    });
  });

  texts.push({
    /* The card gets the short form of the graduated note: the long one runs
       off a 1200px line, and a truncated sentence would be worse than a
       shorter true one. */
    text: fill,
    x: PAD,
    y: 512,
    size: fit(fill, 24, fillColumn),
    weight: 400,
    fill: INK_3,
    anchor: "start",
  });

  /* The subject sits opposite the fill, not in the footer: the footer strip is
     the colophon, and cropped it must read as LEDGE.TOOLS and a stamp with
     nothing crowding either. */
  texts.push({
    text: address,
    x: CARD_WIDTH - PAD,
    y: 512,
    size: 24,
    weight: 400,
    fill: INK_MUTED,
    anchor: "end",
  });

  texts.push(
    {
      text: "LEDGE.TOOLS",
      x: PAD,
      y: 578,
      size: 22,
      weight: 600,
      fill: INK,
      anchor: "start",
      letterSpacing: 6,
    },
    {
      text: stamp,
      x: CARD_WIDTH - PAD,
      y: 578,
      size: 22,
      weight: 400,
      fill: body.live.stale ? STALE : INK_3,
      anchor: "end",
    },
  );

  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    ground: GROUND,
    texts,
    rules: [{ y: 540, fill: INK }],
  };
}

/** Every string the card would render, flattened. The gate reads this. */
export function collectText(card: Card): string {
  return card.texts.map((t) => t.text).join(" ");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function cardSvg(card: Card): string {
  const rules = card.rules
    .map((r) => `<rect x="${PAD}" y="${r.y}" width="${card.width - PAD * 2}" height="2" fill="${r.fill}"/>`)
    .join("");
  const texts = card.texts
    .map(
      (t) =>
        `<text x="${t.x}" y="${t.y}" font-family="${MONO}" font-size="${t.size}" font-weight="${t.weight}" fill="${t.fill}" text-anchor="${t.anchor}"` +
        (t.letterSpacing ? ` letter-spacing="${t.letterSpacing}"` : "") +
        `>${escapeXml(t.text)}</text>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${card.width}" height="${card.height}" viewBox="0 0 ${card.width} ${card.height}">` +
    `<rect width="${card.width}" height="${card.height}" fill="${card.ground}"/>` +
    rules +
    texts +
    `</svg>`
  );
}
