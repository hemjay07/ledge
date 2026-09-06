import { describe, expect, it } from "vitest";
import { allTime, h24 } from "../lib/number";
import { SAME_MEASUREMENT_NOTE, sameMeasurement } from "../lib/windows";
import { cohortFooting, cohortRateCell, cohortRegisterRow } from "../lib/rows";
import { insufficientFile } from "./fixtures";
import type { CohortRow } from "../lib/schema";

/* A bucket that recorded no graduations has not measured a rate of zero. It
   has measured no graduations, and 0 of 244 is statistically indistinguishable
   from the headline rate — printing "0.0%" beside "2.16%" invites a comparison
   the sample cannot support. CONSTRAINTS.md §4: never fake precision. */
describe("a cohort with no graduations", () => {
  const row = (over: Partial<CohortRow>): CohortRow => ({
    bucket: "4-5%",
    launches: 244,
    graduations: 0,
    rate: 0,
    insufficient: false,
    ...over,
  });

  it("prints the count it observed, not a rate of zero", () => {
    expect(cohortRateCell(row({}))).toEqual({ text: "0 of 244", kind: "thin" });
  });

  it("never renders a percentage for it", () => {
    expect(cohortRateCell(row({})).text).not.toContain("%");
    expect(cohortRegisterRow("4–5%", row({})).cells[2].text).not.toContain("%");
  });

  it("still prints a rate as soon as one graduation is observed", () => {
    expect(cohortRateCell(row({ graduations: 1, rate: 0.004098 }))).toEqual({
      text: "0.4%",
      kind: "fig",
    });
  });

  it("prefers the insufficient wording when the sample is also too small", () => {
    expect(cohortRateCell(row({ launches: 12, rate: null, insufficient: true })).text).toBe(
      "not enough data (n=12)",
    );
  });

  it("applies the same guard to the All footing", () => {
    const w = { ...h24, graduations: 0, rate: 0 };
    expect(cohortFooting(w).cells[2]).toEqual({
      text: `0 of ${h24.launches.toLocaleString("en-US")}`,
      kind: "thin",
    });
  });
});

/* One measurement rendered twice reads as two measurements agreeing. */
describe("the all-time window while it holds the same launches as 24 hours", () => {
  it("is detected from the data, not from a flag", () => {
    const same = insufficientFile();
    expect(sameMeasurement(same.h24, same.allTime)).toBe(true);
  });

  it("stops being detected the moment either window moves", () => {
    const f = insufficientFile();
    expect(sameMeasurement(f.h24, { ...f.allTime, launches: f.allTime.launches + 1 })).toBe(false);
    expect(sameMeasurement(f.h24, { ...f.allTime, graduations: 99 })).toBe(false);
    expect(sameMeasurement(f.h24, { ...f.allTime, rate: 0.5 })).toBe(false);
  });

  it("says so rather than hiding the window", () => {
    expect(SAME_MEASUREMENT_NOTE).toContain("All-time equals the trailing 24 hours");
  });

  it("matches the committed measurement's current state", () => {
    expect(sameMeasurement(h24, allTime)).toBe(h24.launches === allTime.launches);
  });
});
