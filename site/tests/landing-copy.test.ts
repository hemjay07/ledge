import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* The three new entries on / are prose, and prose is the part of this build a
   type checker cannot hold to CONSTRAINTS. So the copy is read out of the page
   source and checked here: the NOT-THIS list, the words that would turn a
   measurement into a verdict, and the length. */

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(HERE, "..", "app", "page.tsx"), "utf8");

/** The text nodes of one JSX entry, with tags, expressions and attributes
    removed — what a reader actually sees. */
function copyOf(startMarker: string, endMarker: string): string {
  const from = PAGE.indexOf(startMarker);
  const to = PAGE.indexOf(endMarker, from);
  if (from < 0 || to < 0) throw new Error(`the entry starting "${startMarker}" is not on the page`);
  return PAGE.slice(from, to)
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const WHAT_THIS_IS = copyOf('<LedgerEntry folio="06"', "</LedgerEntry>");
const PAIR_FINDING = copyOf('<LedgerEntry\n          folio="03"', "<Register");
const MORE_COHORTS = copyOf('<LedgerEntry folio="07"', "</LedgerEntry>");

/* CONSTRAINTS.md's NOT-THIS list, plus the verdict vocabulary a lookup page is
   the likeliest surface to acquire. */
const BANNED = [
  "trade smarter",
  "know before you ape",
  "data-driven",
  "alpha",
  "signal",
  "we believe",
  "our mission",
  "in today's",
  "fast-moving",
  "dyor",
  "not financial advice",
  "premium",
  "coming soon",
  "waitlist",
  "subscribe",
  "connect wallet",
  "score",
  "risk",
  "safe",
  "rug",
  "likely",
  "predict",
  "odds",
  "chance",
  "buy",
  "sell",
  "ape",
];

describe("the What this is entry", () => {
  it("says what LEDGE measures and how it measures it", () => {
    expect(WHAT_THIS_IS).toContain("reads the Pons factory contract every hour");
    expect(WHAT_THIS_IS).toContain("counts how many graduated");
    expect(WHAT_THIS_IS).toContain("the number of launches it was counted from");
  });

  it("states the never-list, three items, plainly", () => {
    expect(WHAT_THIS_IS).toContain("never rank a token");
    expect(WHAT_THIS_IS).toContain("never name a wallet");
    expect(WHAT_THIS_IS).toContain("never print a rate without its denominator");
  });

  it("states the gap as a fact, not as a claim about LEDGE", () => {
    expect(WHAT_THIS_IS).toContain(
      "No public tool publishes the graduation rate of launches by configuration; this does.",
    );
  });

  it("passes the banned-words list", () => {
    const lower = WHAT_THIS_IS.toLowerCase();
    for (const banned of BANNED) {
      expect(lower.includes(banned), `"${banned}" is on the page`).toBe(false);
    }
  });

  it("carries no emoji", () => {
    expect(WHAT_THIS_IS).not.toMatch(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u,
    );
  });

  it("runs to 120 words or fewer", () => {
    const words = WHAT_THIS_IS.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
    expect(words.length).toBeLessThanOrEqual(120);
  });

  it("tells no reader what to do with a number", () => {
    expect(WHAT_THIS_IS.toLowerCase()).not.toMatch(/\byou should\b|\bstart\b|\btry\b|\bget\b/);
  });
});

describe("the register, renumbered", () => {
  it("runs the folios in order with no gap and no repeat", () => {
    const folios = [...PAGE.matchAll(/folio="(\d{2})"/g)].map((m) => m[1]);
    expect(folios).toEqual(["02", "03", "04", "05", "06", "07"]);
  });

  it("runs lookup, the pair finding, the distribution, the board, the explanation, the index", () => {
    const order = ["h-lookup", "h-pair", "h-ttg", "<LiveBoard", "h-what", "h-cohorts"].map((id) =>
      PAGE.indexOf(id),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThan(PAGE.indexOf("end of fold"));
  });

  /* the entries the sheet no longer carries: they are on /cohorts in full,
     and the sheet links to them rather than reprinting them */
  it("carries neither the tax, the hour, the deployer nor the all-time entry", () => {
    for (const id of ["h-tax", "h-hour", "h-dep", "h-all", "h-fast"]) {
      expect(PAGE.includes(`id="${id}"`), `${id} is still on the sheet`).toBe(false);
      expect(PAGE.includes(`headingId="${id}"`), `${id} is still on the sheet`).toBe(false);
    }
  });
});

describe("the two moved findings", () => {
  it("states the pair finding as two counts over one window", () => {
    expect(PAIR_FINDING).toContain("Launches paired with a stablecoin graduated at");
    expect(PAIR_FINDING).toContain("paired with ETH");
    expect(PAIR_FINDING).toContain("Two counts over the same window, not a cause.");
  });

  it("names what the cohorts page holds, in one line", () => {
    expect(MORE_COHORTS).toContain("Creator tax, hour of day, day of week");
    expect(MORE_COHORTS).toContain("launches per deployer");
    expect(MORE_COHORTS).toContain("all-time");
    expect(MORE_COHORTS.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length)
      .toBeLessThanOrEqual(30);
  });

  it("passes the banned-words list", () => {
    for (const copy of [PAIR_FINDING, MORE_COHORTS]) {
      const lower = copy.toLowerCase();
      for (const banned of BANNED) {
        expect(lower.includes(banned), `"${banned}" is on the page`).toBe(false);
      }
    }
  });
});
