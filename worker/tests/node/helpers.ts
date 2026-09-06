import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildTokenBody, type BuildInput, type LaunchRow } from "../../src/lookup";
import type { NumberFile } from "../../src/numberFile";
import type { LaunchedToken } from "../../src/pons";
import type { TokenResponse } from "../../src/schema";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const WORKER_ROOT = join(HERE, "..", "..");
export const REPO_ROOT = join(WORKER_ROOT, "..");

export function fixtureNumber(): NumberFile {
  return JSON.parse(
    readFileSync(join(WORKER_ROOT, "tests", "fixtures", "number.json"), "utf8"),
  ) as NumberFile;
}

export const ADDRESS = "0x23fe54b3bf9e1d2816822043c0b02b6a12f98fe2";
/** This launch's own curve. There is no shared curve. */
export const CURVE = "0xf6e86610771ee7838cabe2f9c376265ca25ef04c";
export const NOW_SECONDS = 1788718447; // fixed clock: the tests must not drift

export const ON_CHAIN: LaunchedToken = {
  exists: true,
  curve: CURVE,
  pairToken: "0x0000000000000000000000000000000000000000",
  graduationThresholdWei: "4200000000000000000",
  creatorTaxBps: 300,
  phase: 0,
};

export const LAUNCH: LaunchRow = {
  token: ADDRESS,
  curve: CURVE,
  pair_token: "0x0000000000000000000000000000000000000000",
  pair_class: "eth",
  creator_tax_bps: 300,
  block: 56172001,
  ts: NOW_SECONDS - 811,
};

export function makeBody(overrides: Partial<BuildInput> = {}): Omit<TokenResponse, "text"> {
  return buildTokenBody({
    address: ADDRESS,
    nowSeconds: NOW_SECONDS,
    onChain: ON_CHAIN,
    launch: LAUNCH,
    graduation: null,
    cursor: { last_indexed_block: 56172588, last_success_at: NOW_SECONDS - 20, consecutive_failures: 0 },
    numberFile: fixtureNumber(),
    pairTokens: null,
    fill: null,
    pairDecimals: 18,
    siteOrigin: "https://ledge.tools",
    ...overrides,
  });
}
