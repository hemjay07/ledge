import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cardText, cardTree } from "../scripts/og.mjs";
import { insufficientRaw, raw } from "./fixtures";
import { formatRate } from "../lib/format";

const AT_CRAWL = Date.parse(raw.crawledAt);

/* The card is the copy of the number that travels furthest from the page: it
   is pasted into a chat by someone who will never open the site. It may not
   invent a figure the sheet would refuse to print. */
describe("the share card", () => {
  it("prints no percentage anywhere for an insufficient measurement", () => {
    const text = cardText(cardTree(insufficientRaw(), AT_CRAWL)).join(" | ");
    expect(text).not.toContain("%");
    expect(text).toContain("not enough data (n=12)");
  });

  it("does not round a null rate down to 0.00%", () => {
    const text = cardText(cardTree(insufficientRaw(), AT_CRAWL)).join(" | ");
    expect(text).not.toContain("0.00");
  });

  it("drops the 1-in-N restatement when the pipeline wrote no N", () => {
    const text = cardText(cardTree(insufficientRaw(), AT_CRAWL)).join(" | ");
    expect(text).toContain("excluding under 5 min");
    expect(text).not.toContain("1 in");
  });

  it("keeps the counts and the denominator on the card regardless", () => {
    const text = cardText(cardTree(insufficientRaw(), AT_CRAWL)).join(" | ");
    expect(text).toContain("of 12 launches in the last 24 hours graduated");
    expect(text).toContain("n = 12 · 0 graduations · updated");
  });

  it("prints both figures when the sample supports them", () => {
    // Derived from the live file so the test follows the data, never a
    // hardcoded figure that goes stale with every crawl.
    const h = raw.h24;
    const text = cardText(cardTree(raw, AT_CRAWL)).join(" | ");
    expect(h.rate).not.toBeNull();
    expect(text).toContain(formatRate(h.rate as number, h.launches));
    expect(text).toContain(formatRate(h.excludingFast.rate as number, h.launches));
    expect(text).toContain(`1 in ${h.excludingFast.oneIn}`);
    expect(text).toMatch(/MEASURED \d{1,2} [A-Z]{3} \d{4} · \d{2}:\d{2} UTC/);
  });

  it("renders a PNG from an insufficient measurement rather than throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledge-og-"));
    const fixture = join(dir, "number.json");
    const out = join(dir, "number.png");
    writeFileSync(fixture, JSON.stringify(insufficientRaw()));

    execFileSync(process.execPath, [join(process.cwd(), "scripts", "og.mjs")], {
      env: { ...process.env, LEDGE_NUMBER_JSON: fixture, LEDGE_OG_OUT: out },
      cwd: process.cwd(),
    });

    const png = readFileSync(out);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  }, 30_000);
});
