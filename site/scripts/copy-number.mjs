#!/usr/bin/env node
/* data/number.json -> public/number.json, byte for byte.
   The published endpoint and the committed measurement are the same file. */

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "data", "number.json");
const dest = join(here, "..", "public", "number.json");

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);

const a = readFileSync(src);
const b = readFileSync(dest);
if (!a.equals(b)) {
  throw new Error("copy-number: public/number.json is not byte-identical to data/number.json");
}

console.log(`copy-number: ${a.byteLength} bytes -> public/number.json`);
