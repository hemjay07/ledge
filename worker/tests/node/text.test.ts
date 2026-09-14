import { describe, expect, it } from "vitest";
import { activitySentences, headline, lookupText, numberText, outcomeWord } from "../../src/text";
import { formatDuration } from "../../src/format";
import { ACTIVITY, fixtureNumber, makeBody, NOW_SECONDS, LAUNCH } from "./helpers";

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
    // A tax bucket ("2–3%", "0%") is a configuration label, not a figure;
    // since 2026-09-14 it is printed as "2–3% creator tax", so the label
    // is stripped from either side of the word.
    const stripped = line.replace(/(?:tax|ETH|Stablecoin|Tokenized stock|Other)[^\n]*/g, "").replace(/\d+(?:–\d+)?% creator tax/g, "");
    PERCENT.lastIndex = 0;
    if (PERCENT.test(stripped) && !/\bn=|\bof \d|graduations measured/.test(line)) bad.push(line);
  }
  return bad;
}

describe("outcome words", () => {
  it("uses the past tense for a settled outcome, and says how long it took", () => {
    const graduated = makeBody({ graduation: { token: "0x", block: 1, ts: NOW_SECONDS - 200 } });
    const word = outcomeWord(graduated, MAX);
    expect(word).toMatch(/^graduated in /);
    expect(word).toContain(formatDuration(graduated.state.timeToGraduationSeconds!));
  });

  /* The duration is the only thing separating a curve that filled in seconds
     from one that took hours, and "graduated" alone says the same word for
     both. Pinned at the fast end because that is the end the figure exists to
     make visible: 15.0% of the 2,382 graduations with a launch on record
     finished inside 10 seconds, measured 2026-09-10. */
  it("prints a fast graduation as the seconds it actually took", () => {
    const fast = makeBody({
      launch: { ...LAUNCH, ts: NOW_SECONDS - 8 },
      graduation: { token: "0x", block: 1, ts: NOW_SECONDS },
    });
    expect(outcomeWord(fast, MAX)).toBe("graduated in 8 s");
  });

  /* Graduated, but the launch predates the indexed record, so there is no
     difference to take. It must not invent one. */
  it("says only 'graduated' when there is no launch to measure from", () => {
    const noLaunch = makeBody({
      launch: null,
      graduation: { token: "0x", block: 1, ts: NOW_SECONDS },
    });
    expect(noLaunch.state.timeToGraduationSeconds).toBeNull();
    expect(outcomeWord(noLaunch, MAX)).toBe("graduated");
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
    expect(text).toMatch(/graduated \(\d[\d,]* of \d[\d,]*\)/);
  });

  it("names the cutoff as a description, never as a verdict", () => {
    expect(text).toContain("leaving out graduations under 5 min");
  });

  it("places the launch from the published table without deriving a share", () => {
    const ladder = fixtureNumber().allTime.ttg.ladder!;
    const rung = ladder.filter((s) => s.atSeconds <= 811).pop()!;
    expect(text).toContain(`${(rung.cumulativeShare! * 100).toFixed(1)}%`);
    expect(text).toContain("of graduations were done within");
  });

  it("says the fill is not available rather than printing a zero", () => {
    expect(text).toContain("Curve fill: fill not available.");
    expect(text).not.toContain("Curve fill: 0");
  });

  it("prints no percentage anywhere without an n beside it", () => {
    expect(percentagesWithoutAnN(text)).toEqual([]);
  });

  it("carries the measurement stamp and the method link", () => {
    expect(text).toContain("Measured 7 Nov 2025");
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
    expect(t).toContain("No figures are published for launches like this one.");
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

/* B3 — the freshness bound, computed at render.

   number.json carries `staleAfterSeconds` (7,200) and METHOD.md ("Freshness")
   is explicit that the age is the consumer's computation: "Any consumer -- the
   page, the card, a third party reading /number.json -- computes now − crawledAt
   and compares it to the published staleAfterSeconds". Nothing read that field.
   A nine-day-old file rendered exactly like a fresh one, and a cohort figure
   measured nine days ago was stated as if it were measured now. */

const STALE_BOUND = fixtureNumber().staleAfterSeconds;
const FRESHNESS_NOTE_PATTERN = /measured .+ ago — older than the 2 h freshness bound/;

/** The frozen file, aged: only the moment it was crawled moves. */
function agedNumber(secondsOld: number) {
  const file = fixtureNumber();
  file.crawledAt = new Date((NOW_SECONDS - secondsOld) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return file;
}

describe("a measurement older than the published bound", () => {
  const nineDays = lookupText(makeBody({ numberFile: agedNumber(9 * 86_400) }), MAX);

  it("says so on every cohort sentence", () => {
    const cohortLines = nineDays.split("\n").filter((l) => /graduated \(/.test(l));
    expect(cohortLines.length).toBeGreaterThan(0);
    for (const line of cohortLines) {
      expect(line).toMatch(FRESHNESS_NOTE_PATTERN);
      expect(line).toContain("measured 9 d ago");
    }
  });

  it("says so on the placement sentence", () => {
    const placement = nineDays.split("\n").find((l) => l.includes("of graduations were done within"))!;
    expect(placement).toMatch(FRESHNESS_NOTE_PATTERN);
  });

  it("names the bound the file itself published, never a hard-coded one", () => {
    expect(STALE_BOUND).toBe(7200);
    expect(nineDays).toContain("older than the 2 h freshness bound");
  });

  it("prints no percentage anywhere without an n, aged or not", () => {
    expect(percentagesWithoutAnN(nineDays)).toEqual([]);
  });
});

describe("the bound itself, from both sides", () => {
  it("is fresh one second inside it", () => {
    const text = lookupText(makeBody({ numberFile: agedNumber(STALE_BOUND - 1) }), MAX);
    expect(text).not.toMatch(FRESHNESS_NOTE_PATTERN);
    expect(text).not.toContain("freshness bound");
  });

  it("is stale exactly on it", () => {
    const text = lookupText(makeBody({ numberFile: agedNumber(STALE_BOUND) }), MAX);
    expect(text).toMatch(FRESHNESS_NOTE_PATTERN);
  });

  it("leaves a recently measured file unmarked", () => {
    expect(lookupText(makeBody(), MAX)).not.toContain("freshness bound");
  });
});

/* REPOSITION.md Phase B: /t/{address} states this token's own facts -- its
   buys, its sells, its distinct buyers in its own launch block -- with no
   conclusion drawn from them. */
describe("activity facts", () => {
  it("is absent entirely when LEDGE holds no activity row for this token", () => {
    expect(activitySentences(makeBody())).toEqual([]);
    expect(lookupText(makeBody(), MAX)).not.toMatch(/\d+ buys?, \d+ sells?/);
  });

  it("states buys, sells and quote in/out against the window it counted over, verbatim", () => {
    const body = makeBody({ activity: ACTIVITY });
    const lines = activitySentences(body);
    expect(body.activity).not.toBeNull();
    // the block window stays on the site page (2026-09-14); the phone reply names the counts
    expect(lines[0]).toContain(`${ACTIVITY.buys} buys`);
    expect(lines[0]).toContain(`${ACTIVITY.sells} sells`);
    expect(lines[0]).toContain("ETH in and");
  });

  it("states first buy and last activity, each as a stamp", () => {
    const lines = activitySentences(makeBody({ activity: ACTIVITY }));
    expect(lines[1]).toContain("First buy ");
    expect(lines[1]).toContain("last activity ");
    expect(lines[1]).toMatch(/\d{1,2} \w{3}, \d{2}:\d{2} UTC/);
  });

  it("says 'no buy recorded yet' rather than a stamp when no buy has been seen", () => {
    const noBuy = { ...ACTIVITY, first_buy_ts: null };
    const lines = activitySentences(makeBody({ activity: noBuy }));
    expect(lines[1]).toContain("No buy yet");
  });

  it("distinguishes zero distinct buyers from an unindexed launch block", () => {
    const zero = { ...ACTIVITY, first_block_buyers: 0 };
    const zeroLines = activitySentences(makeBody({ activity: zero }));
        expect(zeroLines[0]).toContain("Nobody bought in the launch block");

    const neverIndexed = { ...ACTIVITY, first_block_buyers: null };
    const nullLines = activitySentences(makeBody({ activity: neverIndexed }));
    expect(nullLines[0]).toContain("The launch block was not indexed");
    expect(nullLines[0]).not.toContain("Nobody bought");
    expect(zeroLines[0]).not.toEqual(nullLines[0]);
  });

  it("prints the distinct buyer count for the launch's own block, and no wallet address", () => {
    const lines = activitySentences(makeBody({ activity: ACTIVITY }));
    expect(lines[0]).toContain(`${ACTIVITY.first_block_buyers}`);
    expect(lines.join(" ")).not.toMatch(/0x[0-9a-f]{40}/i);
  });

  it("reaches the full /t/{address} text, after the curve fill", () => {
    const text = lookupText(makeBody({ activity: ACTIVITY }), MAX);
    expect(text).toMatch(/\d+ buys?, \d+ sells?/);
    expect(text).toContain(`${ACTIVITY.buys} buys`);
    const fillIndex = text.indexOf("Curve fill:");
    const activityIndex = text.search(/\d+ buys?, \d+ sells?/);
    expect(fillIndex).toBeGreaterThan(-1);
    expect(activityIndex).toBeGreaterThan(fillIndex);
  });

  it("prints no percentage in the activity lines without an n beside it", () => {
    const text = lookupText(makeBody({ activity: ACTIVITY }), MAX);
    expect(percentagesWithoutAnN(text)).toEqual([]);
  });
});

/* design/FIRSTBUY-TOKEN-BRIEF.md: the launch's own opening buy, kept apart
   from the first buy from anyone else, both past tense, neither a verdict. */
describe("the first-outside-buy sentence", () => {
  it("states the block as a block fact when the buy landed in the launch block", () => {
    const lines = activitySentences(
      makeBody({
        activity: { ...ACTIVITY, first_outside_buy_block: LAUNCH.block, first_outside_buy_ts: LAUNCH.ts },
      }),
    );
    expect(lines).toContain("First outside buy: in the launch block itself.");
  });

  it("states the delay in whole seconds after the launch block", () => {
    const lines = activitySentences(makeBody({ activity: ACTIVITY }));
    expect(lines).toContain("First outside buy: 12 s after the launch block.");
  });

  it("says no outside buy was recorded when none has been seen", () => {
    const lines = activitySentences(
      makeBody({ activity: { ...ACTIVITY, first_outside_buy_block: null, first_outside_buy_ts: null } }),
    );
    expect(lines.join(" ")).toMatch(/First outside buy: (none yet|not recorded for this launch)\./);
  });

  it("states whether the launch transaction carried its own opening buy", () => {
    const seen = activitySentences(makeBody({ activity: { ...ACTIVITY, launch_tx_buy: 1 } }));
    const notSeen = activitySentences(makeBody({ activity: { ...ACTIVITY, launch_tx_buy: 0 } }));
    expect(seen).toContain("The launch transaction bought its own opening tokens.");
    expect(notSeen).toContain("The launch transaction bought nothing.");
  });

  it("says nothing about the launch transaction when it is not known", () => {
    const lines = activitySentences(makeBody({ activity: { ...ACTIVITY, launch_tx_buy: null } }));
    expect(lines.join(" ")).not.toContain("The launch transaction bought");
  });

  it("carries no verdict word", () => {
    const lines = activitySentences(makeBody({ activity: ACTIVITY }));
    expect(lines.join(" ")).not.toMatch(/\b(will |predict|score|risk|odds|probab)/i);
  });
});

describe("the /number reply, since 2026-09-14", () => {
  const file = fixtureNumber();
  const text = numberText(file.h24, file.crawledAt, "12 min", "https://ledge.tools/method", {
    ttg: file.h24.ttg,
    recordSince: "2026-09-05T15:58:32Z",
  });
  it("says the median time to graduation with its n, and where the record starts", () => {
    expect(text).toMatch(/Median time to graduation: .*\(n=[\d,]+\)|Median time to graduation: not enough data/);
    expect(text).toContain("since 5 Sep 2026");
  });
});
