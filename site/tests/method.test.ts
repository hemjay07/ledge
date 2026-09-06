import { describe, expect, it } from "vitest";
import { methodHtml } from "../lib/method";

/* W16b: METHOD.md is rendered inside a ledger entry whose heading is the page's
   <h2>. Its own `##` sections are one level below that, not siblings of it, so
   an <h2> inside that entry would put the definitions at the same level as the
   entry containing them. */
describe("the definitions rendered from METHOD.md", () => {
  const html = methodHtml();

  it("opens its sections one level below the entry heading", () => {
    expect(html).toContain("<h3>Definitions</h3>");
    expect(html).toContain("<h3>Freshness</h3>");
  });

  it("emits no heading that would collide with the entry's own", () => {
    expect(html).not.toMatch(/<h[12][\s>]/);
  });

  it("still renders the inline markup inside a heading", () => {
    expect(html).toMatch(/<h3>Cohorts \(all with n; n &lt; 30 renders as/);
  });
});
