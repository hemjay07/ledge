import { describe, expect, it } from "vitest";
import {
  excludingFastSentence,
  ponsNumberSentence,
  shareSummary,
} from "../lib/summary";
import { formatCount, formatRate, formatDurationLong, rateText, shareText } from "../lib/format";
import { insufficientFile, h24 , F } from "./fixtures";

const CUTOFF = formatDurationLong(300);

/* CONSTRAINTS.md §4: cohorts with n < 30 render as "not enough data (n=…)",
   never as a percentage. That rule binds the strings that leave the page —
   the accessible text under the poster figure, the page description and both
   unfurl descriptions — exactly as it binds the visible figure. */
describe("the sentences that carry a rate off the page", () => {
  const insufficient = insufficientFile().h24;

  it("prints no percentage anywhere for an insufficient window", () => {
    const built = [
      ponsNumberSentence(insufficient),
      ponsNumberSentence(insufficient, "2026-09-06T15:58:32Z"),
      excludingFastSentence(insufficient, CUTOFF),
      excludingFastSentence(insufficient, CUTOFF, true),
      shareSummary(insufficient, CUTOFF),
    ];
    for (const sentence of built) {
      expect(sentence).not.toContain("%");
      expect(sentence).toContain("not enough data (n=12)");
    }
  });

  it("names the sample size rather than rounding a null rate to zero", () => {
    expect(ponsNumberSentence(insufficient)).not.toContain("0.0");
    expect(shareSummary(insufficient, CUTOFF)).not.toContain("0.0");
  });

  it("still keeps the counts and the denominator in the sentence", () => {
    expect(ponsNumberSentence(insufficient)).toContain("0 of 12 Pons launches");
    expect(shareSummary(insufficient, CUTOFF)).toContain("12 Pons launches");
  });

  it("speaks the measurement time rather than spelling an ISO string", () => {
    const said = ponsNumberSentence(h24, "2026-09-06T15:58:32Z");
    expect(said).not.toContain("T15:58:32Z");
    expect(said).toContain("Measured 6 Sep 2026 · 15:58 UTC.");
  });

  it("prints the rate, unchanged, when the sample supports one", () => {
    expect(ponsNumberSentence(h24, "2026-09-06T15:58:32Z")).toBe(
      `${formatRate(F.rate, F.n)}: ${formatCount(F.graduations)} of ${formatCount(F.n)} ` +
        "Pons launches in the last 24 hours graduated. Measured 6 Sep 2026 · 15:58 UTC.",
    );
    expect(excludingFastSentence(h24, CUTOFF, true)).toBe(
      `${formatRate(F.efRate, F.n)} excluding launches that graduated inside ${CUTOFF}: ` +
        `${formatCount(F.efGraduations)} of ${formatCount(F.n)}.`,
    );
    // Order follows LEAD (excludingFast first); tests/lead.test.tsx covers both.
    expect(shareSummary(h24, CUTOFF)).toBe(
      `${formatRate(F.efRate, F.n)} excluding launches that graduated inside ${CUTOFF}. ` +
        `${formatRate(F.rate, F.n)} of ${formatCount(F.n)} Pons launches in the last 24 hours graduated.`,
    );
    // the cutoff is set with a non-breaking space: "5 minutes" never wraps
    expect(CUTOFF).toBe("5\u00A0minutes");
  });
});

describe("the one rate formatter", () => {
  it("refuses a null rate, an insufficient flag and a sample under 30 alike", () => {
    expect(rateText({ rate: null, n: 5000 })).toBe("not enough data (n=5000)");
    expect(rateText({ rate: 0.5, n: 5000, insufficient: true })).toBe("not enough data (n=5000)");
    expect(rateText({ rate: 0.5, n: 29 })).toBe("not enough data (n=29)");
    expect(rateText({ rate: 0.5, n: 30 })).toBe("50.0%");
  });

  it("does not divide by an empty population", () => {
    expect(shareText(0, 0)).toBe("not enough data (n=0)");
    expect(shareText(5, 0)).toBe("not enough data (n=0)");
    expect(shareText(1960, 2223)).toBe("88.17%");
  });
});
