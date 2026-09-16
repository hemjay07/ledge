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
import { formatCount, formatDuration, formatStamp, rateText } from "./format";
import type { FirstBuyCohortRow, NumberFile } from "./numberFile";
import { taxLabel } from "./buckets";

const GROUND = "#EFEAE0";
const INK = "#16130F";
const INK_MUTED = "#57503F";
const PAD = 64;
/** The widest a line of the mono face fits between the pads at 28-30 px.
    A longer line runs off the card (2026-09-16: the graduation card's
    third line clipped at "Half the graduations took"). */
export const MAX_LINE_CHARS = 64;

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
