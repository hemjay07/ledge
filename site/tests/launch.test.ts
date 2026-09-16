import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLaunch } from "../lib/launch";
import { preregistrationHtml } from "../lib/method";

describe("LEDGE's own launch file", () => {
  it("is absent, not invented, without the file", () => {
    expect(readLaunch(mkdtempSync(join(tmpdir(), "launch-")))).toBeNull();
  });

  it("reads the committed file and refuses a malformed address", () => {
    const dir = mkdtempSync(join(tmpdir(), "launch-"));
    writeFileSync(join(dir, "launch.json"), JSON.stringify({ address: "0xnope", launchAt: null, preregistrationCommit: "5b70689", preregistrationCommittedOn: "2026-09-12" }));
    expect(() => readLaunch(dir)).toThrow(/launch.json/);
    writeFileSync(join(dir, "launch.json"), JSON.stringify({ address: null, launchAt: null, preregistrationCommit: "5b70689", preregistrationCommittedOn: "2026-09-12" }));
    expect(readLaunch(dir)?.preregistrationCommit).toBe("5b70689");
  });

  it("renders the pre-registration with its commitments and its Outcome heading", () => {
    const html = preregistrationHtml();
    expect(html).toContain("<h3>What we commit to, checkable by anyone</h3>");
    expect(html).toContain("<h3>Outcome</h3>");
    expect(html).not.toMatch(/<h[12][\s>]/);
  });
});
