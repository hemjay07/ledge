import { describe, expect, it } from "vitest";
import { joinGraduations } from "../scripts/graduated-core.mjs";

/* Synthetic, hand-built rows — never the live data files, which move and
   would make these assertions brittle (the reason this suite exists to be
   run against instead). Every launch/graduation pair below is invented to
   exercise one behaviour of the join. */

const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN_C = "0xcccccccccccccccccccccccccccccccccccccccc";
const TOKEN_ORPHAN = "0xdddddddddddddddddddddddddddddddddddddddd";
const TOKEN_UNMATCHED = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const TOKEN_BACKWARDS = "0xffffffffffffffffffffffffffffffffffffffff";

describe("joinGraduations", () => {
  it("computes duration as graduation ts minus launch ts, per token", () => {
    const result = joinGraduations(
      [{ token: TOKEN_A, ts: 1000, pairClass: "eth", creatorTaxBps: 100 }],
      [{ token: TOKEN_A, ts: 1041, orphan: false }],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      token: TOKEN_A,
      durationSeconds: 41,
      pairClass: "eth",
      creatorTaxBps: 100,
    });
    expect(result.excludedNoLaunch).toBe(0);
    expect(result.excludedUnmatched).toBe(0);
  });

  it("stamps graduatedAt and launchedAt as readable timestamps derived from the raw ts", () => {
    const result = joinGraduations(
      [{ token: TOKEN_A, ts: 1000 }],
      [{ token: TOKEN_A, ts: 1060, orphan: false }],
    );
    const row = result.rows[0]!;
    expect(Date.parse(row.graduatedAt)).toBe(1060 * 1000);
    expect(Date.parse(row.launchedAt)).toBe(1000 * 1000);
  });

  it("skips a graduation flagged orphan, and counts it under excludedNoLaunch", () => {
    const result = joinGraduations(
      [{ token: TOKEN_A, ts: 1000 }],
      [
        { token: TOKEN_A, ts: 1041, orphan: false },
        { token: TOKEN_ORPHAN, ts: 2000, orphan: true },
      ],
    );
    expect(result.rows.map((r) => r.token)).toEqual([TOKEN_A]);
    expect(result.excludedNoLaunch).toBe(1);
    expect(result.excludedUnmatched).toBe(0);
    expect(result.totalGraduationRows).toBe(2);
  });

  it("counts a graduation with no matching launch under excludedUnmatched, even when orphan is not set", () => {
    const result = joinGraduations(
      [{ token: TOKEN_A, ts: 1000 }],
      [{ token: TOKEN_UNMATCHED, ts: 2000, orphan: false }],
    );
    expect(result.rows).toHaveLength(0);
    expect(result.excludedUnmatched).toBe(1);
    expect(result.excludedNoLaunch).toBe(0);
  });

  it("excludes, rather than reports a negative duration, when a graduation precedes its own launch", () => {
    const result = joinGraduations(
      [{ token: TOKEN_BACKWARDS, ts: 5000 }],
      [{ token: TOKEN_BACKWARDS, ts: 4000, orphan: false }],
    );
    expect(result.rows).toHaveLength(0);
    expect(result.excludedUnmatched).toBe(1);
  });

  it("sorts the joined rows fastest-first, by durationSeconds ascending", () => {
    const result = joinGraduations(
      [
        { token: TOKEN_A, ts: 1000 },
        { token: TOKEN_B, ts: 1000 },
        { token: TOKEN_C, ts: 1000 },
      ],
      [
        { token: TOKEN_A, ts: 1900, orphan: false }, // 900s
        { token: TOKEN_B, ts: 1010, orphan: false }, // 10s
        { token: TOKEN_C, ts: 1300, orphan: false }, // 300s
      ],
    );
    expect(result.rows.map((r) => r.token)).toEqual([TOKEN_B, TOKEN_C, TOKEN_A]);
    expect(result.rows.map((r) => r.durationSeconds)).toEqual([10, 300, 900]);
  });

  it("carries null pairClass and creatorTaxBps through when the launch record does not have them", () => {
    const result = joinGraduations(
      [{ token: TOKEN_A, ts: 1000 }],
      [{ token: TOKEN_A, ts: 1041, orphan: false }],
    );
    expect(result.rows[0]).toMatchObject({ pairClass: null, creatorTaxBps: null });
  });

  it("totalGraduationRows counts every graduation read, included or excluded", () => {
    const result = joinGraduations(
      [{ token: TOKEN_A, ts: 1000 }],
      [
        { token: TOKEN_A, ts: 1041, orphan: false },
        { token: TOKEN_ORPHAN, ts: 2000, orphan: true },
        { token: TOKEN_UNMATCHED, ts: 3000, orphan: false },
      ],
    );
    expect(result.totalGraduationRows).toBe(3);
    expect(result.rows.length + result.excludedNoLaunch + result.excludedUnmatched).toBe(3);
  });
});
