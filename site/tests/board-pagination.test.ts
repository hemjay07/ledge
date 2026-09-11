import { describe, expect, it } from "vitest";
import { clampPage, paginate, PAGE_SIZE, totalPagesFor } from "../lib/paginate";
import { TAX_BUCKETS, taxBucketOf } from "../lib/board-buckets";

/* Pure logic shared by /graduated, /live and /graveyard (REVAMP.md
   pagination and filters). Page size is PAGE_SIZE (the lib's own
   requirement); these tests pin that number down the way a hardcoded
   assertion elsewhere would, but for a constant that is only meant to move
   on a deliberate, reviewed change. */

describe("lib/paginate", () => {
  /* Not pinned to a number. It was pinned at 50, which turned a sizing
     decision into a test failure when the size was wrong -- fifty was fine
     for a table and ten thousand pixels of cards on a phone. What is worth
     asserting is that it is a sane positive integer. */
  it("holds a sane page size", () => {
    expect(Number.isInteger(PAGE_SIZE)).toBe(true);
    expect(PAGE_SIZE).toBeGreaterThanOrEqual(10);
    expect(PAGE_SIZE).toBeLessThanOrEqual(100);
  });

  it("slices a page's worth of rows, in order, with no overlap between pages", () => {
    const rows = Array.from({ length: 120 }, (_, i) => i);
    expect(paginate(rows, 1)).toEqual(Array.from({ length: PAGE_SIZE }, (_, i) => i));
    expect(paginate(rows, 2)).toEqual(Array.from({ length: PAGE_SIZE }, (_, i) => i + PAGE_SIZE));
    // the tail page holds whatever is left, in order
    const tail = paginate(rows, Math.ceil(120 / PAGE_SIZE));
    expect(tail[0]).toBe(Math.floor((120 - 1) / PAGE_SIZE) * PAGE_SIZE);
    expect(tail[tail.length - 1]).toBe(119);
  });

  it("returns an empty page past the end, rather than throwing", () => {
    const rows = Array.from({ length: 3 }, (_, i) => i);
    expect(paginate(rows, 5)).toEqual([]);
  });

  it("computes a total page count that always holds at least one page, even for an empty set", () => {
    expect(totalPagesFor(0)).toBe(1);
    expect(totalPagesFor(1)).toBe(1);
    expect(totalPagesFor(PAGE_SIZE)).toBe(1);
    expect(totalPagesFor(PAGE_SIZE + 1)).toBe(2);
    expect(totalPagesFor(2539)).toBe(Math.ceil(2539 / PAGE_SIZE));
  });

  it("clamps a requested page into [1, totalPages], so a stale ?page= cannot ask for a page that does not exist", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
    expect(clampPage(Number.NaN, 5)).toBe(1);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(99, 5)).toBe(5);
  });
});

describe("lib/board-buckets taxBucketOf", () => {
  it("mirrors worker/src/buckets.ts's own bps ranges exactly", () => {
    expect(taxBucketOf(0)).toBe("0%");
    expect(taxBucketOf(1)).toBe("1%");
    expect(taxBucketOf(100)).toBe("1%");
    expect(taxBucketOf(101)).toBe("2-3%");
    expect(taxBucketOf(300)).toBe("2-3%");
    expect(taxBucketOf(301)).toBe("4-5%");
    expect(taxBucketOf(500)).toBe("4-5%");
    expect(taxBucketOf(501)).toBe("6-10%");
    expect(taxBucketOf(1000)).toBe("6-10%");
  });

  it("returns null for a value outside the documented range or for null/undefined, never guesses a bucket", () => {
    expect(taxBucketOf(1001)).toBeNull();
    expect(taxBucketOf(-1)).toBeNull();
    expect(taxBucketOf(null)).toBeNull();
    expect(taxBucketOf(undefined)).toBeNull();
  });

  it("holds exactly the five published bands, in order", () => {
    expect(TAX_BUCKETS).toEqual(["0%", "1%", "2-3%", "4-5%", "6-10%"]);
  });
});
