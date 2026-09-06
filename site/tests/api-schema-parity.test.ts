import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* site/lib/api-schema.ts is a copy of worker/src/schema.ts, because a static
   export cannot import across the repo boundary without dragging the Worker's
   own zod and tsconfig into the build. A copy that nothing checks is a copy
   that stops being one, so this diffs the two files.

   If this fails, the fix is to re-copy the Worker's file under the same banner
   — never to edit the site's copy into agreement, which would leave the site
   rendering a shape the API does not send. */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const WORKER = readFileSync(join(REPO, "worker", "src", "schema.ts"), "utf8");
const SITE = readFileSync(join(REPO, "site", "lib", "api-schema.ts"), "utf8");

/** Everything from the zod import on: the site's copy carries its own banner
    and the Worker's carries a different one, and a header comment is not part
    of the contract. */
function body(source: string): string {
  const at = source.indexOf('import { z } from "zod";');
  if (at < 0) throw new Error("neither file is a zod schema any more");
  return source.slice(at).trimEnd();
}

/** Every field name declared in the schema, plus every error code, plus every
    exported name. This is the contract's surface: a field renamed, added or
    dropped on either side lands in this set. */
function keys(source: string): string[] {
  const text = body(source);
  const fields = [...text.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):\s*z\./gm)].map(
    (m) => `field ${m[1]}`,
  );
  const codes = [...text.matchAll(/"([a-z_]+)",?\s*(?=\n|\])/g)].map((m) => `code ${m[1]}`);
  const exported = [...text.matchAll(/^export (?:const|type) ([A-Za-z0-9_]+)/gm)].map(
    (m) => `export ${m[1]}`,
  );
  return [...new Set([...fields, ...codes, ...exported])].sort();
}

describe("the response contract, on both sides of the network", () => {
  it("declares the same fields, codes and exports", () => {
    const worker = keys(WORKER);
    const site = keys(SITE);
    const missing = worker.filter((k) => !site.includes(k));
    const extra = site.filter((k) => !worker.includes(k));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("names the error codes the Worker actually returns", () => {
    for (const code of [
      "bad_address",
      "not_a_pons_token",
      "not_indexed",
      "rpc_down",
      "number_unavailable",
      "rate_limited",
      "not_found",
    ]) {
      expect(keys(SITE)).toContain(`code ${code}`);
    }
  });

  it("is still a copy, character for character, below the banner", () => {
    expect(body(SITE)).toBe(body(WORKER));
  });
});
