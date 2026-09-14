import { describe, expect, it } from "vitest";
import { LIVE_STALE_AFTER_SECONDS, findPairTaxRow, firstBuyFor } from "../../src/lookup";
import { taxBucketOf, pairClassOf } from "../../src/buckets";
import { ACTIVITY, fixtureNumber, makeBody, ADDRESS, NOW_SECONDS, LAUNCH, CURVE } from "./helpers";

describe("bucket placement", () => {
  it("mirrors pipeline/stats.py's ranges exactly", () => {
    expect(taxBucketOf(0)).toBe("0%");
    expect(taxBucketOf(1)).toBe("1%");
    expect(taxBucketOf(100)).toBe("1%");
    expect(taxBucketOf(101)).toBe("2-3%");
    expect(taxBucketOf(300)).toBe("2-3%");
    expect(taxBucketOf(500)).toBe("4-5%");
    expect(taxBucketOf(1000)).toBe("6-10%");
  });

  it("excludes an undocumented tax exactly as a missing one is excluded", () => {
    expect(taxBucketOf(1001)).toBeNull();
    expect(taxBucketOf(null)).toBeNull();
  });

  it("lands an unseen pair token in other, as recompute.py would", () => {
    expect(pairClassOf("0xdeadbeef00000000000000000000000000000000", {})).toBe("other");
    expect(
      pairClassOf("0x0000000000000000000000000000000000000000", {
        "0x0000000000000000000000000000000000000000": { class: "eth", symbol: "ETH" },
      }),
    ).toBe("eth");
  });
});

describe("the cross cohort lookup", () => {
  const file = fixtureNumber();

  it("finds the row keyed by explicit fields", () => {
    const row = findPairTaxRow(file.allTime, "eth", "2-3%");
    expect(row).not.toBeNull();
    expect(row?.launches).toBeGreaterThan(0);
  });

  it("finds the same row keyed as a joined bucket string", () => {
    const window = {
      ...file.allTime,
      cohorts: {
        ...file.allTime.cohorts,
        pairTax: file.allTime.cohorts.pairTax!.map((r) => ({
          bucket: `${r.pairClass}/${r.taxBucket}`,
          launches: r.launches,
          graduations: r.graduations,
          rate: r.rate,
          insufficient: r.insufficient,
          excludingFast: r.excludingFast,
        })),
      },
    };
    expect(findPairTaxRow(window, "eth", "2-3%")?.launches).toBe(
      findPairTaxRow(file.allTime, "eth", "2-3%")?.launches,
    );
  });

  it("has no row for a token with no tax bucket", () => {
    expect(findPairTaxRow(file.allTime, "eth", null)).toBeNull();
  });

  it("has no row when the pipeline has not published pairTax yet", () => {
    const window = { ...file.allTime, cohorts: { ...file.allTime.cohorts, pairTax: undefined } };
    expect(findPairTaxRow(window, "eth", "2-3%")).toBeNull();
  });

  it("copies the row rather than deriving it", () => {
    const row = findPairTaxRow(file.allTime, "eth", "2-3%")!;
    const body = makeBody();
    expect(body.cohort?.allTime?.rate).toBe(row.rate);
    expect(body.cohort?.allTime?.launches).toBe(row.launches);
    expect(body.cohort?.allTime?.excludingFast.oneIn).toBe(row.excludingFast.oneIn);
    expect(body.cohort?.crawledAt).toBe(file.crawledAt);
  });
});

describe("the assembled body", () => {
  it("carries Class B facts about one token and their observation time", () => {
    const body = makeBody();
    expect(body.address).toBe(ADDRESS);
    expect(body.source).toBe("chain");
    expect(body.state.elapsedSeconds).toBe(811);
    expect(body.state.launchBlock).toBe(LAUNCH.block);
    expect(body.state.indexed).toBe(true);
    expect(body.state.phaseLabel).toBe("on the bonding curve");
  });

  it("names an unobserved phase rather than guessing at it", () => {
    const body = makeBody({ onChain: { exists: true, curve: CURVE, pairToken: "0x0000000000000000000000000000000000000000", graduationThresholdWei: "1", creatorTaxBps: 300, phase: 3 } });
    expect(body.state.phaseLabel).toBe("unknown phase (3)");
  });

  it("reports an absent fill as unavailable, never as zero", () => {
    const body = makeBody();
    expect(body.state.curveFilledShare).toBeNull();
    expect(body.state.curveFilledWei).toBeNull();
    expect(body.state.fillNote).toBe("fill not available");
  });

  it("keeps four correct facts when the launch is outside the retention window", () => {
    const body = makeBody({ launch: null });
    expect(body.state.indexed).toBe(false);
    expect(body.state.launchedAt).toBeNull();
    expect(body.state.elapsedSeconds).toBeNull();
    // no launch time, no placement: an unindexed token is not placed at minute 0
    expect(body.placement).toBeNull();
    // the config and the cohort survive eviction, because they come from the
    // chain and from number.json, not from D1
    expect(body.config.pairClass).toBe("eth");
    expect(body.config.taxBucket).toBe("2-3%");
    expect(body.cohort?.allTime?.launches).toBeGreaterThan(0);
    expect(body.notice).toContain("not known");
  });

  it("has no cohort and no placement when number.json is not loadable", () => {
    const body = makeBody({ numberFile: null });
    expect(body.cohort).toBeNull();
    expect(body.placement).toBeNull();
    expect(body.state.elapsedSeconds).toBe(811);
  });

  it("marks the live layer stale when the tick has not completed a pass", () => {
    const body = makeBody({
      cursor: { last_indexed_block: 1, last_success_at: NOW_SECONDS - 600, consecutive_failures: 4 },
    });
    expect(body.live.stale).toBe(true);
  });
});

/* W1 — what "stale" means for the live layer.

   METHOD.md: the flag reports that the run knew it was behind -- "it recorded
   a failure since its last success (consecutiveFailures > 0 ...)". The Worker
   read only the age of the last success, so a tick that had failed on its
   last four passes still reported a fresh live layer for five minutes, which
   is exactly the window in which a reader is most likely to be looking. */
describe("the live layer's own staleness", () => {
  it("is stale after a failure, however recent the last success was", () => {
    const body = makeBody({
      cursor: { last_indexed_block: 1, last_success_at: NOW_SECONDS - 10, consecutive_failures: 1 },
    });
    expect(body.live.stale).toBe(true);
  });

  it("is stale when the last success is older than the bound", () => {
    const body = makeBody({
      cursor: {
        last_indexed_block: 1,
        last_success_at: NOW_SECONDS - (LIVE_STALE_AFTER_SECONDS + 1),
        consecutive_failures: 0,
      },
    });
    expect(body.live.stale).toBe(true);
  });

  it("is fresh only when the last pass succeeded and was recent", () => {
    const body = makeBody({
      cursor: { last_indexed_block: 1, last_success_at: NOW_SECONDS - 10, consecutive_failures: 0 },
    });
    expect(body.live.stale).toBe(false);
  });

  it("is stale when there is no cursor at all", () => {
    expect(makeBody({ cursor: null }).live.stale).toBe(true);
  });
});

/* design/FIRSTBUY-TOKEN-BRIEF.md: what launches with this token's own
   creator-tax band did about their first buy, a verbatim lookup into
   number.json's firstBuy block (pipeline/stats.py), the same pattern as
   outcomesFor. */
describe("the first-buy cohort lookup", () => {
  function withFirstBuy() {
    const file = JSON.parse(JSON.stringify(fixtureNumber()));
    file.firstBuy = {
      indexedFromBlock: 56000000,
      population: "launches at least one hour old at crawledAt, launched at or after indexedFromBlock",
      cohorts: {
        all: [],
        taxBucket: [
          {
            bucket: "2-3%",
            n: 412,
            launchTxBuy: 380,
            launchTxBuyShare: 0.922,
            outside: { sameBlock: 10, within1s: 60, within3s: 20, within5s: 8, after5s: 5, none: 2 },
            sameBlockShare: 0.03,
            within1sShare: 0.24,
            within3sShare: 0.29,
            within5sShare: 0.31,
            noneShare: 0.02,
            insufficient: false,
          },
        ],
        pairClass: [],
      },
    };
    return file;
  }

  it("returns the band's own row", () => {
    const row = firstBuyFor(withFirstBuy(), "2-3%");
    expect(row?.cohort.bucket).toBe("2-3%");
    expect(row?.cohort.n).toBe(412);
    expect(row?.cohort.within1sShare).toBe(0.24);
    expect(row?.cohort.within5sShare).toBe(0.31);
    expect(row?.cohort.noneShare).toBe(0.02);
    expect(row?.cohort.insufficient).toBe(false);
  });

  it("is null when the file carries no firstBuy block", () => {
    expect(firstBuyFor(fixtureNumber(), "2-3%")).toBeNull();
  });

  it("is null when the token's own tax bucket is not known", () => {
    expect(firstBuyFor(withFirstBuy(), null)).toBeNull();
  });

  it("is null when the band has no published row", () => {
    expect(firstBuyFor(withFirstBuy(), "0%")).toBeNull();
  });

  it("is assembled onto the token body, beside outcomes", () => {
    const body = makeBody({ numberFile: withFirstBuy() });
    expect(body.firstBuy?.cohort.bucket).toBe("2-3%");
  });
});

/* The Worker's own reading of one token's first outside buy, kept apart from
   the launch's own opening buy -- both Class B, both read off the activity
   row lookup.ts already assembles, never derived from a population. */
describe("the first-outside-buy activity reading", () => {
  it("marks inLaunchBlock true when the buy's block equals the row's own from_block", () => {
    const body = makeBody({
      activity: { ...ACTIVITY, first_outside_buy_block: LAUNCH.block, first_outside_buy_ts: LAUNCH.ts },
    });
    expect(body.activity?.firstOutsideBuy?.inLaunchBlock).toBe(true);
    expect(body.activity?.firstOutsideBuy?.delaySeconds).toBe(0);
  });

  it("computes the delay as a subtraction of two block-header timestamps", () => {
    const body = makeBody({
      activity: {
        ...ACTIVITY,
        first_outside_buy_block: LAUNCH.block + 3,
        first_outside_buy_ts: LAUNCH.ts + 16,
      },
    });
    expect(body.activity?.firstOutsideBuy?.inLaunchBlock).toBe(false);
    expect(body.activity?.firstOutsideBuy?.delaySeconds).toBe(16);
  });

  it("is null when no outside buy has been recorded", () => {
    const body = makeBody({
      activity: { ...ACTIVITY, first_outside_buy_block: null, first_outside_buy_ts: null },
    });
    expect(body.activity?.firstOutsideBuy).toBeNull();
  });

  it("is null when the launch row is not in hand, even if a block is known", () => {
    const body = makeBody({ activity: ACTIVITY, launch: null });
    expect(body.activity?.firstOutsideBuy).toBeNull();
  });

  it("carries launchTxBuy as a boolean, or null when the launch block was never read", () => {
    const seen = makeBody({ activity: { ...ACTIVITY, launch_tx_buy: 1 } });
    const notSeen = makeBody({ activity: { ...ACTIVITY, launch_tx_buy: 0 } });
    const unknown = makeBody({ activity: { ...ACTIVITY, launch_tx_buy: null } });
    expect(seen.activity?.launchTxBuy).toBe(true);
    expect(notSeen.activity?.launchTxBuy).toBe(false);
    expect(unknown.activity?.launchTxBuy).toBeNull();
  });
});
