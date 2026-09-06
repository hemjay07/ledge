import { describe, expect, it } from "vitest";
import { findRung, placeOnLadder } from "../../src/ladder";
import type { LadderStep, NumberWindow } from "../../src/numberFile";
import { fixtureNumber } from "./helpers";

const LADDER: LadderStep[] = [
  { atSeconds: 30, cumulative: 21, cumulativeShare: 0.196262 },
  { atSeconds: 60, cumulative: 47, cumulativeShare: 0.439252 },
  { atSeconds: 300, cumulative: 72, cumulativeShare: 0.672897 },
  { atSeconds: 600, cumulative: 79, cumulativeShare: 0.738318 },
];

describe("findRung", () => {
  it("takes the largest step at or below the elapsed time", () => {
    expect(findRung(LADDER, 500)?.atSeconds).toBe(300);
  });

  it("is inclusive exactly on a step", () => {
    expect(findRung(LADDER, 300)?.atSeconds).toBe(300);
  });

  it("is exclusive one second below a step", () => {
    expect(findRung(LADDER, 299)?.atSeconds).toBe(60);
  });

  it("has no step for a launch younger than the first", () => {
    expect(findRung(LADDER, 29)).toBeNull();
  });

  it("holds at the last step past the end of the table", () => {
    expect(findRung(LADDER, 99_999)?.atSeconds).toBe(600);
  });

  it("copies the share rather than deriving one", () => {
    expect(findRung(LADDER, 700)?.cumulativeShare).toBe(0.738318);
  });
});

describe("placeOnLadder", () => {
  const file = fixtureNumber();

  it("places an indexed launch and reports why", () => {
    const p = placeOnLadder(file.allTime, "allTime", file.crawledAt, 811);
    expect(p.reason).toBe("ok");
    expect(p.insufficient).toBe(false);
    expect(p.rung?.atSeconds).toBe(600);
    expect(p.n).toBe(file.allTime.ttg.n);
    expect(p.crawledAt).toBe(file.crawledAt);
  });

  it("reports no_ladder, not insufficiency, when the table is unpublished", () => {
    const window = {
      ...file.allTime,
      ttg: { ...file.allTime.ttg, ladder: undefined },
    } as NumberWindow;
    const p = placeOnLadder(window, "allTime", file.crawledAt, 811);
    expect(p.reason).toBe("no_ladder");
    expect(p.rung).toBeNull();
  });

  it("reports insufficiency when the pipeline marked the sample short", () => {
    const window = {
      ...file.allTime,
      ttg: { ...file.allTime.ttg, n: 29, insufficient: true },
    } as NumberWindow;
    const p = placeOnLadder(window, "allTime", file.crawledAt, 811);
    expect(p.reason).toBe("insufficient");
    expect(p.rung).toBeNull();
    expect(p.n).toBe(29);
  });

  it("has nothing to place when the launch time is not indexed", () => {
    const p = placeOnLadder(file.allTime, "allTime", file.crawledAt, null);
    expect(p.rung).toBeNull();
    expect(p.elapsedSeconds).toBeNull();
  });

  it("separates 'younger than the first step' from 'not enough data'", () => {
    const p = placeOnLadder(file.allTime, "allTime", file.crawledAt, 5);
    expect(p.reason).toBe("before_first_step");
    expect(p.insufficient).toBe(false);
  });
});
