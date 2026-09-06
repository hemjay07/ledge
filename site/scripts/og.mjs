#!/usr/bin/env node
/* The share card: 1200x630 PNG, generated from the same measurement the site
   renders. The age printed on it is the age at generation, which is honest
   because the card is regenerated with every data commit.

   Every rule about when a rate may be printed comes from ../lib/format-core.mjs,
   the same module the site uses. The card is the copy of the number that
   travels furthest from the page, so it is the copy that must not be able to
   invent a percentage: an insufficient window prints "not enough data (n=…)"
   here exactly as it does on the sheet. */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatAge,
  formatCount,
  formatDuration,
  formatOneIn,
  formatStamp,
  isInsufficient,
  rateText,
} from "../lib/format-core.mjs";
import { LEAD } from "../lib/lead-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const GROUND = "#EFEAE0";
const INK = "#16130F";
const INK_MUTED = "#57503F";
const INK_3 = "#645E4E";
const STALE = "#B3321C";

const MONO = "IBM Plex Mono";
const DISPLAY = "Anton";

const rule = (h, color) => ({ type: "div", props: { style: { height: h, background: color } } });

const strip = (left, right, color) => ({
  type: "div",
  props: {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      padding: "12px 0 14px",
      fontFamily: MONO,
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: "0.1em",
      color,
    },
    children: [
      { type: "div", props: { style: { letterSpacing: "0.28em" }, children: left } },
      { type: "div", props: { style: { color: INK_MUTED, fontWeight: 500 }, children: right } },
    ],
  },
});

/* A figure that cannot be printed as a percentage is not set in the poster
   face: "not enough data (n=3,347)" at 210px would run off the card, and it is
   not a figure anyway. It drops to the running mono, which is what the sheet
   does with the same value. */
const figure = (fact, posterSize, plainSize) => {
  const insufficient = isInsufficient(fact);
  return {
    type: "div",
    props: {
      style: insufficient
        ? { fontFamily: MONO, fontSize: plainSize, lineHeight: 1.2, color: INK_3 }
        : { fontFamily: DISPLAY, fontSize: posterSize, lineHeight: posterSize > 100 ? 0.82 : 0.9, color: INK },
      children: rateText(fact),
    },
  };
};

/** The card, as a satori element tree. Exported so a test can read the text it
    would render without rendering a PNG. */
export function cardTree(data, nowMs = Date.now()) {
  const w = data.h24;
  const ageSeconds = Math.max(0, Math.round((nowMs - Date.parse(data.crawledAt)) / 1000));
  const isStale = !(ageSeconds < data.staleAfterSeconds);
  const cutoff = formatDuration(w.excludingFast.cutoffSeconds);

  const headline = { rate: w.rate, n: w.launches, insufficient: w.insufficient };
  const excluding = {
    rate: w.excludingFast.rate,
    n: w.launches,
    insufficient: w.excludingFast.insufficient,
  };

  /* "1 in N" is a restatement of the excluding-fast rate. It is dropped
     whenever that rate is not printable, and whenever the pipeline wrote no
     N — there is nothing to restate and nothing to count. */
  const oneIn = w.excludingFast.oneIn;
  const oneInPrintable =
    !isInsufficient(excluding) && oneIn !== null && oneIn !== undefined;

  /* The card leads with whichever figure the sheet leads with (lib/lead-core.mjs).
     Under "excludingFast" the poster is the "1 in N" restatement, and the
     gloss drops it rather than printing it twice. When it cannot be printed
     the poster falls back to what the raw poster shows in that case —
     "not enough data (n=…)" — never a bare "1 in". */
  const leadsRaw = LEAD === "raw";
  const gloss =
    !leadsRaw || !oneInPrintable
      ? `excluding under ${cutoff}`
      : `excluding under ${cutoff} · ${formatOneIn(oneIn)}`;

  const poster =
    leadsRaw || !oneInPrintable
      ? figure(leadsRaw ? headline : excluding, 210, 46)
      : {
          type: "div",
          props: {
            style: { fontFamily: DISPLAY, fontSize: 150, lineHeight: 0.82, color: INK },
            children: formatOneIn(oneIn),
          },
        };

  const graduations = leadsRaw ? w.graduations : w.excludingFast.graduations;

  return {
    type: "div",
    props: {
      style: {
        width: 1200,
        height: 630,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: GROUND,
        color: INK,
        padding: "40px 64px",
        fontFamily: MONO,
      },
      children: [
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column" },
            children: [rule(7, INK), strip("LEDGE", "TRAILING 24 HOURS", INK)],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", paddingLeft: 40 },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "baseline", gap: 48 },
                  children: [
                    poster,
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", flexDirection: "column" },
                        children: [
                          figure(excluding, 84, 30),
                          {
                            type: "div",
                            props: {
                              style: { fontSize: 20, color: INK_MUTED, paddingTop: 10 },
                              children: gloss,
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: { fontSize: 30, paddingTop: 34, color: INK },
                  children: `of ${formatCount(w.launches)} launches in the last 24 hours graduated${
                    leadsRaw ? "" : `, excluding under ${cutoff}`
                  }`,
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    fontSize: 24,
                    paddingTop: 12,
                    color: INK_3,
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: { display: "flex" },
                        children: [
                          {
                            type: "div",
                            props: {
                              children: `n = ${formatCount(w.launches)} · ${formatCount(graduations)} graduations · updated`,
                            },
                          },
                          {
                            type: "div",
                            props: {
                              style: { color: isStale ? STALE : INK_3, fontWeight: 600 },
                              children: ` ${formatAge(ageSeconds)} ago`,
                            },
                          },
                        ],
                      },
                    },
                    /* Neither figure leaves the card. When the excluding-fast
                       figure posters, the raw rate keeps its own line, with
                       the counts it was computed from. */
                    leadsRaw
                      ? null
                      : {
                          type: "div",
                          props: {
                            style: { paddingTop: 6 },
                            children: `${rateText(headline)} counting every graduation · ${formatCount(w.graduations)} of ${formatCount(w.launches)}`,
                          },
                        },
                  ],
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column" },
            children: [
              rule(3, INK),
              strip("ledge.tools/number", formatStamp(data.crawledAt).toUpperCase(), INK),
              rule(7, INK),
            ],
          },
        },
      ],
    },
  };
}

/** Every string the tree would set, in order. The card's text, without a PNG. */
export function cardText(node) {
  if (node === null || node === undefined || node === false) return [];
  if (typeof node === "string") return [node];
  if (typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(cardText);
  return cardText(node.props?.children);
}

export function readNumberFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { default: satori } = await import("satori");
  const { Resvg } = await import("@resvg/resvg-js");

  const src = process.env.LEDGE_NUMBER_JSON
    ? resolve(process.env.LEDGE_NUMBER_JSON)
    : join(root, "..", "data", "number.json");
  const out = process.env.LEDGE_OG_OUT
    ? resolve(process.env.LEDGE_OG_OUT)
    : join(root, "public", "og", "number.png");

  const fonts = [
    { name: DISPLAY, data: readFileSync(join(root, "fonts", "Anton-Regular.ttf")), weight: 400, style: "normal" },
    { name: MONO, data: readFileSync(join(root, "fonts", "IBMPlexMono-Regular.ttf")), weight: 400, style: "normal" },
    { name: MONO, data: readFileSync(join(root, "fonts", "IBMPlexMono-SemiBold.ttf")), weight: 600, style: "normal" },
  ];

  const svg = await satori(cardTree(readNumberFile(src)), { width: 1200, height: 630, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);

  console.log(`og: ${png.byteLength} bytes -> ${out} (1200x630)`);
}

/* Importing this module builds no card and reads no font: only running it
   does. That is what lets a test read the card's text tree cheaply. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
