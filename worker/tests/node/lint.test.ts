import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { WORKER_ROOT } from "./helpers";

/* Gates 2 and 3 of ARCHITECTURE-PHASE2-4.md section 9, run as tests so they
   fail in the same place everything else fails. scripts/lint-worker.sh runs
   the identical checks in CI for a reviewer reading the workflow. */

const SRC = join(WORKER_ROOT, "src");

function read(file: string): string {
  return readFileSync(join(SRC, file), "utf8");
}

function allSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...allSources(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("gate 2 — the no-arithmetic lint", () => {
  /* These three files may read numbers and format strings, nothing else. The
     check is blunt on purpose: a statistic is defined in pipeline/stats.py or
     it is not defined at all. */
  const GUARDED = ["lookup.ts", "ladder.ts", "text.ts"];
  const BANNED = ["Math.round", "toFixed", " / ", "percentile", "reduce("];

  for (const file of GUARDED) {
    for (const pattern of BANNED) {
      it(`${file} contains no ${JSON.stringify(pattern)}`, () => {
        const lines = read(file).split("\n");
        const hits = lines
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => line.includes(pattern));
        expect(hits, `${file} must not compute: ${JSON.stringify(hits)}`).toEqual([]);
      });
    }
  }

  it("names the exemption in the file that holds the arithmetic", () => {
    expect(read("format.ts")).toContain("REVIEWER NOTE");
  });
});

describe("gate 3 — the key-name lint", () => {
  /* No field, and no sentence, may name a verdict. LEDGE reports what happened
     to a population, in the past tense, with its denominator. */
  const PATTERN = /score|risk|odds|probab|predict|will /i;

  for (const file of ["schema.ts", "text.ts"]) {
    it(`${file} names no verdict`, () => {
      const hits = read(file)
        .split("\n")
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => PATTERN.test(line));
      expect(hits, JSON.stringify(hits)).toEqual([]);
    });
  }

  it("no source file in worker/src names a verdict", () => {
    const hits: string[] = [];
    for (const path of allSources(SRC)) {
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (PATTERN.test(line)) hits.push(`${path}:${i + 1}:${line.trim()}`);
        });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("the pattern itself catches what it is meant to catch", () => {
    for (const bad of ["riskScore", "odds", "probability", "will graduate", "predicted"]) {
      expect(PATTERN.test(bad), bad).toBe(true);
    }
  });
});
