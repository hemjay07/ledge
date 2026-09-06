import { describe, expect, it } from "vitest";
import { findPairTaxRow } from "../../src/lookup";
import { taxBucketOf, pairClassOf } from "../../src/buckets";
import { fixtureNumber, makeBody, ADDRESS, NOW_SECONDS, LAUNCH, CURVE } from "./helpers";

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
