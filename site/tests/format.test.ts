import { describe, expect, it } from "vitest";
import {
  decimalsFor,
  formatAge,
  formatCount,
  formatDuration,
  formatOneIn,
  formatRate,
  formatStamp,
  formatUtcLong,
  insufficientText,
} from "../lib/format";

describe("precision follows the sample size", () => {
  it("takes two decimals at n >= 1,000 and one below", () => {
    expect(decimalsFor(1000)).toBe(2);
    expect(decimalsFor(999)).toBe(1);
    expect(formatRate(0.018524, 3347)).toBe("1.85%");
    expect(formatRate(0.028027, 892)).toBe("2.8%");
    expect(formatRate(0.024975, 1962)).toBe("2.50%");
    expect(formatRate(0.006944, 144)).toBe("0.7%");
    expect(formatRate(0, 127)).toBe("0.0%");
  });

  it("honours an explicit precision override", () => {
    expect(formatRate(0.018524, 12, 2)).toBe("1.85%");
  });
});

describe("durations", () => {
  it("prints seconds, minutes, then hours and minutes", () => {
    expect(formatDuration(41)).toBe("41 s");
    expect(formatDuration(8)).toBe("8 s");
    expect(formatDuration(239)).toBe("4 min");
    expect(formatDuration(300)).toBe("5 min");
    expect(formatDuration(473)).toBe("8 min");
    expect(formatDuration(1108)).toBe("18 min");
    expect(formatDuration(2518)).toBe("42 min");
    expect(formatDuration(3720)).toBe("1 h 2 min");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(7140)).toBe("1 h 59 min");
  });
});

describe("age", () => {
  it("coarsens as the measurement gets older", () => {
    expect(formatAge(41)).toBe("41 s");
    expect(formatAge(720)).toBe("12 min");
    expect(formatAge(7200)).toBe("2 h");
    expect(formatAge(200000)).toBe("2 d");
  });
});

describe("counts and citations", () => {
  it("separates thousands", () => {
    expect(formatCount(3347)).toBe("3,347");
    expect(formatCount(62)).toBe("62");
    expect(formatCount(23552)).toBe("23,552");
  });

  it("prints 1 in N", () => {
    expect(formatOneIn(279)).toBe("1 in 279");
    expect(formatOneIn(1350)).toBe("1 in 1,350");
  });

  it("names the sample size when there is not enough of it", () => {
    expect(insufficientText(26)).toBe("not enough data (n=26)");
    expect(insufficientText(0)).toBe("not enough data (n=0)");
  });

  it("stamps the measurement in UTC", () => {
    expect(formatStamp("2026-09-06T15:58:32Z")).toBe("Measured 6 Sep 2026 · 15:58 UTC");
    expect(formatUtcLong("2026-09-06T15:58:32Z")).toBe("15:58 UTC, 6 September 2026");
  });
});
