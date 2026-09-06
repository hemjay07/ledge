import { describe, expect, it } from "vitest";
import { CARD_WIDTH, CARD_HEIGHT, cardTree, collectText, widthOf } from "../../src/card";
import { fixtureNumber, makeBody, ADDRESS, LAUNCH, NOW_SECONDS } from "./helpers";
import { FILL_GRADUATED } from "../../src/curve";

/* Gate 6. The card is the highest-leverage place for a naked number to
   escape, so the assertions are on the text the tree would render. */

const MAX = fixtureNumber().allTime.ttg.max;

describe("the death card", () => {
  it("is 1200x630", () => {
    expect([CARD_WIDTH, CARD_HEIGHT]).toEqual([1200, 630]);
  });

  it("carries the address, the cohort's n, and the colophon", () => {
    const body = makeBody();
    const text = collectText(cardTree(body, MAX));
    expect(text).toContain(ADDRESS.slice(0, 10));
    expect(text).toContain(`of ${body.cohort!.allTime!.launches.toLocaleString("en-US")} launches`);
    expect(text).toContain("LEDGE.TOOLS");
    expect(text).toContain("Measured 6 Sep 2026");
  });

  it("states the configuration the cohort is about", () => {
    const text = collectText(cardTree(makeBody(), MAX));
    expect(text).toContain("ETH");
    expect(text).toContain("2–3%");
  });

  it("renders an insufficient cohort as 'not enough data', never as a percentage", () => {
    const file = fixtureNumber();
    for (const w of [file.h24, file.allTime]) {
      w.cohorts.pairTax = w.cohorts.pairTax!.map((r) => ({
        ...r,
        launches: 17,
        graduations: 0,
        rate: null,
        insufficient: true,
        excludingFast: { ...r.excludingFast, graduations: 0, rate: null, oneIn: null, insufficient: true },
      }));
    }
    const text = collectText(cardTree(makeBody({ numberFile: file }), MAX));
    expect(text).toContain("not enough data (n=17)");
    expect(text).not.toMatch(/\d\.\d%/);
  });

  it("says the fill is unavailable rather than drawing an empty bar", () => {
    expect(collectText(cardTree(makeBody(), MAX))).toContain("Curve fill: fill not available");
  });

  it("says so plainly when no cohort has been published", () => {
    const text = collectText(cardTree(makeBody({ numberFile: null }), null));
    expect(text).toContain("no cohort has been published for this configuration");
    expect(text).not.toMatch(/\d\.\d%/);
  });

  it("is set in one ground with no colour but the stale mark", () => {
    const json = JSON.stringify(cardTree(makeBody(), MAX));
    const colours = new Set(json.match(/#[0-9A-Fa-f]{6}/g) ?? []);
    for (const colour of colours) {
      expect(["#EFEAE0", "#16130F", "#57503F", "#645E4E", "#B3321C"]).toContain(colour);
    }
  });
});

describe("the plate", () => {
  /* The card is a fixed plate and the strings on it vary in length by half
     again. Every case below is one that was actually produced by a real token
     during the build, and each is checked at the pixel rather than by eye. */
  const PLATE = CARD_WIDTH - 128;

  const CASES: Array<[string, Parameters<typeof makeBody>[0]]> = [
    ["a short headline", {}],
    ["a graduated token with no cohort and no launch time", {
      launch: null,
      numberFile: null,
      graduation: { token: ADDRESS, block: 1, ts: NOW_SECONDS },
      fill: { filledWei: "8090000000", thresholdWei: "8090000000", share: 1, note: FILL_GRADUATED },
    }],
    ["an 18-decimal fill against an unusual threshold", {
      fill: {
        filledWei: "3761750137674353722",
        thresholdWei: "206740198138697096367",
        share: 0.018196,
        note: null,
      },
    }],
    ["a launch older than the table", { launch: { ...LAUNCH, ts: NOW_SECONDS - 99_999 } }],
  ];

  describe("every line stays on the plate", () => {
    for (const [name, overrides] of CASES) {
      it(name, () => {
        for (const t of cardTree(makeBody(overrides), 7953).texts) {
          const width = widthOf(t.text, t.size, t.letterSpacing ?? 0);
          expect(width, `${t.text} (${Math.round(width)}px)`).toBeLessThanOrEqual(PLATE);
          // and set down only so far that it stays readable
          expect(t.size, t.text).toBeGreaterThanOrEqual(14);
        }
      });
    }

    it("keeps the fill line clear of the address it shares a row with", () => {
      const card = cardTree(
        makeBody({
          fill: { filledWei: "8090000000", thresholdWei: "8090000000", share: 1, note: FILL_GRADUATED },
        }),
        7953,
      );
      const fill = card.texts.find((t) => t.text.startsWith("Curve fill"))!;
      const address = card.texts.find((t) => t.text.includes("\u2026"))!;
      expect(fill.y).toBe(address.y);
      const fillEnds = fill.x + widthOf(fill.text, fill.size);
      const addressStarts = address.x - widthOf(address.text, address.size);
      expect(fillEnds, "the fill line runs into the address").toBeLessThan(addressStarts);
    });
  });
});
