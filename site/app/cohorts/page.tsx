import type { Metadata } from "next";
import type { ReactElement } from "react";
import Link from "next/link";
import { Age } from "../../components/Age";
import { ColophonStrip, RunningHead } from "../../components/ColophonStrip";
import { Footer } from "../../components/Footer";
import { LedgerEntry } from "../../components/LedgerEntry";
import { Register } from "../../components/Register";
import { allTime, h24, numberFile, type WindowData } from "../../lib/number";
import {
  formatCount,
  formatStamp,
  histogramLabel,
  hourLabel,
  pairLabel,
  taxLabel,
} from "../../lib/format";
import { COHORT_COLUMNS, cohortFooting, cohortRegisterRow, shareCell } from "../../lib/rows";

const { crawledAt, staleAfterSeconds } = numberFile;

export const metadata: Metadata = {
  title: "Cohorts — LEDGE",
  description:
    "Every cohort of the Pons Number in full: pair token, creator tax, hour of day, day of week, and the launches-per-deployer distribution, each with its sample size.",
};

const WINDOWS: { key: string; window: WindowData; label: string; note: string }[] = [
  {
    key: "h24",
    window: h24,
    label: "24 h",
    note: "Trailing 24 hours from the last measurement.",
  },
  {
    key: "all",
    window: allTime,
    label: "all-time",
    note: "Every launch since the first block indexed.",
  },
];

function cohortTables(w: WindowData, label: string, folioBase: number): ReactElement[] {
  const n = `· ${label} · n = ${formatCount(w.launches)} launches`;
  const folio = (i: number) => String(folioBase + i).padStart(2, "0");
  const distinct = w.deployers.distinct;

  /* An hour that recorded nothing has nothing to read: 21 consecutive rows of
     "not enough data (n=0)" bury the three that carry launches. The empty
     buckets are counted in the note instead of listed, so the population is
     still reconcilable against the All footing and nothing is hidden. */
  const observedHours = w.cohorts.hour.filter((r) => r.launches > 0);
  const emptyHours = w.cohorts.hour.length - observedHours.length;
  const emptyHoursNote =
    emptyHours === 0 ? "" : `${formatCount(emptyHours)} hours with n = 0 — not listed. `;

  return [
    <Register
      key="pair"
      folio={folio(0)}
      heading="By pair token"
      headingId={`h-pair-${label}`}
      headingNote={n}
      ariaLabel={`Graduation rate by pair token, ${label}`}
      caption="Graduations of launches, by the token the pool is paired against."
      columns={COHORT_COLUMNS("Pair token")}
      rows={w.cohorts.pair.map((r) => cohortRegisterRow(pairLabel(r.bucket), r))}
      foot={cohortFooting(w)}
      note={`Launches excluded from this cohort: ${formatCount(w.cohortsExcluded.pair)}.`}
    />,
    <Register
      key="tax"
      folio={folio(1)}
      heading="By creator tax"
      headingId={`h-tax-${label}`}
      headingNote={n}
      ariaLabel={`Graduation rate by creator tax, ${label}`}
      caption="Creator tax read from the factory at launch."
      columns={COHORT_COLUMNS("Creator tax")}
      rows={w.cohorts.tax.map((r) => cohortRegisterRow(taxLabel(r.bucket), r))}
      foot={cohortFooting(w)}
      note={`Launches excluded from this cohort: ${formatCount(w.cohortsExcluded.tax)}.`}
    />,
    <Register
      key="hour"
      folio={folio(2)}
      heading="By hour (UTC)"
      headingId={`h-hour-${label}`}
      headingNote={n}
      ariaLabel={`Graduation rate by hour of day, UTC, ${label}`}
      caption="Hourly buckets that recorded at least one launch."
      columns={COHORT_COLUMNS("Hour (UTC)")}
      rows={observedHours.map((r) => cohortRegisterRow(hourLabel(r.bucket), r))}
      foot={cohortFooting(w)}
      note={`${emptyHoursNote}Launches excluded from this cohort: ${formatCount(w.cohortsExcluded.hour)}.`}
    />,
    <Register
      key="day"
      folio={folio(3)}
      heading="By day of week (UTC)"
      headingId={`h-day-${label}`}
      headingNote={n}
      ariaLabel={`Graduation rate by day of week, UTC, ${label}`}
      caption="All seven daily buckets. A bucket renders a rate only at n = 30 or more."
      columns={COHORT_COLUMNS("Day (UTC)")}
      rows={w.cohorts.day.map((r) => cohortRegisterRow(r.bucket, r))}
      foot={cohortFooting(w)}
      note={`Launches excluded from this cohort: ${formatCount(w.cohortsExcluded.day)}.`}
    />,
    <Register
      key="dep"
      folio={folio(4)}
      heading="Launches per deployer"
      headingId={`h-dep-${label}`}
      headingNote={`· ${label} · n = ${formatCount(distinct)} distinct`}
      ariaLabel={`Distribution of launches per deployer, ${label}`}
      caption="Counts of deployers by how many tokens they launched. No addresses."
      columns={["Launches per deployer", "Deployers (n)", `Share of ${formatCount(distinct)}`]}
      rows={w.deployers.histogram.map((row) => ({
        label: histogramLabel(row.bucket),
        cells: [
          { text: formatCount(row.deployers), kind: "n" as const },
          shareCell(row.deployers, distinct),
        ],
      }))}
      foot={{
        label: "All",
        cells: [{ text: formatCount(distinct) }, shareCell(distinct, distinct)],
      }}
      note="Aggregate distribution only. No deployer address appears on this page."
    />,
  ];
}

export default function Cohorts(): ReactElement {
  return (
    <main className="sheet">
      <RunningHead mark="LEDGE · COHORTS" win="All buckets · 01" />

      <div className="fold" style={{ paddingBottom: "1.5rem" }}>
        <h1 className="kicker">Cohorts</h1>
        <p className="lede" style={{ marginTop: "0.5rem" }}>
          Every bucket of the Pons Number that recorded a launch, in both windows, with the launch
          count standing beside every rate. A bucket under n&nbsp;=&nbsp;30 prints its sample size
          instead of a percentage.
        </p>
        <p className="note">
          <Age crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} /> ·{" "}
          <Link href="/">the number</Link> · <Link href="/method">method</Link>
        </p>
      </div>
      <ColophonStrip stamp={formatStamp(crawledAt)} />

      {WINDOWS.map((w, wi) => (
        <div key={w.key}>
          <LedgerEntry
            folio={String(wi * 10 + 2).padStart(2, "0")}
            id={`h-window-${w.key}`}
            heading={w.key === "h24" ? "Trailing 24 hours" : "All-time"}
            headingNote={`· n = ${formatCount(w.window.launches)} launches · ${formatCount(w.window.graduations)} graduations`}
          >
            <p className="note">{w.note}</p>
          </LedgerEntry>
          {cohortTables(w.window, w.label, wi * 10 + 3)}
        </div>
      ))}

      <Footer />
    </main>
  );
}
