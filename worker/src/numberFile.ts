/* Reading data/number.json in the live layer.

   number.json is the ONLY source of a Class A figure anywhere in this Worker.
   It arrives in KV, pushed by crawl.yml after the data commit, so the API
   still answers when Vercel is down; the site's static copy still renders when
   Cloudflare is down. Neither can take out the other.

   The parsed file is held in module scope for 60 seconds so a burst of
   lookups is one KV read, not one per request. */

import type { Env } from "./env";
import type { PairTokenEntry } from "./buckets";

export const KV_NUMBER = "number:current";
export const KV_PAIR_TOKENS = "pair-tokens:current";
export const KV_ETAG = "number:etag";

const CACHE_TTL_MS = 60_000;

/* ---- the shape, as of ARCHITECTURE-PHASE2-4.md sections 0 and 3 ---------- */

export interface ExcludingFast {
  cutoffSeconds: number;
  graduations: number;
  rate: number | null;
  oneIn: number | null;
  insufficient: boolean;
}

/** One step of the monotone table stats.py emits. The live layer finds the
    largest step at or below an elapsed time and prints it. It never
    interpolates and never computes a share of its own. */
export interface LadderStep {
  atSeconds: number;
  cumulative: number;
  cumulativeShare: number | null;
}

export interface Ttg {
  n: number;
  insufficient: boolean;
  p50: number | null;
  max: number | null;
  /** Added to number.json alongside this Worker. Absent on a file written
      before it landed, and the placement then reports itself unavailable
      rather than being derived here. */
  ladder?: LadderStep[];
}

/** A row of cohorts.pairTax: pair class crossed with creator-tax bucket.
    Two spellings are accepted because the row's identity is what matters and
    the pipeline may key it either way -- explicit fields, or a single
    "eth/2-3%" bucket string in the shape the 1-D cohorts already use. */
export interface PairTaxRow {
  pairClass?: string;
  taxBucket?: string;
  bucket?: string;
  launches: number;
  graduations: number;
  rate: number | null;
  insufficient: boolean;
  excludingFast: ExcludingFast;
}

/** The two figures METHOD binds to the ladder's 60 s and 300 s rungs: "the
    ladder and those two figures cannot disagree". Read by the fixture
    invariant test, never by a renderer -- a share is printed from the rung. */
export interface FastShares {
  n: number;
  under300Share: number | null;
  under60Share: number | null;
  insufficient: boolean;
}

export interface NumberWindow {
  since: number | null;
  until: number;
  launches: number;
  graduations: number;
  rate: number | null;
  insufficient: boolean;
  lowerBound: boolean;
  excludingFast: ExcludingFast;
  fastShares?: FastShares;
  ttg: Ttg;
  cohorts: {
    pair: Array<{ bucket: string; launches: number; graduations: number; rate: number | null; insufficient: boolean }>;
    tax: Array<{ bucket: string; launches: number; graduations: number; rate: number | null; insufficient: boolean }>;
    pairTax?: PairTaxRow[];
  };
}

export interface NumberFile {
  schemaVersion: number;
  definitionsVersion: string;
  chainId: number;
  factory: string;
  crawledAt: string;
  stale: boolean;
  staleAfterSeconds: number;
  h24: NumberWindow;
  allTime: NumberWindow;
}

export type WindowName = "h24" | "allTime";

/* ---- loading ------------------------------------------------------------ */

interface CacheSlot<T> {
  value: T;
  at: number;
}

let numberCache: CacheSlot<NumberFile> | null = null;
let pairTokenCache: CacheSlot<Record<string, PairTokenEntry>> | null = null;

/** Test seam: drops the module-scope caches. */
export function resetNumberCache(): void {
  numberCache = null;
  pairTokenCache = null;
}

async function readKvJson<T>(env: Env, key: string): Promise<T | null> {
  try {
    return await env.LEDGE_KV.get<T>(key, "json");
  } catch {
    return null;
  }
}

/** KV first; the published static file as a fallback so a Worker deployed
    before the first KV push still answers. Null when neither is loadable --
    the caller then returns `number_unavailable` with the live state alone,
    rather than a figure it invented. */
export async function loadNumber(env: Env, nowMs = Date.now()): Promise<NumberFile | null> {
  if (numberCache && nowMs - numberCache.at < CACHE_TTL_MS) return numberCache.value;

  let file = await readKvJson<NumberFile>(env, KV_NUMBER);
  if (!file && env.NUMBER_JSON_URL) {
    try {
      const response = await fetch(env.NUMBER_JSON_URL, {
        headers: { "User-Agent": "ledge/1.0 (+https://ledge.tools)" },
      });
      if (response.ok) file = (await response.json()) as NumberFile;
    } catch {
      file = null;
    }
  }
  if (!file) return null;
  numberCache = { value: file, at: nowMs };
  return file;
}

export async function loadPairTokens(
  env: Env,
  nowMs = Date.now(),
): Promise<Record<string, PairTokenEntry> | null> {
  if (pairTokenCache && nowMs - pairTokenCache.at < CACHE_TTL_MS) return pairTokenCache.value;
  const map = await readKvJson<Record<string, PairTokenEntry>>(env, KV_PAIR_TOKENS);
  if (!map) return null;
  pairTokenCache = { value: map, at: nowMs };
  return map;
}
