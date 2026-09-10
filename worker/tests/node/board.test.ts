import { describe, expect, it } from "vitest";
import { pairUnits } from "../../src/board";

/* A quantity is only legible in its own units: 8090000000 is 8,090 USDG, and
   4200000000000000000 is 4.2 ETH. Neither is legible as the integer, and a
   GUESSED exponent is worse than none because it moves the figure by orders
   of magnitude -- decimals.ts's rule, which this must not quietly break for
   the sake of a tidier board. The board resolves units from the pair-token
   map alone: 121 rows could never afford a decimals() call each. */
describe("the board's pair units", () => {
  const map = {
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": { class: "stable", symbol: "USDG", decimals: 6 },
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": { class: "stock", symbol: "TSLAX" },
  };

  it("reads the zero address as ETH at 18, by the factory's own definition", () => {
    expect(pairUnits("0x0000000000000000000000000000000000000000", null)).toEqual({
      pairDecimals: 18,
      pairSymbol: "ETH",
    });
  });

  it("takes decimals and symbol from the map when the map carries them", () => {
    expect(pairUnits("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", map)).toEqual({
      pairDecimals: 6,
      pairSymbol: "USDG",
    });
  });

  it("returns null decimals rather than assuming 18 when the map has none", () => {
    expect(pairUnits("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", map)).toEqual({
      pairDecimals: null,
      pairSymbol: "TSLAX",
    });
  });

  it("returns null for both when the pair token is not in the map at all", () => {
    expect(pairUnits("0xcccccccccccccccccccccccccccccccccccccccc", map)).toEqual({
      pairDecimals: null,
      pairSymbol: null,
    });
  });
});
