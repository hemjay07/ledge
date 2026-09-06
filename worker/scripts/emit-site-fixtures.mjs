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
const { buildTokenBody, lookupText, tokenResponseSchema, liveResponseSchema } = mod;

function response({ launch = LAUNCH, numberFile = NUMBER, cursorRow = cursor(20), fill = FILL }) {
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
  partial: response({ launch: null }),
});
write("token-number-unavailable", {
  schemaVersion: 1,
  error: "number_unavailable",
  message: "Cohort figures are not loadable. Live state is shown alone.",
  partial: response({ numberFile: null }),
});

const live = {
  schemaVersion: 1,
  observedAt: OBSERVED_AT,
  lastIndexedBlock: LAST_INDEXED_BLOCK,
  count: 4,
  rows: [
    { pairClass: "eth", taxBucket: "0%", ageSeconds: 41, graduated: false },
    { pairClass: "eth", taxBucket: "2-3%", ageSeconds: 190, graduated: false },
    { pairClass: "stable", taxBucket: "1%", ageSeconds: 900, graduated: true },
    { pairClass: "other", taxBucket: null, ageSeconds: 4200, graduated: false },
  ],
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
