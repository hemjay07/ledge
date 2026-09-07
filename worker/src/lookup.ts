/* One token, looked up.
   ============================================================================
   NO ARITHMETIC IN THIS FILE (gate 2, ARCHITECTURE-PHASE2-4.md section 9).

   Two kinds of thing are assembled here and they are kept strictly apart:

   Class B -- observations. phase, launch block, seconds elapsed, whether a
   PoolGraduated has been seen. Facts about one object, read from the chain and
   from D1. They carry `observedAt` and `source: "chain"`. There is no
   denominator because there is no population.

   Class A -- statistics. The cohort row and the ladder placement. Both are
   VERBATIM LOOKUPS into data/number.json, which pipeline/stats.py wrote and
   recompute.py checks byte-for-byte. Not one of them is derived here.

   Subtraction of two block-header timestamps to get an elapsed time is a
   Class B observation about one token, not an aggregation, and it is the only
   operation on a number in this file.
   ========================================================================= */

import type { Env } from "./env";
import type { RpcClient } from "./rpc";
import { RpcUnavailable } from "./rpc";
import {
  SELECTOR_GET_LAUNCHED_TOKEN,
  decodeLaunchedToken,
  encodeAddressCall,
  phaseLabel,
  type LaunchedToken,
} from "./pons";
import { pairClassOf, taxBucketOf, type PairTokenEntry } from "./buckets";
import { pairSymbolOf } from "./decimals";
import { curveFill, FILL_UNAVAILABLE } from "./curve";
import { placeOnLadder, type Placement } from "./ladder";
import type { NumberFile, NumberWindow, PairTaxRow, WindowName } from "./numberFile";
import type { CohortWindow, TokenResponse } from "./schema";
import { ageSeconds, toIso } from "./format";

export const LIVE_STALE_AFTER_SECONDS = 300;

/** Whether the live layer knows it is behind.

    METHOD.md is binding on what the word means: a layer is stale when "it
    recorded a failure since its last success (consecutiveFailures > 0, or
    lastRunAt after lastSuccessAt, or no successful run yet)" -- OR when the
    last success is simply too old. Only the second half was read here, so a
    tick that had failed its last four passes still reported a fresh live
    layer for five minutes: the window in which a reader is most likely to be
    looking at it. Both halves, in one place, read by every surface. */
export function liveStale(cursor: CursorRow | null, nowSeconds: number): boolean {
  if (cursor === null) return true;
  if (cursor.consecutive_failures > 0) return true;
  return nowSeconds - cursor.last_success_at > LIVE_STALE_AFTER_SECONDS;
}

export interface LaunchRow {
  token: string;
  curve: string;
  pair_token: string;
  pair_class: string;
  creator_tax_bps: number | null;
  block: number;
  ts: number;
}

export interface GraduationRow {
  token: string;
  block: number;
  ts: number;
}

export interface CursorRow {
  last_indexed_block: number;
  last_success_at: number;
  consecutive_failures: number;
}

/* ---- Class A: verbatim table lookups ------------------------------------ */

/** The pairTax row for one token's configuration.

    Two row spellings are accepted -- explicit `pairClass`/`taxBucket` fields,
    or the single `"eth/2-3%"` bucket string the 1-D cohorts already use --
    because the row's identity is what matters and either spelling names the
    same row. A token with no tax bucket (a bps outside the documented range,
    or an enrichment that failed) has no row, and the caller says so. */
export function findPairTaxRow(
  window: NumberWindow,
  pairClass: string,
  taxBucket: string | null,
): PairTaxRow | null {
  const rows = window.cohorts.pairTax;
  if (!rows || taxBucket === null) return null;
  const joined = `${pairClass}/${taxBucket}`;
  for (const row of rows) {
    if (row.pairClass === pairClass && row.taxBucket === taxBucket) return row;
    if (row.bucket === joined) return row;
  }
  return null;
}

const WINDOW_LABEL: Record<WindowName, "24h" | "allTime"> = { h24: "24h", allTime: "allTime" };

/** A number.json row, restated in the response contract. Every field is copied
    across; none is computed. */
export function cohortWindowFrom(
  row: PairTaxRow,
  windowName: WindowName,
  crawledAt: string,
): CohortWindow {
  return {
    window: WINDOW_LABEL[windowName],
    crawledAt,
    launches: row.launches,
    graduations: row.graduations,
    rate: row.rate,
    insufficient: row.insufficient,
    excludingFast: {
      cutoffSeconds: row.excludingFast.cutoffSeconds,
      graduations: row.excludingFast.graduations,
      rate: row.excludingFast.rate,
      oneIn: row.excludingFast.oneIn,
      insufficient: row.excludingFast.insufficient,
    },
  };
}

/* ---- Class B: the chain and the local index ----------------------------- */

export async function readLaunchedToken(
  rpc: RpcClient,
  factory: string,
  address: string,
): Promise<LaunchedToken | null> {
  const data = encodeAddressCall(SELECTOR_GET_LAUNCHED_TOKEN, address);
  const returned = await rpc.ethCall(factory, data);
  return decodeLaunchedToken(returned);
}

export async function readIndex(
  db: D1Database,
  address: string,
): Promise<{ launch: LaunchRow | null; graduation: GraduationRow | null; cursor: CursorRow | null }> {
  const [launch, graduation, cursor] = await db.batch([
    /* `token` is indexed but not unique -- the durable key is the log's own
       identity -- so both reads name the row they want: the earliest, which
       is the one that actually happened. */
    db
      .prepare(
        "SELECT token, curve, pair_token, pair_class, creator_tax_bps, block, ts FROM launch WHERE token = ? ORDER BY block ASC LIMIT 1",
      )
      .bind(address),
    db
      .prepare("SELECT token, block, ts FROM graduation WHERE token = ? ORDER BY block ASC LIMIT 1")
      .bind(address),
    db.prepare("SELECT last_indexed_block, last_success_at, consecutive_failures FROM cursor WHERE id = 1"),
  ]);
  return {
    launch: (launch?.results[0] as LaunchRow | undefined) ?? null,
    graduation: (graduation?.results[0] as GraduationRow | undefined) ?? null,
    cursor: (cursor?.results[0] as CursorRow | undefined) ?? null,
  };
}

/* ---- assembly ----------------------------------------------------------- */

export interface BuildInput {
  address: string;
  nowSeconds: number;
  onChain: LaunchedToken;
  launch: LaunchRow | null;
  graduation: GraduationRow | null;
  cursor: CursorRow | null;
  numberFile: NumberFile | null;
  pairTokens: Record<string, PairTokenEntry> | null;
  fill: Awaited<ReturnType<typeof curveFill>>;
  /** Decimals for the pair token, resolved by decimals.ts. Null when unknown. */
  pairDecimals: number | null;
  siteOrigin: string;
}

/** The response body, minus the rendered sentence, which text.ts adds. */
export function buildTokenBody(input: BuildInput): Omit<TokenResponse, "text"> {
  const { address, nowSeconds, onChain, launch, graduation, cursor, numberFile, fill } = input;

  const pairToken = launch?.pair_token ?? onChain.pairToken;
  const pairClass = launch?.pair_class ?? pairClassOf(pairToken, input.pairTokens);
  const creatorTaxBps = launch?.creator_tax_bps ?? onChain.creatorTaxBps;
  const taxBucket = taxBucketOf(creatorTaxBps);

  const indexed = launch !== null;
  const launchedAt = launch ? toIso(launch.ts) : null;
  const elapsedSeconds = launch ? nowSeconds - launch.ts : null;
  const graduatedAt = graduation ? toIso(graduation.ts) : null;
  const timeToGraduationSeconds = launch && graduation ? graduation.ts - launch.ts : null;
  const graduated = graduation !== null || onChain.phase === 2;

  const observedAt = toIso(nowSeconds);
  const lastSuccessAt = cursor ? toIso(cursor.last_success_at) : null;
  const staleLive = liveStale(cursor, nowSeconds);

  let cohort: TokenResponse["cohort"] = null;
  let freshness: TokenResponse["freshness"] = null;
  let placement: Placement | null = null;
  if (numberFile) {
    const h24Row = findPairTaxRow(numberFile.h24, pairClass, taxBucket);
    const allTimeRow = findPairTaxRow(numberFile.allTime, pairClass, taxBucket);
    /* The age of the measurement, computed here and now against the bound
       number.json publishes (METHOD.md "Freshness"). It is not read off the
       file's own `stale` flag, which says only that the run knew it was
       behind: a successful run publishes stale:false however old the data
       later becomes, so a file nine days old arrives claiming to be fresh. */
    const cohortAge = ageSeconds(numberFile.crawledAt, nowSeconds * 1000);
    freshness = {
      crawledAt: numberFile.crawledAt,
      ageSeconds: cohortAge,
      staleAfterSeconds: numberFile.staleAfterSeconds,
      stale: cohortAge >= numberFile.staleAfterSeconds,
    };
    cohort = {
      crawledAt: numberFile.crawledAt,
      definitionsVersion: numberFile.definitionsVersion,
      key: { pairClass, taxBucket },
      h24: h24Row ? cohortWindowFrom(h24Row, "h24", numberFile.crawledAt) : null,
      allTime: allTimeRow ? cohortWindowFrom(allTimeRow, "allTime", numberFile.crawledAt) : null,
    };
    /* No launch time, no placement. An unindexed token is not placed at
       "minute 0": it is not placed at all. */
    placement =
      elapsedSeconds === null
        ? null
        : placeOnLadder(numberFile.allTime, "allTime", numberFile.crawledAt, elapsedSeconds);
  }

  return {
    schemaVersion: 1,
    address,
    venue: "pons",
    observedAt,
    source: "chain",
    config: {
      pairToken,
      pairClass,
      pairSymbol: pairSymbolOf(pairToken, input.pairTokens),
      pairDecimals: input.pairDecimals,
      creatorTaxBps,
      taxBucket,
    },
    state: {
      phase: onChain.phase,
      phaseLabel: phaseLabel(onChain.phase),
      curveFilledWei: fill ? fill.filledWei : null,
      graduationThresholdWei: fill ? fill.thresholdWei : onChain.graduationThresholdWei,
      curveFilledShare: fill ? fill.share : null,
      fillNote: fill ? fill.note : FILL_UNAVAILABLE,
      launchBlock: launch ? launch.block : null,
      launchedAt,
      elapsedSeconds,
      graduated,
      graduatedAt,
      timeToGraduationSeconds,
      indexed,
    },
    cohort,
    freshness,
    /* `reason` stays internal to ladder.ts: the pair (rung, insufficient) is
       already a complete encoding for a consumer -- a null rung with
       insufficient false is "younger than the first mark", and with
       insufficient true is "not enough graduations to place it". */
    placement:
      placement && placement.elapsedSeconds !== null
        ? {
            crawledAt: placement.crawledAt,
            window: WINDOW_LABEL[placement.window],
            elapsedSeconds: placement.elapsedSeconds,
            rung: placement.rung,
            n: placement.n,
            insufficient: placement.insufficient,
            reason: placement.reason,
          }
        : null,
    live: {
      stale: staleLive,
      lastSuccessAt,
      lastIndexedBlock: cursor ? cursor.last_indexed_block : null,
    },
    notice: indexed
      ? null
      : "Launched more than 7 days ago, or LEDGE has not reached this block yet. The launch time is not known, so the elapsed time and the placement are absent; everything else is read from the chain now.",
    links: {
      method: `${input.siteOrigin}/method`,
      numberJson: `${input.siteOrigin}/number.json`,
    },
  };
}

export { RpcUnavailable };
export type { Env };
