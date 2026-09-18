import { describe, expect, it } from "vitest";
import { collectText } from "../../src/card";
import { FIGURE_NAMES, MAX_LINE_CHARS, figureCard } from "../../src/figures";
import { fixtureNumber } from "./helpers";

/* 2026-09-16: a self-attributing image for every figure a post might carry,
   so a post is never a screenshot. Each card is built from number.json's own
   values (nothing computed here), carries its n and its stamp, and the
   LEDGE.TOOLS colophon. A figure under the floor prints its sample size. */
const withFirstBuy = () => ({
  ...fixtureNumber(),
  firstBuy: {
    indexedFromBlock: 1,
    population: "launches at least one hour old at crawledAt, launched at or after indexedFromBlock",
    cohorts: {
      all: [{ bucket: "all", n: 21293, launchTxBuy: 17008, launchTxBuyShare: 0.79876, outside: { sameBlock: 201, within1s: 8298, within3s: 3311, within5s: 966, after5s: 3283, none: 5234 }, sameBlockShare: 0.009, within1sShare: 0.399145, within3sShare: 0.55, within5sShare: 0.600009, noneShare: 0.245808, insufficient: false }],
      taxBucket: [{ bucket: "2-3", n: 12, launchTxBuy: 1, launchTxBuyShare: null, outside: { sameBlock: 0, within1s: 0, within3s: 0, within5s: 0, after5s: 0, none: 12 }, sameBlockShare: null, within1sShare: null, within3sShare: null, within5sShare: null, noneShare: null, insufficient: true }],
      pairClass: [],
    },
  },
});

describe("figure cards", () => {
  it("names every card it can draw", () => {
    expect(FIGURE_NAMES).toContain("firstbuy");
    expect(FIGURE_NAMES).toContain("graduation");
    expect(figureCard("no-such-card", withFirstBuy() as never, null)).toBeNull();
  });

  it("the first-buy card carries the shares, their n, the stamp and the colophon", () => {
    const card = figureCard("firstbuy", withFirstBuy() as never, null)!;
    const text = collectText(card);
    expect(text).toContain("39.91%");
    expect(text).toContain("60.00%");
    expect(text).toContain("n=21,293");
    expect(text).toContain("LEDGE.TOOLS");
    expect(text).toContain("Measured");
    expect(text).not.toMatch(/score|risk|predict|will |sniped/i);
  });

  it("the graduation card reads the rate, its n and the median off the file", () => {
    const file = fixtureNumber();
    const card = figureCard("graduation", file, null)!;
    const text = collectText(card);
    expect(text).toContain(`of ${file.allTime.launches.toLocaleString("en-US")} launches`);
    expect(text).toContain("LEDGE.TOOLS");
  });

  it("a band under the floor prints its sample size and no percentage", () => {
    const card = figureCard("firstbuy-tax-2-3", withFirstBuy() as never, null)!;
    const text = collectText(card);
    expect(text).toContain("not enough data (n=12)");
    expect(text).not.toMatch(/\d\.\d+%/);
  });

  it("the graveyard card needs the live total and says so without it", () => {
    expect(figureCard("graveyard", fixtureNumber(), null)).toBeNull();
    const card = figureCard("graveyard", fixtureNumber(), { total: 576, watched: 55532, since: "2026-09-07T01:13:15Z" })!;
    expect(collectText(card)).toContain("576");
    expect(collectText(card)).toContain("55,532");
  });

  it("no body line is wider than the card", () => {
    const file = fixtureNumber();
    for (const name of FIGURE_NAMES) {
      const card = figureCard(name, file, { total: 576, watched: 55385, since: "2026-09-05T00:00:00Z" });
      for (const t of card?.texts ?? []) {
        if (t.size >= 28 && t.size <= 30) expect(t.text.length, `${name}: ${t.text}`).toBeLessThanOrEqual(MAX_LINE_CHARS);
      }
    }
  });
});

describe("the token card", () => {
  it("leads with the token's own fill, counts and first outside buy, then the cohort with its n", async () => {
    const { tokenCard } = await import("../../src/figures");
    const { makeBody, ACTIVITY } = await import("./helpers");
    const body = makeBody({ activity: ACTIVITY, fill: { filledWei: "1892200000000000000", thresholdWei: "4200000000000000000", share: 0.4505, note: null } });
    const card = tokenCard(body, 1_762_536_735);
    const lines = card.texts.map((t) => t.text);
    expect(lines[0]).toMatch(/^PONS · ON THE CURVE · .* OLD$/);
    expect(lines[1]).toBe("0x23fe54b3…f98fe2"); // the name is the headline; the address when there is none
    expect(lines[2]).toBe("45.1% of the curve filled: 1.8922 ETH of 4.2 ETH.");
    expect(lines[3]).toMatch(/buys · .* sells · .* in the launch block\./);
    expect(lines[4]).toContain("First outside buy:");
    expect(lines[5]).toMatch(/of graduations were done within .* \(n=[0-9,]+\); this launch was not\.$/);
    expect(lines[6]).toMatch(/^Launches like this \(.*\), n=[0-9,]+:$/);
    expect(lines[7]).toMatch(/graduated · .* leaving out graduations under 5 min\.$/);
    for (const t of card.texts) if (t.size >= 26 && t.size <= 30) expect(t.text.length).toBeLessThanOrEqual(64);
    expect(lines.some((l) => l.startsWith("Read "))).toBe(true);
  });
});
