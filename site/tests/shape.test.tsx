import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Shape } from "../components/Shape";
import { allTime } from "../lib/number";
import type { TtgHistogramBucket } from "../lib/schema";

afterEach(cleanup);

/* The drawing whose whole point is its shape. Every assertion here is about
   the ways a bar chart can lie without printing a false number: a truncated
   baseline, a bucket left out, a bar scaled to something other than its
   count, or a colour that turns a description into a verdict. */

const FROZEN: TtgHistogramBucket[] = [
  { fromSeconds: 0, toSeconds: 2, graduations: 150, share: 0.3 },
  { fromSeconds: 2, toSeconds: 5, graduations: 50, share: 0.1 },
  { fromSeconds: 5, toSeconds: 10, graduations: 300, share: 0.6 },
  { fromSeconds: 10, toSeconds: null, graduations: 0, share: 0 },
];
const FROZEN_N = 500;

function bars(container: HTMLElement): SVGRectElement[] {
  return Array.from(container.querySelectorAll("rect.shape-bar"));
}

describe("the shape of the record", () => {
  it("draws one bar per published bucket, leaving none out", () => {
    const { container } = render(<Shape histogram={FROZEN} n={FROZEN_N} insufficient={false} />);
    expect(bars(container)).toHaveLength(FROZEN.length);
  });

  /* A truncated baseline exaggerates a shape, and on this drawing the shape
     IS the claim. Heights must be proportional to the raw counts from zero:
     the 50-count bucket must be exactly one sixth of the 300-count bucket. */
  it("scales every bar from a zero baseline, in proportion to its own count", () => {
    const { container } = render(<Shape histogram={FROZEN} n={FROZEN_N} insufficient={false} />);
    const h = bars(container).map((b) => Number(b.getAttribute("height")));
    const tallest = Math.max(...h);
    FROZEN.forEach((bucket, i) => {
      expect(h[i]! / tallest).toBeCloseTo(bucket.graduations / 300, 5);
    });
    expect(h[3]).toBe(0); // an empty bucket is drawn empty, not dropped
  });

  it("sits every bar on the same baseline", () => {
    const { container } = render(<Shape histogram={FROZEN} n={FROZEN_N} insufficient={false} />);
    const feet = bars(container).map(
      (b) => Number(b.getAttribute("y")) + Number(b.getAttribute("height")),
    );
    expect(new Set(feet.map((f) => f.toFixed(4))).size).toBe(1);
  });

  /* Every bar carries its own count against the same denominator, so a reader
     hovering any bucket can check the drawing against the numbers. */
  it("gives every bucket its count and the denominator it was counted over", () => {
    const { container } = render(<Shape histogram={FROZEN} n={FROZEN_N} insufficient={false} />);
    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles[0]).toContain("150");
    expect(titles[0]).toContain("500");
    expect(titles[3]).toContain("and slower");
  });

  /* CONSTRAINTS 4: under the minimum the bars would be noise drawn at full
     height, which reads as a finding. */
  it("prints the sample size instead of drawing noise when the sample is too small", () => {
    const { container } = render(<Shape histogram={FROZEN} n={12} insufficient={true} />);
    expect(bars(container)).toHaveLength(0);
    expect(container.textContent).toContain("not enough data (n=12)");
  });

  /* CONSTRAINTS 6 and the design posture: --stale is the only colour on this
     site that means anything, and no bucket may be singled out as the bad
     one. Every bar carries the same class and no inline fill. */
  it("colours no bucket differently from any other", () => {
    const { container } = render(<Shape histogram={FROZEN} n={FROZEN_N} insufficient={false} />);
    for (const bar of bars(container)) {
      expect(bar.getAttribute("class")).toBe("shape-bar");
      expect(bar.getAttribute("fill")).toBeNull();
      expect(bar.getAttribute("style")).toBeNull();
    }
  });

  it("says nothing that labels a bucket", () => {
    const { container } = render(<Shape histogram={FROZEN} n={FROZEN_N} insufficient={false} />);
    const text = (container.textContent ?? "").toLowerCase();
    for (const word of ["rigged", "fake", "organic", "real", "self-fill", "suspicious"]) {
      expect(text).not.toContain(word);
    }
  });

  /* The live file must actually carry the block the page renders, and its
     buckets must account for every graduation counted -- a histogram whose
     bars do not sum to n is one that dropped some of the record. */
  it("is published for the whole record, with the buckets summing to n", () => {
    expect(allTime.ttg.histogram.length).toBeGreaterThan(0);
    const summed = allTime.ttg.histogram.reduce((acc, b) => acc + b.graduations, 0);
    expect(summed).toBe(allTime.ttg.n);
  });
});
