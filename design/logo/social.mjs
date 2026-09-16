// The X profile image and banner, from the same four rectangles as
// design/logo/finals/logo.svg. Run from site/e2e (playwright is installed
// there):  node ../../design/logo/social.mjs
//
// 2026-09-16, after the profile brainstorm. The profile image had the mark
// at ~55% of the square, a smudge at 48 px; it is now 74%, the two thin
// rules thickened so the thinnest stroke is 14 px at 400, and every stroke
// inside the 360 px circle X crops to. The banner carried a three-line
// description nobody can read at phone size; it now carries the mark, the
// wordmark, and a rule along the bottom edge, and nothing that can go stale.

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "finals", "social");
const anton = readFileSync(join(here, "../../site/fonts/Anton-Regular.ttf")).toString("base64");

const GROUND = "#EFEAE0";
const INK = "#16130F";

// The mark at a given size, s, drawn in the 100-unit grid of logo.svg but
// with the thin rules at 4.5 units (they are 4.14 in the favicon, where the
// grid is finer) so they survive the 48 px feed size.
function mark(s) {
  const u = s / 100;
  const r = (x, y, w, h) => `<rect x="${x * u}" y="${y * u}" width="${w * u}" height="${h * u}" fill="${INK}"/>`;
  return r(4, 4, 10.12, 92) + r(4, 61.04, 92, 20.24) + r(4, 84.3, 92, 4.5) + r(4, 91.5, 92, 4.5);
}

// Profile: 400 x 400. Mark 296 wide (74%), centred: X crops to the inscribed
// circle (radius 200), and the mark's far corners sit 0.65 x its size from
// the centre, so 296 keeps every corner 8 px inside the crop. At 320 the
// corners were clipped.
const profile = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<rect width="400" height="400" fill="${GROUND}"/>
<g transform="translate(52 52)">${mark(296)}</g>
</svg>`;

// Banner: 1500 x 500. Phone crop shows roughly x 150 to 1350; the profile
// image overlaps the bottom-left to about x 340. The mark IS the L of the
// wordmark (2026-09-17: with the mark beside "LEDGE" the eye read "L LEDGE"):
// its vertical stroke spans the cap height of EDGE, its shelf sits on the
// baseline, and the two rules hang below like a descender. The mark's L
// runs from 4 to 81.28 on its 100-unit grid, so its size is capHeight / 0.7728.
const FONT = 190;
const CAP = Math.round(FONT * 0.863); // Anton cap height, measured from the E ink in the browser below and asserted
const MARK = CAP / 0.7728;
const BASELINE = 330;
const LEFT = 412; // the group (mark to E) then centres on 750
const GAP = 26;
const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500">
<style>@font-face{font-family:Anton;src:url(data:font/ttf;base64,${anton})}</style>
<rect width="1500" height="500" fill="${GROUND}"/>
<g transform="translate(${LEFT - MARK * 0.04} ${BASELINE - MARK * 0.8128})">${mark(MARK)}</g>
<text id="word" x="${LEFT + MARK * 0.96 + GAP}" y="${BASELINE}" font-family="Anton" font-size="${FONT}" letter-spacing="26" fill="${INK}">EDGE</text>
<rect x="0" y="497" width="1500" height="3" fill="${INK}"/>
</svg>`;

const browser = await chromium.launch();
for (const [name, svg, w, h] of [["x-profile-400.png", profile, 400, 400], ["x-header-1500x500.png", banner, 1500, 500]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><body style="margin:0;background:${GROUND}">${svg}</body>`);
  await page.evaluate(() => document.fonts.ready);
  if (name.startsWith("x-header")) {
    // Ink, not the font box: scan the E's pixels for its top row and right edge.
    const ink = await page.evaluate(() => {
      const c = document.createElement("canvas"); c.width = 1500; c.height = 500;
      const g = c.getContext("2d");
      const t = document.getElementById("word");
      g.font = `${t.getAttribute("font-size")}px Anton`; g.fillStyle = "#000";
      const x = Number(t.getAttribute("x")), y = Number(t.getAttribute("y"));
      g.fillText("E", x, y);
      const d = g.getImageData(0, 0, 1500, 500).data;
      let top = -1;
      for (let row = 0; row < 500 && top < 0; row++) for (let col = 0; col < 1500; col++) if (d[(row * 1500 + col) * 4 + 3] > 0) { top = row; break; }
      return { top, right: t.getBBox().x + t.getBBox().width };
    });
    const markTop = BASELINE - MARK * 0.8128 + MARK * 0.04;
    console.log("E ink top", ink.top, "mark top", markTop.toFixed(1), "word right edge", ink.right.toFixed(0));
    if (Math.abs(ink.top - markTop) > 2) throw new Error(`cap height mismatch: CAP should be about ${(BASELINE - ink.top)}`);
    if (ink.right > 1300) throw new Error("wordmark runs past the phone-safe edge");
  }
  await page.screenshot({ path: join(out, name), clip: { x: 0, y: 0, width: w, height: h }, omitBackground: false });
  console.log("wrote", name);
}
await browser.close();
