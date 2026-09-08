import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Age } from "../../components/Age";
import { ColophonStrip, RunningHead } from "../../components/ColophonStrip";
import { ConfigGrid, type GridWindow } from "../../components/ConfigGrid";
import { Footer } from "../../components/Footer";
import { LedgerEntry } from "../../components/LedgerEntry";
import { SheetNav } from "../../components/SheetNav";
import { allTime, h24, numberFile, type WindowData } from "../../lib/number";
import { formatCount, formatDurationLong, formatStamp } from "../../lib/format";
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

/* The grid's size is read off the file rather than typed into the copy: a
   bucket boundary that moves changes the count, and a page that says 20 while
   printing 25 is a page whose own denominator is wrong. */
const cells = allTime.cohorts.pairTax.length;

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
    caption: `Launches and graduations by pair token and creator tax, ${label}. Printed pair token first, then creator tax ascending.`,
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
      <SheetNav current="cockpit" />
      <RunningHead mark="LEDGE · CONFIGURATIONS" win={`${formatCount(cells)} cells · 01`} />

      <div className="fold" style={{ paddingBottom: "1.5rem" }}>
        <h1 className="kicker">Configurations</h1>
        <p className="lede" style={{ marginTop: "0.5rem" }}>
          Every pair token and creator tax a Pons launch has been made with, crossed —{" "}
          {formatCount(cells)} cells, each carrying the launches it was counted over. A cell under
          n&nbsp;=&nbsp;30 prints its sample size instead of a percentage.
        </p>
        {allTimeIsSameMeasurement ? <p className="note">{SAME_MEASUREMENT_NOTE}</p> : null}
        <p className="note">
          <Age crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />
        </p>
      </div>
      <ColophonStrip stamp={formatStamp(crawledAt)} />

      <LedgerEntry folio="02" id="h-what" heading="What these are">
        <p className="lede">
          A configuration is the pair token a launch is priced against and the creator tax set at
          launch. Each row counts every indexed launch made with that configuration and how many
          graduated. The second rate excludes graduations that completed inside {cutoffWords}.
          These are counts of launches already recorded; they describe that population, not any
          launch not yet made.
        </p>
      </LedgerEntry>

      <ConfigGrid folio="03" windows={WINDOWS} crawledAt={crawledAt} />

      <Footer />
    </main>
  );
}
