#!/usr/bin/env node
/* data/launches/*.jsonl(.gz) + data/graduations/*.jsonl(.gz) -> public/graduated.json,
   at build time, with no network access — the same posture as copy-number.mjs.

   Built statically for two reasons (TASK, REPOSITION.md build order C): it
   must survive a launch-day traffic spike with no API dependency, and D1 only
   retains 7 days while the repo holds the whole record.

   Every duration here is a per-token fact (Class B): one graduation minus its
   own launch, no denominator. Nothing in this file computes a share, a rate,
   or a percentage over the population — those come from data/number.json,
   gated at n = 30 by pipeline/recompute.py, and this script does not touch
   that gate or that file. */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { joinGraduations } from "./graduated-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const launchesDir = join(repoRoot, "data", "launches");
const graduationsDir = join(repoRoot, "data", "graduations");
const dest = join(here, "..", "public", "graduated.json");

/* Matches the site's existing default (numberFile.staleAfterSeconds): the raw
   files this script reads are the same data/ directory pipeline/recompute.py
   crawls, so the row list is held to the same freshness bound as the rest of
   the sheet rather than inventing a second number nobody chose. */
const STALE_AFTER_SECONDS = 7200;

function readJsonlDir(dir) {
  const rows = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const buffer = readFileSync(path);
    const text = (name.endsWith(".gz") ? gunzipSync(buffer) : buffer).toString("utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      rows.push(JSON.parse(trimmed));
    }
  }
  return rows;
}

const launches = readJsonlDir(launchesDir);
const graduations = readJsonlDir(graduationsDir);
const { rows, excludedNoLaunch, excludedUnmatched, totalGraduationRows } = joinGraduations(
  launches,
  graduations,
);

const out = {
  generatedAt: new Date().toISOString(),
  staleAfterSeconds: STALE_AFTER_SECONDS,
  totalGraduationRows,
  excludedNoLaunch,
  excludedUnmatched,
  rows,
};

mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out));

console.log(
  `generate-graduated: ${rows.length} rows, ${excludedNoLaunch} excluded (no launch on record), ` +
    `${excludedUnmatched} excluded (unmatched join) of ${totalGraduationRows} graduation records -> public/graduated.json`,
);
