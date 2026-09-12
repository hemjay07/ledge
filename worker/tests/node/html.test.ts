import { describe, expect, it } from "vitest";
import { tokenShell } from "../../src/html";
import { lookupText } from "../../src/text";
import { ACTIVITY, ADDRESS, fixtureNumber, makeBody, NOW_SECONDS } from "./helpers";

const MAX = fixtureNumber().allTime.ttg.max;
const SITE = "https://ledge.tools";

function render(overrides: Parameters<typeof makeBody>[0] = {}) {
  const body = makeBody(overrides);
  const text = lookupText(body, MAX);
  return tokenShell(body, text, "test title", SITE, MAX);
}

/* REVAMP.md 1.1: "distinct buyers in the launch's own block" is the most
   prominent reading on the page, and null / 0 are kept apart on purpose --
   null is "that block was never indexed", 0 is "it was indexed and nobody
   bought", a finding rather than a gap. This is the load-bearing assertion
   the task calls out by name. */
describe("distinct first-block buyers: null vs zero render differently", () => {
  it("renders a dash and 'not indexed' when there is no activity row at all", () => {
    const html = render({ activity: undefined });
    expect(html).toContain("No curve activity indexed for this token.");
    expect(html).not.toContain(">0<");
  });

  it("renders a dash and 'not indexed' when the launch block itself was not indexed", () => {
    const html = render({ activity: { ...ACTIVITY, first_block_buyers: null } });
    expect(html).toContain("That block was not indexed.");
  });

  it("renders the figure 0 with a finding, not a gap, when the block was indexed and nobody bought", () => {
    const html = render({ activity: { ...ACTIVITY, first_block_buyers: 0 } });
    expect(html).toMatch(/<div class="fig">0<\/div>/);
    expect(html).toContain("Block indexed. Nobody bought in it.");
    expect(html).not.toContain("not indexed");
  });

  it("renders the true positive count when buyers were seen", () => {
    const html = render({ activity: ACTIVITY });
    expect(html).toMatch(/<div class="fig">7<\/div>/);
    expect(html).toContain("Bought in the block the token launched in.");
  });

  it("the three states (absent, null block, zero, positive) are mutually distinguishable strings", () => {
    const absent = render({ activity: undefined });
    const nullBlock = render({ activity: { ...ACTIVITY, first_block_buyers: null } });
    const zero = render({ activity: { ...ACTIVITY, first_block_buyers: 0 } });
    const positive = render({ activity: ACTIVITY });
    const renders = [absent, nullBlock, zero, positive];
    expect(new Set(renders).size).toBe(renders.length);
  });
});

/* CONSTRAINTS 1: the page states this token's own facts and never a
   conclusion. No score, grade, badge, verdict or probability, and no sentence
   telling the reader what to do -- on the fact cards this task adds, not only
   on the sentences from lookupText that were already covered elsewhere. */
describe("no verdict vocabulary reaches the fact cards", () => {
  const VERDICT = /\b(score|grade|rating|badge|guaranteed|risk[- ]?free|sure thing|safe|rug|odds|chance|likely|will (pump|moon|graduate|succeed|fail))\b/i;

  it("a token with activity, graduated, carries no verdict word", () => {
    const html = render({
      activity: ACTIVITY,
      graduation: { token: ADDRESS, block: 1, ts: NOW_SECONDS - 200 },
    });
    expect(html).not.toMatch(VERDICT);
  });

  it("a token with no activity carries no verdict word", () => {
    const html = render({ activity: undefined });
    expect(html).not.toMatch(VERDICT);
  });

  it("a token with an insufficient cohort carries no verdict word", () => {
    const html = render({ numberFile: null });
    expect(html).not.toMatch(VERDICT);
  });
});

describe("the fill card never prints a lone percentage", () => {
  it("a percentage, when shown, always sits beside both quantities", () => {
    const html = render({ activity: ACTIVITY });
    const fillCardMatch = html.match(/<div class="k">Curve fill<\/div>([\s\S]*?)<\/section>/);
    expect(fillCardMatch).not.toBeNull();
    const card = fillCardMatch![1] as string;
    const pct = card.match(/(\d[\d.]*)%/);
    if (pct) {
      expect(card).toMatch(/of\s/);
    }
  });
});

describe("every figure carries its window or its age", () => {
  it("the activity card names the window label verbatim", () => {
    const body = makeBody({ activity: ACTIVITY });
    const html = render({ activity: ACTIVITY });
    expect(html).toContain(body.activity!.window.label);
  });

  it("a stale cohort reading is called out on the page", () => {
    const html = render({
      cursor: { last_indexed_block: 1, last_success_at: NOW_SECONDS - 10, consecutive_failures: 0 },
      numberFile: {
        ...fixtureNumber(),
        crawledAt: new Date((NOW_SECONDS - 999999) * 1000).toISOString(),
      },
    });
    expect(html).toContain("stale-banner");
  });
});

describe("the shell keeps the readable long form", () => {
  it("still prints the full lookupText output, unchanged, below the facts", () => {
    const body = makeBody({ activity: ACTIVITY });
    const text = lookupText(body, MAX);
    const html = tokenShell(body, text, "test title", SITE, MAX);
    for (const line of text.split("\n")) {
      expect(html).toContain(line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
    }
  });
});

describe("no wallet or deployer address as a subject", () => {
  it("the only addresses printed are the token's own address and its pair", () => {
    const html = render({ activity: ACTIVITY });
    // ADDRESS and the fixture's pair token (zero address) are permitted.
    // No other 0x... address should appear anywhere on the page.
    const found = new Set((html.match(/0x[0-9a-fA-F]{40}/g) ?? []).map((a) => a.toLowerCase()));
    for (const addr of found) {
      expect([ADDRESS.toLowerCase(), "0x0000000000000000000000000000000000000000"]).toContain(addr);
    }
  });
});

describe("phone-width layout", () => {
  it("the page has no fixed width wider than a phone viewport", () => {
    const html = render({ activity: ACTIVITY });
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1"');
    expect(html).not.toMatch(/width:\s*\d{3,}px/);
  });
});

/* The token's own name/symbol (2026-09-12, worker/schema.sql's `token_meta`
   cache) is untrusted, on-chain, attacker-controlled text -- read straight
   off the token's own contract, never written by LEDGE. It must be
   HTML-escaped like everything else this file prints, and it must never be
   confused with the address as the page's identity. */
describe("the token's own name/symbol: untrusted on-chain text", () => {
  it("HTML-escapes a name containing <script>, so it never executes", () => {
    const html = render({ tokenMeta: { name: "<script>alert(1)</script>", symbol: "EVIL" } });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("HTML-escapes the symbol the same way", () => {
    const html = render({ tokenMeta: { name: "Fine Name", symbol: '"><img src=x onerror=alert(1)>' } });
    expect(html).not.toContain('"><img src=x onerror=alert(1)>');
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  });

  /* An emoji in a token name is on-chain data a real ERC-20 deployer can and
     does put in symbol()/name() -- this project's "no emoji in code" lint
     rule (scripts/lint-worker.sh and CLAUDE.md's own conventions) governs
     code LEDGE's own authors write, not third-party on-chain content being
     displayed back. It is rendered as plain, escaped text like any other
     name -- never stripped, never treated as a formatting instruction. */
  it("renders an emoji in a token name as plain text, not stripped or specially treated", () => {
    const html = render({ tokenMeta: { name: "Pons \u{1F680} Coin", symbol: "PONS" } });
    expect(html).toContain("Pons \u{1F680} Coin");
  });

  it("shows SYMBOL · Name above the address when both are present", () => {
    const html = render({ tokenMeta: { name: "Pons Coin", symbol: "PONS" } });
    expect(html).toMatch(/<p class="token-identity-line">PONS · Pons Coin<\/p>/);
  });

  it("shows only the symbol when the name is absent", () => {
    const html = render({ tokenMeta: { name: null, symbol: "PONS" } });
    expect(html).toMatch(/<p class="token-identity-line">PONS<\/p>/);
  });

  it("shows nothing extra when neither is present -- the address alone still appears", () => {
    const html = render({ tokenMeta: null });
    expect(html).not.toMatch(/<p class="token-identity-line">/);
    expect(html).toContain(ADDRESS);
  });

  it("the address is always printed, never replaced by the name/symbol", () => {
    const html = render({ tokenMeta: { name: "Pons Coin", symbol: "PONS" } });
    expect(html).toContain(ADDRESS);
  });

  it("prepends the symbol to the <title> when present", () => {
    const html = render({ tokenMeta: { name: "Pons Coin", symbol: "PONS" } });
    const titleMatch = html.match(/<title>([^<]*)<\/title>/);
    expect(titleMatch?.[1]?.startsWith("PONS · ")).toBe(true);
  });
});
