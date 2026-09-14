import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Cohorts from "../app/cohorts/page";
import { numberFile } from "../lib/number";

afterEach(cleanup);

/* A6 (OUTCOMES.md, METHOD.md 2026-09-12): what happened to a token's price
   after it graduated, per cohort, at +1 h / +24 h / +7 d against the pool's
   opening price. Median only (never a mean), with the n of graduations
   whose mark has elapsed; below n = 30 the cell says so. The first probe
   pass (2026-09-14) cleared n = 30 in two time-to-graduation buckets. */
describe("the after-graduation card on /cohorts", () => {
  it("renders when number.json carries outcomes, and states the definition", () => {
    expect(numberFile.outcomes, "outcomes must parse; an early return here agrees trivially").toBeDefined();
    const { container } = render(<Cohorts />);
    const card = container.querySelector("#h-outcomes");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("opening price");
    expect(card?.querySelectorAll("table").length).toBeGreaterThanOrEqual(3);
  });

  it("prints a median only where n clears the floor, and says so where it does not", () => {
    const { container } = render(<Cohorts />);
    const card = container.querySelector("#h-outcomes");
    const rows = numberFile.outcomes!.cohorts.ttg;
    for (const row of rows) {
      const mark = row.marks["24h"];
      if (mark.insufficient) {
        expect(card?.textContent).toContain(`not enough data (n=${mark.n})`);
      } else if (mark.median !== null) {
        const sign = mark.median < 0 ? "−" : "+";
        expect(card?.textContent).toContain(`${sign}${Math.abs(mark.median * 100).toFixed(1)}%`);
        expect(card?.textContent).toContain(`n=${mark.n}`);
      }
    }
    for (const cell of card?.querySelectorAll("td.thin") ?? []) {
      expect(cell.textContent).not.toMatch(/\d%/);
    }
  });
});
