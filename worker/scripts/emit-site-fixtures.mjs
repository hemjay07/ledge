#!/usr/bin/env node
/* Regenerates site/tests/api-fixtures/*.json from the Worker's OWN builder.

   The site renders the API's sentences verbatim, so its tests have to assert
   against what the API actually sends. Hand-written fixtures would be a guess
   at that, and a guess drifts silently the moment a word in text.ts changes —
   which is exactly what happened to the fill sentence and the placement
   fallback.

   So: esbuild bundles worker/src/{lookup,text,schema}.ts into one ESM module,
   this imports it, builds each case from fixed inputs, validates the result
   against the Worker's own zod schema, and writes it out. No network, a frozen
   clock, and the same frozen number.json the Worker's suite uses.

   Run from worker/:  node scripts/emit-site-fixtures.mjs
*/

import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, "..");
const REPO = join(WORKER, "..");
const OUT = join(REPO, "site", "tests", "api-fixtures");

const NUMBER = JSON.parse(
  readFileSync(join(WORKER, "tests", "fixtures", "number.json"), "utf8"),
);

/* A frozen clock. Every timestamp below is derived from it, so a regenerated
   fixture differs from its predecessor only where the code changed. */
const OBSERVED_AT = "2026-09-06T18:14:07Z";
const NOW = Math.floor(Date.parse(OBSERVED_AT) / 1000);
const LAUNCHED_AT = "2026-09-06T18:00:36Z";
const ELAPSED = NOW - Math.floor(Date.parse(LAUNCHED_AT) / 1000);

const ADDRESS = "0x23fe54b3bf9e1d2816822043c0b02b6a12f98fe2";
const ZERO = "0x0000000000000000000000000000000000000000";
const LAST_INDEXED_BLOCK = 56_172_588;
const FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const SITE = "https://ledge.tools";

const ON_CHAIN = {
  exists: true,
  curve: "0xd2414346044d5b597a14f2dd48175cdf0efd642a",
  pairToken: ZERO,
  graduationThresholdWei: "4200000000000000000",
  creatorTaxBps: 300,
  phase: 0,
};

const LAUNCH = {
  token: ADDRESS,
  curve: ON_CHAIN.curve,
  pair_token: ZERO,
  pair_class: "eth",
  creator_tax_bps: 300,
  block: 56_172_001,
  ts: NOW - ELAPSED,
};

const FILL = {
  filledWei: "1743200000000000000",
  thresholdWei: "4200000000000000000",
  share: 0.415048,
  note: null,
};

const PAIR_TOKENS = { [ZERO]: { class: "eth", symbol: "ETH" } };

/* One token's folded curve activity, as the tick would have written it: the
   counts opening at the launch block, and the distinct buyers in that block. */
const ACTIVITY = {
  token: ADDRESS,
  from_block: LAUNCH.block,
  buys: 41,
  sells: 12,
  quote_in: "1743200000000000000",
  quote_out: "220000000000000000",
  first_buy_ts: NOW - ELAPSED + 4,
  last_activity_ts: NOW - 40,
  first_block_buyers: 7,
};

const cursor = (lastSuccessSecondsAgo) => ({
  last_indexed_block: LAST_INDEXED_BLOCK,
  last_success_at: NOW - lastSuccessSecondsAgo,
  consecutive_failures: 0,
});

/** number.json with every pairTax cell short of the gate. */
function insufficientNumber() {
  const file = structuredClone(NUMBER);
  for (const w of [file.h24, file.allTime]) {
    w.ttg = { ...w.ttg, n: 12, insufficient: true };
    w.cohorts.pairTax = w.cohorts.pairTax.map((row) => ({
      ...row,
      launches: 12,
      graduations: 0,
      rate: null,
      insufficient: true,
      excludingFast: {
        ...row.excludingFast,
        graduations: 0,
        rate: null,
        oneIn: null,
        insufficient: true,
      },
    }));
  }
  return file;
}

async function bundled() {
  const dir = mkdtempSync(join(tmpdir(), "ledge-fixtures-"));
  const outfile = join(dir, "worker.mjs");
  await build({
    entryPoints: [join(dir, "entry.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile,
    stdin: undefined,
    absWorkingDir: WORKER,
    plugins: [
      {
        name: "entry",
        setup(b) {
          b.onResolve({ filter: /entry\.ts$/ }, (args) => ({ path: args.path, namespace: "entry" }));
          b.onLoad({ filter: /.*/, namespace: "entry" }, () => ({
            contents: `
              export { buildTokenBody } from "${join(WORKER, "src", "lookup.ts").replace(/\\/g, "/")}";
              export { lookupText } from "${join(WORKER, "src", "text.ts").replace(/\\/g, "/")}";
              export { tokenResponseSchema, liveResponseSchema } from "${join(WORKER, "src", "schema.ts").replace(/\\/g, "/")}";
              export { buildBoardRows } from "${join(WORKER, "src", "board.ts").replace(/\\/g, "/")}";
            `,
            resolveDir: WORKER,
            loader: "ts",
          }));
        },
      },
    ],
  });
  const mod = await import(pathToFileURL(outfile).href);
  return { mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function write(name, value) {
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(value, null, 2) + "\n");
  console.log(`  ${name}.json`);
}

const { mod, cleanup } = await bundled();
const { buildTokenBody, lookupText, tokenResponseSchema, liveResponseSchema, buildBoardRows } = mod;

function response({
  launch = LAUNCH,
  numberFile = NUMBER,
  cursorRow = cursor(20),
  fill = FILL,
  activity = ACTIVITY,
}) {
  const body = buildTokenBody({
    address: ADDRESS,
    nowSeconds: NOW,
    onChain: ON_CHAIN,
    launch,
    graduation: null,
    cursor: cursorRow,
    numberFile,
    pairTokens: PAIR_TOKENS,
    fill,
    pairDecimals: 18,
    activity,
    siteOrigin: SITE,
  });
  const payload = { ...body, text: lookupText(body, numberFile?.allTime.ttg.max ?? null) };
  const parsed = tokenResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("a fixture failed the Worker's own schema: " + JSON.stringify(parsed.error.issues));
  }
  return payload;
}

console.log("writing site/tests/api-fixtures:");

write("token-ok", response({}));
write("token-insufficient", response({ numberFile: insufficientNumber() }));
write("token-stale", response({ cursorRow: cursor(3980) }));
write("token-not-indexed", {
  schemaVersion: 1,
  error: "not_indexed",
  message: "Launched more than 7 days ago, or LEDGE has not reached this block yet.",
  lastIndexedBlock: LAST_INDEXED_BLOCK,
  /* No launch row means no curve mapping, and retention keeps the two
     together: a token LEDGE cannot place has no activity row either. */
  partial: response({ launch: null, activity: null }),
});
write("token-number-unavailable", {
  schemaVersion: 1,
  error: "number_unavailable",
  message: "Cohort figures are not loadable. Live state is shown alone.",
  partial: response({ numberFile: null }),
});

/* One token per row, as board.ts's own builder would assemble them from D1:
   the fixture drives the Worker's real code rather than a hand-typed guess
   at its shape, for the same reason every other fixture here does. */
const BOARD_DB_ROWS = [
  {
    token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    pair_class: "eth",
    pair_token: ZERO,
    creator_tax_bps: 0,
    graduation_threshold: "4200000000000000000",
    block: LAST_INDEXED_BLOCK - 41,
    ts: NOW - 41,
    graduated: 0,
    from_block: LAST_INDEXED_BLOCK - 41,
    buys: 41,
    sells: 12,
    quote_in: "1743200000000000000",
    quote_out: "220000000000000000",
    first_block_buyers: 7,
    last_activity_ts: NOW - 5,
  },
  {
    token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    pair_class: "eth",
    pair_token: ZERO,
    creator_tax_bps: 300,
    graduation_threshold: "4200000000000000000",
    block: LAST_INDEXED_BLOCK - 190,
    ts: NOW - 190,
    graduated: 0,
    from_block: LAST_INDEXED_BLOCK - 190,
    buys: 6,
    sells: 1,
    quote_in: "300000000000000000",
    quote_out: "0",
    first_block_buyers: 2,
    last_activity_ts: NOW - 60,
  },
  {
    token: "0xcccccccccccccccccccccccccccccccccccccccc",
    pair_class: "stable",
    pair_token: "0x1111111111111111111111111111111111111111",
    creator_tax_bps: 100,
    graduation_threshold: "8090000000",
    block: LAST_INDEXED_BLOCK - 900,
    ts: NOW - 900,
    graduated: 1,
    from_block: LAST_INDEXED_BLOCK - 900,
    buys: 88,
    sells: 40,
    quote_in: "8500000000",
    quote_out: "410000000",
    first_block_buyers: 14,
    last_activity_ts: NOW - 300,
  },
  {
    /* Enrichment failed for this one: no tax bucket, no threshold, no fill --
       and its own launch block predates what the index holds, so its window
       is partial. */
    token: "0xdddddddddddddddddddddddddddddddddddddddd",
    pair_class: "other",
    pair_token: "0x2222222222222222222222222222222222222222",
    creator_tax_bps: null,
    graduation_threshold: null,
    block: LAST_INDEXED_BLOCK - 4200,
    ts: NOW - 4200,
    graduated: 0,
    from_block: LAST_INDEXED_BLOCK - 4100,
    buys: 3,
    sells: 0,
    quote_in: "40000000000000000",
    quote_out: "0",
    first_block_buyers: null,
    last_activity_ts: NOW - 3900,
  },
];

const boardRows = buildBoardRows(
  BOARD_DB_ROWS,
  { last_indexed_block: LAST_INDEXED_BLOCK, last_success_at: NOW - 20, consecutive_failures: 0 },
  NOW,
  "lastActivity",
);

const live = {
  schemaVersion: 1,
  observedAt: OBSERVED_AT,
  lastIndexedBlock: LAST_INDEXED_BLOCK,
  sortedBy: "lastActivity",
  count: boardRows.length,
  rows: boardRows,
  live: { stale: false, lastSuccessAt: "2026-09-06T18:13:47Z", lastIndexedBlock: LAST_INDEXED_BLOCK },
};
if (!liveResponseSchema.safeParse(live).success) throw new Error("the live fixture fails its own schema");
write("live-ok", live);

write("error-bad-address", {
  schemaVersion: 1,
  error: "bad_address",
  message: "Not a 20-byte hex address.",
});
write("error-not-a-pons-token", {
  schemaVersion: 1,
  error: "not_a_pons_token",
  message: `This address was not launched by the Pons factory ${FACTORY}.`,
  factory: FACTORY,
});
write("error-rpc-down", {
  schemaVersion: 1,
  error: "rpc_down",
  message: "The chain RPC did not answer. Nothing is being estimated.",
  retryAfterSeconds: 30,
});

cleanup();
console.log("done");
