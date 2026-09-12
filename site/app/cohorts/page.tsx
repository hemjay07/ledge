import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Age } from "../../components/Age";
import { Footer } from "../../components/Footer";
import { Tabs } from "../../components/Tabs";
import { Register } from "../../components/Register";
import { Stat } from "../../components/Stat";
import { allTime, h24, numberFile, type WindowData } from "../../lib/number";
import {
  formatCount,
  formatDurationLong,
  formatOneIn,
  histogramLabel,
  hourLabel,
  pairLabel,
  taxLabel,
} from "../../lib/format";
import { COHORT_COLUMNS, cohortFooting, cohortRegisterRow, shareCell } from "../../lib/rows";
import { fastShareFacts } from "../../lib/summary";
import { SAME_MEASUREMENT_NOTE, sameMeasurement } from "../../lib/windows";

const { crawledAt, staleAfterSeconds } = numberFile;

export const metadata: Metadata = {
  title: "Cohorts — LEDGE",
  description:
    "Every cohort of the Pons Number in full: pair token, creator tax, hour of day, day of week, and the launches-per-deployer distribution, each with its sample size.",
};

/* While the all-time window holds exactly the launches the 24-hour window
   holds, every table below would be printed twice, cell for cell. One
   measurement rendered twice reads as two measurements agreeing. Keyed off the
   data, so the second window returns on its own once history is indexed. */
const allTimeIsSameMeasurement = sameMeasurement(h24, allTime);

const ALL_WINDOWS: { key: string; window: WindowData; label: string }[] = [
  { key: "h24", window: h24, label: "24 h" },
  { key: "all", window: allTime, label: "all-time" },
];

const WINDOWS = allTimeIsSameMeasurement
  ? ALL_WINDOWS.filter((w) => w.key === "h24")
  : ALL_WINDOWS;

/* The cut keys cohortTables() returns, named for a reader rather than for the
   code. The keys themselves are the register's own `key`, so a cut that is
   added or renamed there shows up here as its raw key rather than silently
   vanishing from the strip. Labels reworded 2026-09-12 (REVAMP.md 1.6): no
   "trailing"/"register"/"bucket"/"configuration"/"cohort" as a heading word. */
const TAB_LABELS: Record<string, string> = {
  fast: "Fast graduations",
  pair: "By pair token",
  tax: "By creator tax",
  hour: "By hour",
  day: "By day",
  dep: "Per deployer",
};

/* One register per cut, each just a caption-and-table now — no folio, no
   numbered heading, since the tab strip above already names the cut a reader
   picked. Every register is still rendered and still in the document; only
   the LedgerEntry chrome is gone (REVAMP.md 2026-09-12, "the evidence pages,
   calmed"). */
function cohortTables(w: WindowData, label: string): ReactElement[] {
  const distinct = w.deployers.distinct;
  const nLaunches = formatCount(w.launches);

  /* An hour that recorded nothing has nothing to read: 21 consecutive rows of
     "not enough data (n=0)" bury the three that carry launches. The empty
     buckets are counted in the note instead of listed, so the population is
     still reconcilable against the All footing and nothing is hidden. */
  const observedHours = w.cohorts.hour.filter((r) => r.launches > 0);
  const emptyHours = w.cohorts.hour.length - observedHours.length;
  const emptyHoursNote =
    emptyHours === 0 ? "" : `${formatCount(emptyHours)} hours with n = 0 — not listed. `;

  /* the day buckets get the hour buckets' treatment: an empty bucket is
     counted in the note, not given a row that reads "not enough data (n=0)" */
  const observedDays = w.cohorts.day.filter((r) => r.launches > 0);
  const emptyDays = w.cohorts.day.length - observedDays.length;
  const emptyDaysNote =
    emptyDays === 0 ? "" : `${formatCount(emptyDays)} days with n = 0 — not listed. `;

  /* nothing is said when nothing was excluded */
  const excluded = (n: number) =>
    n === 0 ? "" : `Launches excluded from this cohort: ${formatCount(n)}.`;

  const fast = fastShareFacts(w);
  const cutoffWords = formatDurationLong(w.excludingFast.cutoffSeconds);

  return [
    <div key="fast" id={`h-fast-${label}`}>
      <p className="lede">
        {fast.insufficient ? (
          <Stat
            value={null}
            n={fast.n}
            window={label}
            updatedAt={crawledAt}
            insufficient
            name={`fast-shares-${label}`}
          />
        ) : (
          <>
            <Stat
              className="mono"
              name={`fast-under-cutoff-${label}`}
              value={fast.underCutoff.rate}
              n={fast.n}
              window={label}
              updatedAt={crawledAt}
              insufficient={fast.underCutoff.insufficient}
            />{" "}
            of graduations completed inside {cutoffWords};{" "}
            <Stat
              className="mono"
              name={`fast-under-60-${label}`}
              value={fast.under60.rate}
              n={fast.n}
              window={label}
              updatedAt={crawledAt}
              insufficient={fast.under60.insufficient}
            />{" "}
            inside 60 seconds.
          </>
        )}
      </p>
    </div>,
    <Register
      key="pair"
      ariaLabel={`Graduation rate by pair token, ${label}`}
      caption={`Graduation rate by the token a launch is paired against, n = ${nLaunches} launches.`}
      columns={COHORT_COLUMNS("Pair token")}
      rows={w.cohorts.pair.map((r) => cohortRegisterRow(pairLabel(r.bucket), r))}
      foot={cohortFooting(w)}
      note={excluded(w.cohortsExcluded.pair) || null}
    />,
    <Register
      key="tax"
      ariaLabel={`Graduation rate by creator tax, ${label}`}
      caption={`Graduation rate by the creator tax read from the factory at launch, n = ${nLaunches} launches.`}
      columns={COHORT_COLUMNS("Creator tax")}
      rows={w.cohorts.tax.map((r) => cohortRegisterRow(taxLabel(r.bucket), r))}
      foot={cohortFooting(w)}
      note={excluded(w.cohortsExcluded.tax) || null}
    />,
    <Register
      key="hour"
      ariaLabel={`Graduation rate by hour of day, UTC, ${label}`}
      caption={`Graduation rate by hour of day (UTC), hours with at least one launch, n = ${nLaunches} launches.`}
      columns={COHORT_COLUMNS("Hour (UTC)")}
      rows={observedHours.map((r) => cohortRegisterRow(hourLabel(r.bucket), r))}
      foot={cohortFooting(w)}
      note={`${emptyHoursNote}${excluded(w.cohortsExcluded.hour)}`.trim() || null}
    />,
    <Register
      key="day"
      ariaLabel={`Graduation rate by day of week, UTC, ${label}`}
      caption={`Graduation rate by day of week (UTC), days with at least one launch, n = ${nLaunches} launches.`}
      columns={COHORT_COLUMNS("Day (UTC)")}
      rows={observedDays.map((r) => cohortRegisterRow(r.bucket, r))}
      foot={cohortFooting(w)}
      note={`${emptyDaysNote}${excluded(w.cohortsExcluded.day)}`.trim() || null}
    />,
    <div key="dep" id={`h-dep-${label}`}>
      <p className="lede">
        <span className="mono">{formatCount(distinct)}</span> distinct deployers launched{" "}
        <span className="mono">{formatCount(w.launches)}</span> tokens.{" "}
        <Stat
          className="mono"
          name={`deployers-launched-2plus-${label}`}
          value={w.deployers.launched2plusShare}
          n={distinct}
          window={label}
          updatedAt={crawledAt}
          insufficient={w.deployers.insufficient}
        />{" "}
        launched two or more;{" "}
        <Stat
          className="mono"
          name={`deployers-from-10plus-${label}`}
          value={w.deployers.from10plusShare}
          n={w.launches}
          window={label}
          updatedAt={crawledAt}
          insufficient={w.deployers.insufficient}
        />{" "}
        of all launches came from deployers with ten or more.
      </p>
      <Register
        ariaLabel={`Distribution of launches per deployer, ${label}`}
        caption={`Deployers by how many tokens they launched, n = ${formatCount(distinct)} deployers. No addresses.`}
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
      />
    </div>,
  ];
}

/* The two headline rates for a window: two small stat blocks, not
   paragraphs, sitting above the cut strip. Reuses .alltime/.at-v/.at-k, the
   vocabulary this page already had for this pair of numbers. */
function windowHeadline(w: WindowData, label: string, key: string): ReactElement {
  return (
    <div className="alltime">
      <div>
        <Stat
          className="at-v"
          name={`rate-${key}`}
          value={w.rate}
          n={w.launches}
          window={label}
          updatedAt={crawledAt}
          insufficient={w.insufficient}
        />
        <span className="at-k">
          {formatCount(w.graduations)} graduations of {formatCount(w.launches)} launches
        </span>
      </div>
      <div>
        <Stat
          className="at-v"
          name={`excluding-fast-${key}`}
          value={w.excludingFast.rate}
          n={w.launches}
          window={label}
          updatedAt={crawledAt}
          insufficient={w.excludingFast.insufficient}
        />
        <span className="at-k">
          excluding launches that graduated inside {formatDurationLong(w.excludingFast.cutoffSeconds)}
          {w.excludingFast.oneIn === null ? "" : ` · ${formatOneIn(w.excludingFast.oneIn)}`} ·{" "}
          {formatCount(w.excludingFast.graduations)} of {formatCount(w.launches)}
        </span>
      </div>
    </div>
  );
}

function windowBody(w: WindowData, label: string, key: string): ReactElement {
  return (
    <>
      {windowHeadline(w, label, key)}
      <Tabs
        param={`cut-${key}`}
        ariaLabel={`Cohorts of the ${label} window, by cut`}
        tabs={cohortTables(w, label).map((el) => ({
          key: String(el.key ?? "cut"),
          label: TAB_LABELS[String(el.key ?? "")] ?? String(el.key ?? "cut"),
          content: el,
        }))}
      />
    </>
  );
}

export default function Cohorts(): ReactElement {
  return (
    <main className="sheet">
      <div className="card">
        <div className="card-header">
          <h1 className="kicker card-kicker">COHORTS</h1>
          <Age crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />
        </div>

        {WINDOWS.length > 1 ? (
          <Tabs
            param="window"
            ariaLabel="Cohorts, by window"
            tabs={WINDOWS.map((w) => ({
              key: w.key,
              label: w.key === "h24" ? "Last 24 hours" : "All time",
              content: windowBody(w.window, w.label, w.key),
            }))}
          />
        ) : (
          windowBody(WINDOWS[0]!.window, WINDOWS[0]!.label, WINDOWS[0]!.key)
        )}

        <details className="board-what-counts">
          <summary>How this is counted</summary>
          {allTimeIsSameMeasurement ? <p className="note">{SAME_MEASUREMENT_NOTE}</p> : null}
          <p className="note">
            A row under n&nbsp;=&nbsp;30 prints its sample size instead of a percentage.
          </p>
          <p className="note note--fine">
            All-time is indexed from block {formatCount(numberFile.firstIndexedBlock)} to block{" "}
            {formatCount(numberFile.headBlock)}.
          </p>
        </details>
      </div>

      <Footer />
    </main>
  );
}
