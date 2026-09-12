import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* The prose on / is the part of this build a type checker cannot hold to
   CONSTRAINTS. So the copy is read out of the page source and checked here:
   the NOT-THIS list, the words that would turn a measurement into a verdict,
   and the length. */

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

/* 2026-09-12 (REVAMP.md "the homepage direction"): the sheet's ledger
   entries -- `<div className="capability">`, `<LedgerEntry id="h-what">`,
   `<LedgerEntry id="h-cohorts">` -- were replaced outright by the build the
   three mockups decided: a hook (kicker, h1, one dek line) and a single
   "where the rest is" line carrying the links those entries used to hold.
   The copy markers below are read off the new blocks; the constraint checks
   that ran against the old ones (banned words, no emoji, word caps,
   no-verdict) run against the new ones unchanged. */
const HOOK_DEK = copyOf('<p className="dek home-dek">', "</p>");
const HOME_REST = copyOf('<p className="note home-rest">', "</p>");
const FINDING_ITALIC = copyOf("<em>Two populations", "</em>");

/* The pair-token finding was WITHDRAWN from this page on 2026-09-10, not
   moved. It said the pair token makes no difference once fast graduations are
   excluded. On the record today ETH and stablecoin still match, at 0.82% and
   0.81%, and tokenized stock runs at 0.47% over 58,106 launches. A claim that
   has stopped being true is withdrawn rather than relocated, and the reversal
   is published in METHOD.md's changelog because CONSTRAINTS 5 requires a
   reversal to be published rather than edited away. */

/* CONSTRAINTS.md's NOT-THIS list, plus the verdict vocabulary a lookup page is
   the likeliest surface to acquire. Deliberately excludes "buy"/"sell": those
   are factual descriptions of on-chain activity used throughout the site
   (Live.tsx's own "Buys"/"Sells" columns, "taking buys"), not a verdict. */
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
  "ape",
];

/* CONSTRAINTS 6: the FINDING card's italic caption describes the shape
   without implying which population is which. */
const FINDING_BANNED = ["rigged", "fake", "organic", "real", "self-fill", "suspicious", "bot"];

/* The visual pass of 2026-09-10 cut the ~150-word "What this is" entry to one
   line linking to /method; REVAMP.md's 2026-09-12 rebuild replaced that one
   line with the hook's own dek, which says what LEDGE does rather than what
   it refuses to do. The assertions that guard a CONSTRAINT rather than a
   sentence (banned words, no emoji, no-verdict) carry forward unchanged onto
   whichever line currently carries that job. */
describe("the hook's dek", () => {
  it("passes the banned-words list", () => {
    const lower = HOOK_DEK.toLowerCase();
    for (const banned of BANNED) {
      expect(lower.includes(banned), `"${banned}" is on the page`).toBe(false);
    }
  });

  it("carries no emoji", () => {
    expect(HOOK_DEK).not.toMatch(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u,
    );
  });

  /* REVAMP.md: "One short Newsreader line under it, max 25 words". */
  it("runs to 25 words or fewer", () => {
    const words = HOOK_DEK.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
    expect(words.length).toBeLessThanOrEqual(25);
  });

  it("tells no reader what to do with a number", () => {
    expect(HOOK_DEK.toLowerCase()).not.toMatch(/\byou should\b|\bstart\b|\btry\b|\bget\b/);
  });

  it("says what LEDGE does: indexes every launch, hourly, and times every graduation", () => {
    expect(HOOK_DEK).toMatch(/factory contract/i);
    expect(HOOK_DEK).toMatch(/hourly/i);
    expect(HOOK_DEK).toMatch(/graduation/i);
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

  /* 2026-09-12 (REVAMP.md "the homepage direction"): this pinned the 2026-09
     front door's own order -- the live pulse, the capability line, the
     shape, the paths, then the Number's fold. That layout was replaced
     outright by the build decided across the three mockups: the LIVE card,
     the hook, the four-row table, the callout, the FINDING card, the NOW
     card, then the three doors. Rewritten to the new order and the new
     markers; nothing here is loosened, only retargeted. */
  it("runs the LIVE card, the hook, the table, the callout, the finding, the now card, then the doors", () => {
    const order = [
      "<HomeLiveCard",
      'className="home-hook"',
      'className="home-table"',
      'className="home-callout"',
      'className="home-finding"',
      "home-door-1",
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
    for (const href of [
      "/number",
      "/cohorts",
      "/cockpit",
      "/live",
      "/graduated",
      "/graveyard",
      "/method",
    ]) {
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

  /* 2026-09-12: the pointer moved from the "#h-cohorts" LedgerEntry to the
     "where the rest is" line the homepage rebuild replaced it with. */
  it("still points at the page that holds the pair cohorts", () => {
    expect(HOME_REST).toMatch(/cohorts/i);
    expect(PAGE).toContain('href="/cohorts"');
  });

  it("passes the banned-words list", () => {
    const lower = HOME_REST.toLowerCase();
    for (const banned of BANNED) {
      expect(lower.includes(banned), `"${banned}" is on the page`).toBe(false);
    }
  });
});

/* The FINDING card's italic caption (REVAMP.md 2026-09-12, item 5): it
   describes the shape of the record -- two populations, a spike, a trough, a
   broad hump -- without a word implying fake, rigged, bot or organic
   (CONSTRAINTS 6). */
describe("the FINDING card's caption", () => {
  it("names the shape without labelling a bucket", () => {
    const lower = FINDING_ITALIC.toLowerCase();
    for (const banned of FINDING_BANNED) {
      expect(lower.includes(banned), `"${banned}" is in the finding caption`).toBe(false);
    }
  });
});
