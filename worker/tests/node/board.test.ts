import { describe, expect, it } from "vitest";
import { buildBoardRows, pairUnits, type BoardDbRow } from "../../src/board";

/* A quantity is only legible in its own units: 8090000000 is 8,090 USDG, and
   4200000000000000000 is 4.2 ETH. Neither is legible as the integer, and a
   GUESSED exponent is worse than none because it moves the figure by orders
   of magnitude -- decimals.ts's rule, which this must not quietly break for
   the sake of a tidier board. The board resolves units from the pair-token
   map alone: 121 rows could never afford a decimals() call each. */
/* 2026-09-12: pairUnits gained a second parameter, the live `pair_token`
   table cache, consulted BEFORE the static registry map so a real pair token
   the registry has never classified (a tokenized-stock pair, say) can still
   show real units once worker/src/reserve.ts has read it once. Every call
   below that exercises the registry-only path now passes `null` for that new
   first map, which reproduces the exact old "registry alone" behaviour these
   tests were written to check. */
describe("the board's pair units", () => {
  const map = {
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": { class: "stable", symbol: "USDG", decimals: 6 },
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": { class: "stock", symbol: "TSLAX" },
  };

  it("reads the zero address as ETH at 18, by the factory's own definition", () => {
    expect(pairUnits("0x0000000000000000000000000000000000000000", null, null)).toEqual({
      pairDecimals: 18,
      pairSymbol: "ETH",
    });
  });

  it("takes decimals and symbol from the map when the map carries them", () => {
    expect(pairUnits("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", null, map)).toEqual({
      pairDecimals: 6,
      pairSymbol: "USDG",
    });
  });

  it("returns null decimals rather than assuming 18 when the map has none", () => {
    expect(pairUnits("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", null, map)).toEqual({
      pairDecimals: null,
      pairSymbol: "TSLAX",
    });
  });

  it("returns null for both when the pair token is not in the map at all", () => {
    expect(pairUnits("0xcccccccccccccccccccccccccccccccccccccccc", null, map)).toEqual({
      pairDecimals: null,
      pairSymbol: null,
    });
  });
});

/* The `pair_token` table lookup path (2026-09-12): board.ts's own D1-backed
   cache, checked before the static registry map and never fallen through on
   a NULL field within a row that exists -- only a genuine table MISS falls
   back to the registry. */
describe("the board's pair units — pair_token table cache", () => {
  const registry = {
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": { class: "stable", symbol: "USDG", decimals: 6 },
  };

  it("table hit: uses the table's decimals/symbol, not the registry's", () => {
    const db = new Map([
      ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { decimals: 8, symbol: "USDG8" }],
    ]);
    expect(pairUnits("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", db, registry)).toEqual({
      pairDecimals: 8,
      pairSymbol: "USDG8",
    });
  });

  it("table miss: falls back to the registry map", () => {
    const db = new Map([["0xdddddddddddddddddddddddddddddddddddddddd", { decimals: 18, symbol: "OTHER" }]]);
    expect(pairUnits("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", db, registry)).toEqual({
      pairDecimals: 6,
      pairSymbol: "USDG",
    });
  });

  it("a table row with NULL decimals never guesses from the registry", () => {
    const db = new Map([
      ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { decimals: null, symbol: null }],
    ]);
    expect(pairUnits("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", db, registry)).toEqual({
      pairDecimals: null,
      pairSymbol: null,
    });
  });

  it("the zero address is ETH/18 before either map is consulted", () => {
    const db = new Map([["0x0000000000000000000000000000000000000000", { decimals: 6, symbol: "WRONG" }]]);
    expect(pairUnits("0x0000000000000000000000000000000000000000", db, null)).toEqual({
      pairDecimals: 18,
      pairSymbol: "ETH",
    });
  });
});

/* The token's own name()/symbol() (2026-09-12, worker/schema.sql's
   `token_meta` cache) -- never the pair token, which pairSymbol is about. */
describe("board rows carry the token's own name/symbol", () => {
  const NOW = 1_762_536_735;
  const CURSOR = { last_indexed_block: 56_172_588, last_success_at: NOW - 20, consecutive_failures: 0 };

  function dbRow(): BoardDbRow {
    return {
      token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      pair_class: "eth",
      pair_token: "0x0000000000000000000000000000000000000000",
      creator_tax_bps: 300,
      graduation_threshold: "4200000000000000000",
      block: 56_150_000,
      ts: NOW - 3_600,
      graduated: 0,
      from_block: 56_150_000,
      buys: 3,
      sells: 1,
      quote_in: "100",
      quote_out: "0",
      first_block_buyers: 1,
      last_activity_ts: NOW - 100,
      reserve_wei: null,
      reserve_block: null,
    };
  }

  it("reads name/symbol from the token_meta map when a row exists", () => {
    const dbTokenMeta = new Map([
      ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { name: "Pons Coin", symbol: "PONS" }],
    ]);
    const rows = buildBoardRows([dbRow()], CURSOR, NOW, "buys", 200, null, null, dbTokenMeta);
    expect(rows[0]!.name).toBe("Pons Coin");
    expect(rows[0]!.symbol).toBe("PONS");
  });

  it("is null for both when there is no token_meta row -- never a guess", () => {
    const rows = buildBoardRows([dbRow()], CURSOR, NOW, "buys");
    expect(rows[0]!.name).toBeNull();
    expect(rows[0]!.symbol).toBeNull();
  });

  it("stays null when the token_meta row itself holds NULL -- a saved result, not a miss", () => {
    const dbTokenMeta = new Map([
      ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { name: null, symbol: null }],
    ]);
    const rows = buildBoardRows([dbRow()], CURSOR, NOW, "buys", 200, null, null, dbTokenMeta);
    expect(rows[0]!.name).toBeNull();
    expect(rows[0]!.symbol).toBeNull();
  });
});
