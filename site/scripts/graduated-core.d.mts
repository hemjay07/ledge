/* Types for scripts/graduated-core.mjs, so its own test suite is checked by
   `tsc --noEmit` too. */

export interface CoreLaunch {
  token: string;
  ts: number;
  pairClass?: string | null;
  creatorTaxBps?: number | null;
}

export interface CoreGraduation {
  token: string;
  ts: number;
  orphan?: boolean;
}

export interface CoreRow {
  token: string;
  durationSeconds: number;
  graduatedAt: string;
  launchedAt: string;
  pairClass: string | null;
  creatorTaxBps: number | null;
}

export interface JoinResult {
  rows: CoreRow[];
  excludedNoLaunch: number;
  excludedUnmatched: number;
  totalGraduationRows: number;
}

export function joinGraduations(launches: CoreLaunch[], graduations: CoreGraduation[]): JoinResult;
