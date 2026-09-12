import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Age } from "../../components/Age";
import { ConfigGrid, type GridWindow } from "../../components/ConfigGrid";
import { Footer } from "../../components/Footer";
import { allTime, h24, numberFile, type WindowData } from "../../lib/number";
import { formatCount, formatDurationLong } from "../../lib/format";
import { SAME_MEASUREMENT_NOTE, sameMeasurement } from "../../lib/windows";

const { crawledAt, staleAfterSeconds } = numberFile;

export const metadata: Metadata = {
  title: "Configurations — LEDGE",
  description:
    "The graduation rate of every pair token and creator tax combination Pons launches have used, in both windows, each cell with the number of launches it was counted from.",
};

/* While the all-time window holds exactly the launches the 24-hour window
   holds, the second grid would print the first one cell for cell. One
   measurement rendered twice reads as two measurements agreeing. Keyed off the
   data, so the second window returns on its own once history is indexed. */
const allTimeIsSameMeasurement = sameMeasurement(h24, allTime);

const cutoffWords = formatDurationLong(allTime.excludingFast.cutoffSeconds);

/* Nothing is said when nothing was excluded: the All footing already
   reconciles the cells against the population. */
function excludedNote(w: WindowData): string | null {
  const n = w.cohortsExcluded.pairTax;
  if (n === 0) return null;
  return n === 1
    ? "One launch has no cell because the factory read failed. It still counts in the All row."
    : `${formatCount(n)} launches have no cell because the factory read failed. They still count in the All row.`;
}

function grid(w: WindowData, key: string, label: string, folio: string, heading: string): GridWindow {
  return {
    key,
    label,
    folio,
    heading,
    headingNote: `· ${label} · n = ${formatCount(w.launches)} launches`,
    caption: `Share of launches that graduated, by pair token and creator tax, ${label}. Cells under n = 30 show their n.`,
    ariaLabel: `Graduations by pair token and creator tax, ${label}`,
    note: excludedNote(w),
    rows: w.cohorts.pairTax,
    total: {
      launches: w.launches,
      graduations: w.graduations,
      rate: w.rate,
      insufficient: w.insufficient,
      excludingFast: {
        graduations: w.excludingFast.graduations,
        rate: w.excludingFast.rate,
        oneIn: w.excludingFast.oneIn,
        insufficient: w.excludingFast.insufficient,
      },
    },
  };
}

const WINDOWS: GridWindow[] = allTimeIsSameMeasurement
  ? [grid(allTime, "all", "all-time", "04", "All-time")]
  : [
      grid(allTime, "all", "all-time", "04", "All-time"),
      grid(h24, "h24", "24 h", "05", "Trailing 24 hours"),
    ];

export default function Cockpit(): ReactElement {
  return (
    <main className="sheet">
      <div className="card">
        <div className="card-header">
          <h1 className="kicker card-kicker">PAIR × TAX</h1>
          <Age crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />
        </div>

        {allTimeIsSameMeasurement ? <p className="note">{SAME_MEASUREMENT_NOTE}</p> : null}

        {/* The grid, exactly as ConfigGrid renders it: every pair token and
            creator tax combination crossed for both published windows, the
            whole population printed, one picker that marks a row across
            every window at once rather than filtering anything away.
            ConfigGrid is out of this pass's scope (only the four page files
            and their CSS/tests) — its own window-by-window layout is "the
            grid as it is". */}
        <ConfigGrid folio="02" windows={WINDOWS} crawledAt={crawledAt} />

        <details className="board-what-counts">
          <summary>How this is counted</summary>
          <div>
            <p id="h-what" className="lede">
              A configuration is the pair token a launch is priced against and the creator tax set at
              launch. Each row counts every indexed launch made with that configuration and how many
              graduated. The second rate excludes graduations that completed inside {cutoffWords}.
              These are counts of launches already recorded; they describe that population, not any
              launch not yet made.
            </p>
          </div>
        </details>
      </div>

      <Footer />
    </main>
  );
}
