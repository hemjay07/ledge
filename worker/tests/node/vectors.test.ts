/* Gate 1 — the vector gate. ARCHITECTURE-PHASE2-4.md section 9.
   ============================================================================
   "pipeline/stats.py stays the only place a statistic is defined." This file
   is what makes that a fact rather than an intention.

   pipeline/vectors.py reads a frozen number.json and writes, for a set of
   (pairClass, taxBps, elapsedSeconds) inputs, the exact Class A objects and
   the exact sentences the live layer must produce. Here the Worker's own
   lookup.ts, ladder.ts and text.ts are run against those same inputs and must
   land on the identical object and the identical string.

   Neither side can move alone. Change a bucket range, a ladder mark, a
   rounding rule or a word, and either Python regenerates the file (and CI's
   `git diff --exit-code -- tests/vectors` fails) or this test fails. Both jobs
   go red together, which is the only arrangement in which "the Worker does not
   reimplement the Number" stays true after the people who agreed it have moved
   on.

   The vectors are cut from a FROZEN fixture, never live data, so an hourly
   crawl cannot turn this suite red. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTokenBody, type GraduationRow, type LaunchRow } from "../../src/lookup";
import { headline, lookupText } from "../../src/text";
import type { NumberFile } from "../../src/numberFile";
import type { PairTokenEntry } from "../../src/buckets";
import type { LaunchedToken } from "../../src/pons";
import { ADDRESS, CURVE, REPO_ROOT } from "./helpers";

interface VectorCase {
  name: string;
  why: string;
  input: {
    pairClass: string;
    taxBps: number | null;
    elapsedSeconds: number | null;
    phase: number;
    graduated: boolean;
    indexed: boolean;
  };
  expected: {
    cohort: unknown;
    placement: unknown;
    text: { headline: string; placement: string | null };
  };
}

interface VectorFile {
  numberFile: string;
  crawledAt: string;
  ladderEdges: number[];
  cases: VectorCase[];
}

const VECTOR_DIR = join(REPO_ROOT, "tests", "vectors");

/* The vectors are produced by pipeline/vectors.py. Until that has run there is
   nothing to compare against, and this suite says so and skips rather than
   passing quietly -- a green gate over an absent file would be the one failure
   mode this gate exists to prevent. */
const PRESENT =
  existsSync(join(VECTOR_DIR, "lookup.json")) && existsSync(join(VECTOR_DIR, "fixture-number.json"));

const ABSENT_MESSAGE =
  "SKIPPED: tests/vectors/lookup.json or fixture-number.json is not present. " +
  "Run pipeline/vectors.py to emit them. Until then the claim that the Worker " +
  "cannot drift from pipeline/stats.py is UNPROVEN.";

function readVectorFile<T>(name: string): T {
  if (!PRESENT) return {} as T;
  return JSON.parse(readFileSync(join(VECTOR_DIR, name), "utf8")) as T;
}

const VECTORS = readVectorFile<VectorFile>("lookup.json");
const NUMBER = readVectorFile<NumberFile>("fixture-number.json");
const OBSERVED_MAX = PRESENT ? NUMBER.allTime.ttg.max : null;

/* A fixed clock. The vectors carry elapsed times, not timestamps, so the
   launch is placed relative to this and nothing here drifts with the wall. */
const NOW_SECONDS = 2_000_000_000;

/* One pair token per class, and the map that classifies them. The vectors
   name a pair CLASS; resolving an address to a class is tested elsewhere. */
const PAIR_TOKEN = {
  eth: "0x0000000000000000000000000000000000000000",
  stable: "0x00000000000000000000000000000000000000a1",
  stock: "0x00000000000000000000000000000000000000a2",
  other: "0x00000000000000000000000000000000000000a3",
} as const;

const PAIR_TOKENS: Record<string, PairTokenEntry> = {
  [PAIR_TOKEN.eth]: { class: "eth", symbol: "ETH" },
  [PAIR_TOKEN.stable]: { class: "stable", symbol: "USDC" },
  [PAIR_TOKEN.stock]: { class: "stock", symbol: "TSLA" },
  [PAIR_TOKEN.other]: { class: "other", symbol: "WHATEVER" },
};

function bodyFor(input: VectorCase["input"]) {
  const pairToken: string =
    (PAIR_TOKEN as Record<string, string | undefined>)[input.pairClass] ?? PAIR_TOKEN.other;

  const onChain: LaunchedToken = {
    exists: true,
    curve: CURVE,
    pairToken,
    graduationThresholdWei: "4200000000000000000",
    creatorTaxBps: input.taxBps,
    phase: input.phase,
  };

  const launch: LaunchRow | null =
    input.indexed && input.elapsedSeconds !== null
      ? {
          token: ADDRESS,
          curve: "0xf6e86610771ee7838cabe2f9c376265ca25ef04c",
          pair_token: pairToken,
          pair_class: input.pairClass,
          creator_tax_bps: input.taxBps,
          block: 56_172_001,
          ts: NOW_SECONDS - (input.elapsedSeconds as number),
        }
      : null;

  const graduation: GraduationRow | null = input.graduated
    ? { token: ADDRESS, block: 56_172_100, ts: NOW_SECONDS }
    : null;

  return buildTokenBody({
    address: ADDRESS,
    nowSeconds: NOW_SECONDS,
    onChain,
    launch,
    graduation,
    cursor: {
      last_indexed_block: 56_172_588,
      last_success_at: NOW_SECONDS - 20,
      consecutive_failures: 0,
    },
    numberFile: NUMBER,
    pairTokens: PAIR_TOKENS,
    fill: null,
    pairDecimals: 18,
    siteOrigin: "https://ledge.tools",
  });
}

describe.skipIf(!PRESENT)("the vector gate", () => {
  it("reads the file Python generated, from the fixture Python froze", () => {
    expect(VECTORS.numberFile).toBe("tests/vectors/fixture-number.json");
    expect(VECTORS.crawledAt).toBe(NUMBER.crawledAt);
    expect(VECTORS.cases.length).toBeGreaterThan(0);
  });

  it("agrees with stats.py about where the ladder's steps are", () => {
    expect(NUMBER.allTime.ttg.ladder?.map((s) => s.atSeconds)).toEqual(VECTORS.ladderEdges);
  });

  for (const testCase of VECTORS.cases ?? []) {
    describe(`${testCase.name} — ${testCase.why}`, () => {
      const body = bodyFor(testCase.input);

      it("produces the cohort object Python wrote", () => {
        expect(body.cohort).toEqual(testCase.expected.cohort);
      });

      it("produces the placement object Python wrote", () => {
        expect(body.placement).toEqual(testCase.expected.placement);
      });

      it("produces the sentence Python wrote", () => {
        expect(headline(body, OBSERVED_MAX)).toBe(testCase.expected.text.headline);
      });

      it("says the same thing about the placement in running text", () => {
        const rendered = lookupText(body, OBSERVED_MAX);
        if (testCase.expected.text.placement === null) {
          expect(rendered).not.toContain("had already happened");
        } else {
          expect(rendered).toContain(testCase.expected.text.placement);
        }
      });
    });
  }
});

/* The gate is only worth having if it can fail. */
describe.skipIf(!PRESENT)("the gate detects a drift", () => {
  const drifted = (VECTORS.cases ?? []).find((c) => c.name === "elapsed-between-rungs")!;

  it("notices a Worker that derived a share instead of reading one", () => {
    const body = bodyFor(drifted.input);
    const tampered = {
      ...body,
      placement: body.placement && { ...body.placement, rung: { atSeconds: 900, cumulative: 1, cumulativeShare: 0.5 } },
    };
    expect(tampered.placement).not.toEqual(drifted.expected.placement);
  });

  it("notices a Worker that printed a rate without its denominator", () => {
    const body = bodyFor(drifted.input);
    expect(headline(body, OBSERVED_MAX)).toContain("(n=");
  });
});

describe.skipIf(PRESENT)("the vector gate", () => {
  it.skip(ABSENT_MESSAGE, () => {});
});
