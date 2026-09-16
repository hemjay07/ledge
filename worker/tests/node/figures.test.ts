import { describe, expect, it } from "vitest";
import { collectText } from "../../src/card";
import { FIGURE_NAMES, figureCard } from "../../src/figures";
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
});
