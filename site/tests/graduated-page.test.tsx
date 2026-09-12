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
     the 1.31 MB defect this pagination fixes (REVAMP.md). The default sort
     became most-recently-graduated on 2026-09-12 (REVAMP.md "the
     amendment"), so the build-time slice is the newest rows, not the
     fastest-first slice public/graduated.json is generated in -- the
     assertion below follows that change rather than asserting against
     graduatedFile.rows[0], which is the FASTEST row and is not guaranteed to
     be among the newest 50. */
  it("renders only the first page (50 rows) at build time, most-recently-graduated first, with the duration visible on every row and the true total stated", () => {
    const { container } = render(<Graduated />);
    const rows = container.querySelectorAll(".graduated-table-wrap tbody tr");
    expect(rows).toHaveLength(Math.min(PAGE_SIZE, graduatedFile.rows.length));

    const newestFirst = [...graduatedFile.rows].sort(
      (a, b) => Date.parse(b.graduatedAt) - Date.parse(a.graduatedAt),
    );
    if (newestFirst[0]) {
      expect(container.textContent).toContain(formatDuration(newestFirst[0].durationSeconds));
    }
    expect(container.textContent).toContain(formatCount(graduatedFile.rows.length));
  });

  it("carries no per-token score, grade, or verdict vocabulary", () => {
    const { container } = render(<Graduated />);
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of ["score", "grade", "rigged", "’s a scam", "risky", "safe bet"]) {
      expect(text).not.toContain(banned);
    }
  });
});
