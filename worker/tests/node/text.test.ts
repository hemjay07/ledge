import { describe, expect, it } from "vitest";
import { headline, lookupText, numberText, outcomeWord } from "../../src/text";
import { fixtureNumber, makeBody, NOW_SECONDS, LAUNCH } from "./helpers";

const MAX = fixtureNumber().allTime.ttg.max;

/* A percentage must never reach a reader without its n, and no sentence may
   be in the future tense. Both are checked on the rendered string, because the
   rendered string is what a reader actually sees. */

const PERCENT = /(\d[\d,.]*)\s?%/g;

function percentagesWithoutAnN(text: string): string[] {
  const bad: string[] = [];
  for (const line of text.split("\n")) {
    PERCENT.lastIndex = 0;
    if (!PERCENT.test(line)) continue;
    // A tax bucket ("2–3%", "0%") is a configuration label, not a figure.
    const stripped = line.replace(/(?:tax|ETH|Stablecoin|Tokenized stock|Other)[^\n]*/g, "");
    PERCENT.lastIndex = 0;
    if (PERCENT.test(stripped) && !/\bn=|\bof \d|graduations measured/.test(line)) bad.push(line);
  }
  return bad;
}

describe("outcome words", () => {
  it("uses the past tense for a settled outcome", () => {
    const graduated = makeBody({ graduation: { token: "0x", block: 1, ts: NOW_SECONDS - 200 } });
    expect(outcomeWord(graduated, MAX)).toBe("graduated");
  });

  it("says 'died' only past the longest measured time to graduation", () => {
    const old = makeBody({ launch: { ...LAUNCH, ts: NOW_SECONDS - (MAX! + 1) } });
    expect(outcomeWord(old, MAX)).toBe("died");
  });

  it("describes, rather than forecasts, a token still inside that range", () => {
    expect(outcomeWord(makeBody(), MAX)).toBe("on the curve");
  });

  it("does not call an outcome settled with no published range to settle it against", () => {
    const old = makeBody({ launch: { ...LAUNCH, ts: NOW_SECONDS - 99_999 } });
    expect(outcomeWord(old, null)).toBe("on the curve");
  });
});

describe("the headline", () => {
  it("reads as the death card copy the architecture specifies", () => {
    const line = headline(makeBody(), MAX);
    expect(line).toMatch(/^minute 13 · on the curve · cohort /);
    expect(line).toContain("ETH");
    expect(line).toContain("2–3%");
  });

  it("prints the cohort's n beside its percentage", () => {
    expect(headline(makeBody(), MAX)).toMatch(/cohort \d+\.\d+% \(n=[\d,]+\)/);
  });

  it("prints 'not enough data' rather than a percentage for a short cohort", () => {
    const file = fixtureNumber();
    for (const w of [file.h24, file.allTime]) {
      w.cohorts.pairTax = w.cohorts.pairTax!.map((r) => ({
        ...r,
        launches: 12,
        rate: null,
        insufficient: true,
        excludingFast: { ...r.excludingFast, rate: null, oneIn: null, insufficient: true },
      }));
    }
    const line = headline(makeBody({ numberFile: file }), MAX);
    expect(line).toContain("not enough data (n=12)");
    expect(line).not.toMatch(/cohort \d+\.\d+%/);
  });
});

describe("the lookup text", () => {
  const text = lookupText(makeBody(), MAX);

  it("states the cohort with both its numerator and its denominator", () => {
    expect(text).toMatch(/\d[\d,]* of \d[\d,]* graduated/);
  });

  it("names the cutoff as a description, never as a verdict", () => {
    expect(text).toContain("Excluding launches that graduated inside 5 min");
  });

  it("places the launch from the published table without deriving a share", () => {
    const ladder = fixtureNumber().allTime.ttg.ladder!;
    const rung = ladder.filter((s) => s.atSeconds <= 811).pop()!;
    expect(text).toContain(`${(rung.cumulativeShare! * 100).toFixed(1)}%`);
    expect(text).toContain("had already happened");
  });

  it("says the fill is not available rather than printing a zero", () => {
    expect(text).toContain("Curve fill: fill not available.");
    expect(text).not.toContain("Curve fill: 0");
  });

  it("prints no percentage anywhere without an n beside it", () => {
    expect(percentagesWithoutAnN(text)).toEqual([]);
  });

  it("carries the measurement stamp and the method link", () => {
    expect(text).toContain("Measured 6 Sep 2026");
    expect(text).toContain("https://ledge.tools/method");
  });

  it("says plainly when a launch is outside the retention window", () => {
    const t = lookupText(makeBody({ launch: null }), MAX);
    expect(t).toContain("Launched more than 7 days ago");
    expect(t).toContain("not placed on the table of graduation times");
  });

  /* A placement can be absent for two unrelated reasons, and the sentence has
     to name the right one. Saying "the launch time is not indexed" about a
     token whose launch time IS indexed is a small lie a reader can catch. */
  it("blames the missing launch time when that is what is missing", () => {
    const t = lookupText(makeBody({ launch: null }), MAX);
    expect(t).toContain("The launch time is not indexed, so this launch is not placed");
    expect(t).not.toContain("not loadable");
  });

  it("blames the unloadable table when the launch time is known", () => {
    const t = lookupText(makeBody({ numberFile: null }), null);
    expect(t).toContain("The published table of graduation times is not loadable");
    expect(t).not.toContain("The launch time is not indexed");
  });

  it("says plainly when no cohort has been published", () => {
    const t = lookupText(makeBody({ numberFile: null }), null);
    expect(t).toContain("No cohort has been published for this configuration.");
    expect(percentagesWithoutAnN(t)).toEqual([]);
  });

  it("declares a stale live layer rather than filling the gap", () => {
    const t = lookupText(
      makeBody({ cursor: { last_indexed_block: 1, last_success_at: NOW_SECONDS - 900, consecutive_failures: 3 } }),
      MAX,
    );
    expect(t).toContain("Nothing below it is being estimated.");
  });
});

describe("the /number reply", () => {
  const file = fixtureNumber();
  const text = numberText(file.h24, file.crawledAt, "12 min", "https://ledge.tools/method");

  it("prints both figures with their denominator, the window and the age", () => {
    expect(text).toContain("last 24 hours");
    expect(text).toMatch(/\d[\d,]* of \d[\d,]* launches graduated/);
    expect(text).toContain("12 min ago");
  });

  it("prints no percentage without an n", () => {
    expect(percentagesWithoutAnN(text)).toEqual([]);
  });

  it("drops the rate entirely when the window is short", () => {
    const short = { ...file.h24, launches: 12, rate: null, insufficient: true,
      excludingFast: { ...file.h24.excludingFast, rate: null, oneIn: null, insufficient: true } };
    const t = numberText(short, file.crawledAt, "3 min", "https://ledge.tools/method");
    expect(t).toContain("not enough data (n=12)");
    expect(t).not.toMatch(/\d\.\d%/);
  });
});
