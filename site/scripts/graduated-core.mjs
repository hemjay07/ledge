/* The join between a launch and its graduation. Plain JavaScript, no I/O, so
   both scripts/generate-graduated.mjs (bare node, at build time) and the test
   suite (vitest, on synthetic rows) call the exact same function.

   A per-token time-to-graduation is a Class B fact — one token's own duration,
   no denominator, no population. Computing it here is fine. The join produces
   nothing that is a share, a rate, or a percentage; those stay in
   data/number.json, gated by n = 30 and computed by pipeline/recompute.py,
   which this file never touches. */

/**
 * @param {{ token: string, ts: number, pairClass?: string | null, creatorTaxBps?: number | null }[]} launches
 * @param {{ token: string, ts: number, orphan?: boolean }[]} graduations
 */
export function joinGraduations(launches, graduations) {
  const launchByToken = new Map();
  for (const launch of launches) {
    launchByToken.set(launch.token, launch);
  }

  const rows = [];
  /* CONSTRAINTS.md 5: never hide an ugly number. A graduation excluded from
     the list is counted, not dropped silently, and the two reasons are kept
     apart because they are different findings: one is "this token launched
     before the index began", the other would be a join defect in the data
     itself and should never happen in practice. */
  let excludedNoLaunch = 0;
  let excludedUnmatched = 0;

  for (const graduation of graduations) {
    if (graduation.orphan === true) {
      excludedNoLaunch += 1;
      continue;
    }

    const launch = launchByToken.get(graduation.token);
    if (!launch) {
      excludedUnmatched += 1;
      continue;
    }

    const durationSeconds = graduation.ts - launch.ts;
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
      // A launch after its own graduation is not a duration; the join
      // failed to produce a fact rather than produce a false one.
      excludedUnmatched += 1;
      continue;
    }

    rows.push({
      token: graduation.token,
      durationSeconds,
      graduatedAt: new Date(graduation.ts * 1000).toISOString(),
      launchedAt: new Date(launch.ts * 1000).toISOString(),
      pairClass: launch.pairClass ?? null,
      creatorTaxBps: launch.creatorTaxBps ?? null,
    });
  }

  rows.sort((a, b) => a.durationSeconds - b.durationSeconds);

  return {
    rows,
    excludedNoLaunch,
    excludedUnmatched,
    totalGraduationRows: graduations.length,
  };
}
