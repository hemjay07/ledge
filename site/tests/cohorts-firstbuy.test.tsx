import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Cohorts from "../app/cohorts/page";
import { numberFile } from "../lib/number";

afterEach(cleanup);

/* A5b (design/FIRSTBUY-BRIEF.md, METHOD.md 2026-09-13): the first-buy
   timing is published over the whole record, not per window, so it is its
   own card under the windows. Every share goes through the same gate as
   every other figure: below n = 30 the cell says "not enough data (n=...)"
   and the counts are still there. */
describe("the first-buy card on /cohorts", () => {
  it("renders when number.json carries the block, with the population stated", () => {
    expect(numberFile.firstBuy, "the schema must carry firstBuy; a test that returns early here agrees trivially").toBeDefined();
    const { container } = render(<Cohorts />);
    const card = container.querySelector("#h-firstbuy");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("at least one hour old");
  });

  it("prints no share without its n, and says so below the floor", () => {
    expect(numberFile.firstBuy, "the schema must carry firstBuy; a test that returns early here agrees trivially").toBeDefined();
    const { container } = render(<Cohorts />);
    const card = container.querySelector("#h-firstbuy");
    const tables = card?.querySelectorAll("table") ?? [];
    expect(tables.length).toBeGreaterThanOrEqual(2);
    const all = numberFile.firstBuy!.cohorts.all[0];
    if (all && all.insufficient) {
      expect(card?.textContent).toContain(`not enough data (n=${all.n})`);
      /* the row heads carry the tax bands ("2-3%"), so the check is on the
         figure cells alone: none may print a percentage below the floor */
      const thin = [...(card?.querySelectorAll("td.thin") ?? [])];
      expect(thin.length).toBeGreaterThan(0);
      for (const cell of thin) expect(cell.textContent).toContain("not enough data");
      for (const cell of card?.querySelectorAll("td.fig:not(.n)") ?? []) {
        expect(cell.textContent).not.toMatch(/%/);
      }
    }
  });

  it("says when first buys are not yet indexed rather than printing zeros as findings", () => {
    expect(numberFile.firstBuy, "the schema must carry firstBuy; a test that returns early here agrees trivially").toBeDefined();
    const { container } = render(<Cohorts />);
    const card = container.querySelector("#h-firstbuy");
    if (numberFile.firstBuy!.indexedFromBlock === null) {
      expect(card?.textContent).toMatch(/not yet/i);
    } else {
      expect(card?.textContent).toContain("block");
    }
  });
});
