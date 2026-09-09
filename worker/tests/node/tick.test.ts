import { describe, expect, it } from "vitest";
import {
  BLOCKS_PER_TICK,
  COLD_START_BLOCKS,
  LOG_SUBREQUEST_BUDGET,
  MAX_CATCHUP_BLOCKS,
  REORG_OVERLAP_BLOCKS,
  fitWindow,
  logSubrequests,
  logWindows,
  tickLogSubrequests,
} from "../../src/tick";

/* B8 — the overlap against the advance it is meant to cover.

   The cron is every minute and the chain runs at about 0.1 s a block, so a
   tick advances roughly 600 blocks. The overlap was 200: a third of one
   tick's advance, which cannot catch a reorg that reaches back past the
   blocks this tick happens to have re-read. Both numbers describe the same
   quantity -- one minute of chain -- so they are now one constant. */
describe("the reorg overlap", () => {
  it("is derived from the same constant as the cold start", () => {
    expect(COLD_START_BLOCKS).toBe(BLOCKS_PER_TICK);
    expect(REORG_OVERLAP_BLOCKS % BLOCKS_PER_TICK).toBe(0);
  });

  it("covers at least two ticks' advance", () => {
    expect(REORG_OVERLAP_BLOCKS).toBeGreaterThanOrEqual(2 * BLOCKS_PER_TICK);
    expect(REORG_OVERLAP_BLOCKS).toBe(1200);
  });
});

/* W3 — the subrequest budget.

   A window wider than the budget allows is not a window to give up on: the
   blocks are still there and the next tick would ask for exactly the same
   ones. Halving until it fits makes progress every pass, and the cursor
   advances to what was actually read. */
describe("fitting a window inside the subrequest budget", () => {
  it("leaves a window that already fits alone", () => {
    const to = 5_000_000;
    expect(fitWindow(5_000_000 - 2_000, to)).toBe(to);
  });

  it("halves an oversized window until it fits, and converges", () => {
    const from = 1_000_000;
    const to = from + 10_000_000;
    const fitted = fitWindow(from, to);
    expect(fitted).toBeGreaterThan(from); // progress, not a refusal
    expect(fitted).toBeLessThan(to);
    expect(logSubrequests(from, fitted)).toBeLessThanOrEqual(LOG_SUBREQUEST_BUDGET);
  });

  it("converges for every budget down to a single window", () => {
    for (const budget of [2, 4, 8, 20, LOG_SUBREQUEST_BUDGET]) {
      const from = 42;
      const fitted = fitWindow(from, from + 5_000_000, budget);
      expect(fitted).toBeGreaterThanOrEqual(from);
      expect(logSubrequests(from, fitted)).toBeLessThanOrEqual(budget);
    }
  });

  it("counts two log requests per thousand-block window, one per topic", () => {
    expect(logSubrequests(1, 2500)).toBe(logWindows(1, 2500).length * 2);
  });

  it("keeps the bounded catch-up inside the budget it is bounded for", () => {
    const from = 1_000;
    const to = from + MAX_CATCHUP_BLOCKS + REORG_OVERLAP_BLOCKS;
    expect(logSubrequests(from, to)).toBeLessThanOrEqual(LOG_SUBREQUEST_BUDGET);
  });
});

/* Phase A — the curve topics against the same budget.

   The factory pair is read over the whole re-read range and the curve pair
   over the blocks above the previous cursor, which is a subset of it. The
   budget is fitted against twice the factory cost, which bounds both. */
describe("the curve topics inside the subrequest budget", () => {
  it("counts a second pair of topics over the same range", () => {
    expect(tickLogSubrequests(1, 2500)).toBe(logSubrequests(1, 2500) * 2);
  });

  it("keeps the bounded catch-up inside the budget with both pairs read", () => {
    const from = 1_000;
    const to = from + MAX_CATCHUP_BLOCKS + REORG_OVERLAP_BLOCKS;
    expect(tickLogSubrequests(from, to)).toBeLessThanOrEqual(LOG_SUBREQUEST_BUDGET);
  });

  it("fits a window against the cost of both pairs, not one", () => {
    const from = 4_000_000;
    const fitted = fitWindow(from, from + 10_000_000);
    expect(tickLogSubrequests(from, fitted)).toBeLessThanOrEqual(LOG_SUBREQUEST_BUDGET);
  });

  it("spends two extra requests on a steady tick", () => {
    // one minute of new chain, one window, two curve topics
    expect(tickLogSubrequests(1, BLOCKS_PER_TICK) - logSubrequests(1, BLOCKS_PER_TICK)).toBe(2);
  });
});
