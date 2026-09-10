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

/* Sliced by id, not by folio number: the folios were removed from this page on
   2026-09-10 when it stopped being a broadsheet, and a marker keyed to one
   would break for a reason that has nothing to do with the copy. */
const CAPABILITY = copyOf('<div className="capability">', "</div>");
const WHAT_THIS_IS = copyOf('<LedgerEntry id="h-what"', "</LedgerEntry>");
const MORE_COHORTS = copyOf('<LedgerEntry id="h-cohorts"', "</LedgerEntry>");

/* The pair-token finding was WITHDRAWN from this page on 2026-09-10, not
   moved. It said the pair token makes no difference once fast graduations are
   excluded. On the record today ETH and stablecoin still match, at 0.82% and
   0.81%, and tokenized stock runs at 0.47% over 58,106 launches. A claim that
   has stopped being true is withdrawn rather than relocated, and the reversal
   is published in METHOD.md's changelog because CONSTRAINTS 5 requires a
   reversal to be published rather than edited away. */

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

/* The visual pass of 2026-09-10 cut the ~150-word "What this is" entry to one
   line linking to /method: a trader does not care what we refuse to do, and
   naming our own constraints back at the reader was exactly the essay this
   pass exists to remove. The assertions that pinned the withdrawn copy's own
   wording (what it said it measures, the never-list phrasing, the gap
   sentence) are removed with it -- that copy no longer exists to check. The
   assertions that guard a CONSTRAINT rather than a sentence (banned words,
   no emoji, no-verdict) carry forward unchanged onto the one line that
   replaced it. */
describe("the What this is entry", () => {
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

describe("the sheet, without folio numbers", () => {
  /* The folios went with the broadsheet on 2026-09-10. They numbered a
     register a reader was expected to work through in order, and this page is
     no longer that. The check is inverted rather than dropped: none may come
     back without this failing. */
  it("carries no folio number anywhere on the page", () => {
    expect([...PAGE.matchAll(/folio="(\d{2})"/g)].map((m) => m[1])).toEqual([]);
  });

  /* The lookup moved above the proof on 2026-09-11. Pasting an address is the
     only decision this page offers, and it was sitting under a heading halfway
     down, beneath the chart and the paths. The action now comes before the
     argument for it. */
  it("runs the pulse, the capability, the lookup, then the proof, the paths and the rate", () => {
    const order = [
      "<LivePulse",
      'className="capability"',
      'className="lookup-lead"',
      'className="shape-lead"',
      'className="paths-on"',
      'className="headline-rate"',
    ].map((marker) => PAGE.indexOf(marker));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  /* The entries this page stopped reprinting. They are in full on the pages
     named beside them, and the sheet links to those rather than duplicating
     them, which is what made it scroll. */
  it("no longer reprints the fold, the pair register, the distribution or the board", () => {
    for (const marker of ["<Fold", "id=\"h-pair\"", "id=\"h-ttg\"", "<LiveBoard"]) {
      expect(PAGE.includes(marker), `${marker} is still reprinted on the sheet`).toBe(false);
    }
    for (const href of ["/number", "/cohorts", "/live", "/graduated", "/graveyard", "/method"]) {
      expect(PAGE.includes(href), `${href} is not linked`).toBe(true);
    }
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

describe("the withdrawn pair finding, and what is left in its place", () => {
  /* The assertions that pinned the old claim are gone with the claim. What
     replaces them is the guarantee that it cannot come back silently: the
     sentence must not be on the page, and the page must still point a reader
     at the cohorts it was drawn from. */
  it("no longer states that the pair token makes no difference", () => {
    expect(PAGE).not.toContain("the pair token makes no");
  });

  it("still points at the page that holds the pair cohorts", () => {
    expect(MORE_COHORTS).toContain("Creator tax, hour of day, day of week");
    expect(MORE_COHORTS).toContain("launches per deployer");
    expect(MORE_COHORTS).toContain("all-time");
    expect(MORE_COHORTS.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length)
      .toBeLessThanOrEqual(30);
  });

  it("passes the banned-words list", () => {
    const lower = MORE_COHORTS.toLowerCase();
    for (const banned of BANNED) {
      expect(lower.includes(banned), `"${banned}" is on the page`).toBe(false);
    }
  });
});
