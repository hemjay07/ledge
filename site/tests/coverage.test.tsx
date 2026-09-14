import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCoverage } from "../lib/coverage";
import { coverageCardText } from "../lib/coverage-text";

const doc = {
  measuredAt: "2026-09-14T18:40:00Z",
  window: "launches in the last 24 hours of the canonical record",
  sampled: 200,
  present: 199,
  presentShare: 0.995,
  launchBlockRead: 197,
  launchBlockReadShare: 0.985,
  insufficient: false,
  cursorLastSuccessAt: "2026-09-14T18:39:50Z",
  cursorAgeSeconds: 10,
};

describe("the live index's coverage figure (A4)", () => {
  it("is absent, not invented, when the file is not there", () => {
    expect(readCoverage(mkdtempSync(join(tmpdir(), "cov-")))).toBeNull();
  });

  it("reads the file the crawl writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "cov-"));
    writeFileSync(join(dir, "coverage.json"), JSON.stringify(doc));
    expect(readCoverage(dir)?.present).toBe(199);
  });

  it("says the three figures with their n, and the floor when under it", () => {
    const text = coverageCardText(doc);
    expect(text.coverage).toBe("199 of 200 sampled launches have a row in the live index (99.5%).");
    expect(text.launchBlock).toBe("For 197 of the 200 the launch block itself was read (98.5%).");
    expect(text.freshness).toContain("10 s");
    const thin = coverageCardText({ ...doc, sampled: 12, present: 12, presentShare: null, launchBlockRead: 12, launchBlockReadShare: null, insufficient: true });
    expect(thin.coverage).toContain("not enough data (n=12)");
    expect(thin.coverage).not.toMatch(/\d%/);
  });
});
