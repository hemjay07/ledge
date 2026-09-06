/* Placing one token on the graduation table.
   ============================================================================
   NO ARITHMETIC IN THIS FILE (gate 2, ARCHITECTURE-PHASE2-4.md section 9).

   The sentence the product wants is "minute 14 -- 75% of graduations have
   already happened by now". The "minute 14" is an observation about one token.
   The "75%" is a statistic, and pipeline/stats.py is the only place a
   statistic is defined. So this file does not compute the 75%: it finds the
   largest step of the table stats.py already wrote into number.json whose
   atSeconds is at or below the elapsed time, and hands back that step's own
   cumulativeShare verbatim.

   Because it does no maths, it cannot drift from Python. That is checkable,
   and tests/vectors.test.ts checks it.
   ========================================================================= */

import type { LadderStep, NumberWindow, WindowName } from "./numberFile";

/** Why a placement has no step, when it has none. Naming the reason keeps
    "the table is not published yet" from being reported as "not enough
    graduations", which would be a different and untrue statement. */
export type PlacementReason = "ok" | "insufficient" | "no_ladder" | "before_first_step";

export interface Placement {
  crawledAt: string;
  window: WindowName;
  elapsedSeconds: number | null;
  rung: LadderStep | null;
  n: number;
  insufficient: boolean;
  reason: PlacementReason;
}

/** The largest step at or below `elapsedSeconds`. Comparisons only. */
export function findRung(ladder: readonly LadderStep[], elapsedSeconds: number): LadderStep | null {
  let found: LadderStep | null = null;
  for (const step of ladder) {
    if (step.atSeconds <= elapsedSeconds) {
      found = step;
    }
  }
  return found;
}

export function placeOnLadder(
  window: NumberWindow,
  windowName: WindowName,
  crawledAt: string,
  elapsedSeconds: number | null,
): Placement {
  const ttg = window.ttg;
  const base = { crawledAt, window: windowName, elapsedSeconds, n: ttg.n };

  if (elapsedSeconds === null) {
    return { ...base, rung: null, insufficient: true, reason: "no_ladder" };
  }
  if (!ttg.ladder || ttg.ladder.length === 0) {
    return { ...base, rung: null, insufficient: true, reason: "no_ladder" };
  }
  if (ttg.insufficient) {
    return { ...base, rung: null, insufficient: true, reason: "insufficient" };
  }
  const rung = findRung(ttg.ladder, elapsedSeconds);
  if (rung === null) {
    return { ...base, rung: null, insufficient: false, reason: "before_first_step" };
  }
  if (rung.cumulativeShare === null) {
    return { ...base, rung, insufficient: true, reason: "insufficient" };
  }
  return { ...base, rung, insufficient: false, reason: "ok" };
}
