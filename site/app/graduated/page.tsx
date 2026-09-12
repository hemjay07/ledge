import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Footer } from "../../components/Footer";
import { GraduatedBoard } from "../../components/Graduated";
import { StaleBanner } from "../../components/StaleBanner";
import { graduatedFile } from "../../lib/graduated";
import { numberFile } from "../../lib/number";
import { PAGE_SIZE } from "../../lib/paginate";

const { crawledAt, staleAfterSeconds } = numberFile;

export const metadata: Metadata = {
  title: "Graduated — LEDGE",
  description:
    "Every Pons graduation, ranked by how long it took to graduate. No score, no grade, no verdict — the duration is the finding.",
};

/* Only the first page ships in the HTML (REVAMP.md pagination).
   graduatedFile.rows is generated fastest-first by
   scripts/generate-graduated.mjs, but GraduatedBoard's own default sort is
   now most-recently-graduated (the 2026-09-12 boards amendment: a visitor
   here wants what just happened) -- so the build-time slice is re-sorted to
   match that default here, once, rather than shipping a fastest-first page
   under a "most recent" heading. Any other sort, filter or page fetches the
   rest from /graduated.json on demand (components/Graduated.tsx). */
const initialRows = [...graduatedFile.rows]
  .sort((a, b) => Date.parse(b.graduatedAt) - Date.parse(a.graduatedAt))
  .slice(0, PAGE_SIZE);

export default function Graduated(): ReactElement {
  return (
    <>
      <StaleBanner crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />

      <main className="sheet">
        <GraduatedBoard
          initialRows={initialRows}
          totalCount={graduatedFile.rows.length}
          generatedAt={graduatedFile.generatedAt}
          staleAfterSeconds={graduatedFile.staleAfterSeconds}
          totalGraduationRows={graduatedFile.totalGraduationRows}
          excludedNoLaunch={graduatedFile.excludedNoLaunch}
          excludedUnmatched={graduatedFile.excludedUnmatched}
        />
        <Footer />
      </main>
    </>
  );
}
