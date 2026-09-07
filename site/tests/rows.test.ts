import { describe, expect, it } from "vitest";
import { formatRate } from "../lib/format";
import { cohortFooting, cohortRegisterRow, shareCell } from "../lib/rows";
import { insufficientFile, h24 } from "./fixtures";

/* W16: the launches-per-deployer share divides by the distinct-deployer count.
   An empty window makes that 0/0, which formats as "NaN%" — a number with no
   denominator, printed as though it had one. */
describe("a share of an empty population", () => {
  it("names the sample size instead of dividing by zero", () => {
    expect(shareCell(0, 0)).toEqual({ text: "not enough data (n=0)", kind: "thin" });
    expect(shareCell(4, 0).text).not.toContain("NaN");
    expect(shareCell(4, 0).text).not.toContain("%");
  });

  it("does not print a share the population cannot support", () => {
    expect(shareCell(3, 29)).toEqual({ text: "not enough data (n=29)", kind: "thin" });
    expect(shareCell(3, 30)).toEqual({ text: "10.0%", kind: "fig" });
  });

  it("prints the share, in the figure face, when the population supports it", () => {
    expect(shareCell(1960, 2223)).toEqual({ text: "88.17%", kind: "fig" });
  });
});

describe("a register row for an insufficient cohort", () => {
  const w = insufficientFile().h24;

  it("keeps the counts and drops the percentage", () => {
    const row = cohortRegisterRow("ETH", w.cohorts.pair[0]);
    expect(row.cells.map((c) => c.text)).toEqual(["12", "0", "not enough data (n=12)"]);
    expect(row.cells[2].kind).toBe("thin");
  });

  it("prints no percentage in the All footing either", () => {
    expect(cohortFooting(w).cells[2].text).toBe("not enough data (n=12)");
  });

  it("still prints a rate when the sample supports one", () => {
    const eth = h24.cohorts.pair[0];
    expect(cohortRegisterRow("ETH", eth).cells[2]).toEqual({
      text: formatRate(eth.rate as number, eth.launches),
      kind: "fig",
    });
  });
});
