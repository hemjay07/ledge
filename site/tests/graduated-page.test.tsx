import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Graduated from "../app/graduated/page";
import { allTime } from "../lib/number";
import { graduatedFile } from "../lib/graduated";
import { PAGE_SIZE } from "../lib/paginate";
import { formatCount, formatDuration, rateText } from "../lib/format";

/* Structural assertions only, derived through the same live imports and the
   same formatters the page itself renders with (the technique
   landing-structure.test.tsx already uses for h24) -- never a hardcoded
   figure, so a re-run of the pipeline or a rebuild of public/graduated.json
   cannot break this suite by moving a number. Exact-value behaviour of the
   join and the schema is covered, against frozen fixtures, in
   graduated-core.test.ts, graduated-schema.test.ts and graduated-board.test.tsx. */

afterEach(() => cleanup());

describe("the /graduated page's structure", () => {
  it("carries the ladder from number.json, with its n, as context", () => {
    const { container } = render(<Graduated />);
    const text = container.textContent ?? "";
    const { ttg } = allTime;

    if (ttg.insufficient || ttg.n < 30) {
      expect(text).toContain(`not enough data (n=${formatCount(ttg.n)})`);
      return;
    }

    expect(text).toContain(`n = ${formatCount(ttg.n)}`);
    for (const rung of ttg.ladder) {
      const share = rateText({ rate: rung.cumulativeShare, n: ttg.n, insufficient: ttg.insufficient });
      expect(text).toContain(formatCount(rung.cumulative));
      expect(text).toContain(share);
    }
  });

  it("says plainly how many graduations were excluded for having no launch on record", () => {
    const { container } = render(<Graduated />);
    const text = container.textContent ?? "";
    expect(text).toContain(formatCount(graduatedFile.excludedNoLaunch));
    expect(text).toContain("no launch is on record");
  });

  /* Only the first page ships in the HTML -- 2,500+ rows in one document was
     the 1.31 MB defect this pagination fixes (REVAMP.md). The page states
     its own slice against the true total rather than rendering every row;
     the assertion below follows that change rather than the old "every row
     renders" behaviour it replaces, which is now the thing under test as a
     regression, not the guarantee. */
  it("renders only the first page (50 rows) at build time, with the duration visible on every row and the true total stated", () => {
    const { container } = render(<Graduated />);
    const rows = container.querySelectorAll(".graduated-board tbody tr");
    expect(rows).toHaveLength(Math.min(PAGE_SIZE, graduatedFile.rows.length));
    if (graduatedFile.rows[0]) {
      expect(container.textContent).toContain(formatDuration(graduatedFile.rows[0].durationSeconds));
    }
    expect(container.textContent).toContain(formatCount(graduatedFile.rows.length));
  });

  it("registers /graduated in the sheet's own index", () => {
    const { container } = render(<Graduated />);
    const nav = container.querySelector('nav[aria-label="Sheet"]');
    expect(nav).not.toBeNull();
    // the current page is never linked to itself
    expect(nav?.querySelector('a[href="/graduated"]')).toBeNull();
    expect(nav?.querySelector('a[href="/live"]')).not.toBeNull();
  });

  it("carries no per-token score, grade, or verdict vocabulary", () => {
    const { container } = render(<Graduated />);
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of ["score", "grade", "rigged", "’s a scam", "risky", "safe bet"]) {
      expect(text).not.toContain(banned);
    }
  });
});
