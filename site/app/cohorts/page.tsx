import type { Metadata } from "next";
import { social } from "../../lib/social";
import type { ReactElement } from "react";
import { Age } from "../../components/Age";
import { Footer } from "../../components/Footer";
import { Tabs } from "../../components/Tabs";
import { Register } from "../../components/Register";
import { Stat } from "../../components/Stat";
import { allTime, h24, numberFile, type WindowData } from "../../lib/number";
import {
  formatCount,
  formatDayLong,
  formatDurationLong,
  formatOneIn,
  histogramLabel,
  hourLabel,
  pairLabel,
  taxLabel,
} from "../../lib/format";
import {
  COHORT_COLUMNS,
  FIRSTBUY_COLUMNS,
  OUTCOME_COLUMNS,
  cohortFooting,
  cohortRegisterRow,
  firstBuyRegisterRow,
  outcomeRegisterRow,
  shareCell,
} from "../../lib/rows";
import { fastShareFacts } from "../../lib/summary";
import { SAME_MEASUREMENT_NOTE, sameMeasurement } from "../../lib/windows";

const { crawledAt, staleAfterSeconds } = numberFile;
const outcomes = numberFile.outcomes;
/* A mark no cohort has reached yet (+7 d, on a record this young) would be a
   whole column of "not enough data (n=0)". It is shown once any cohort has a
   graduation old enough; until then the column is absent, not empty. */
const OUTCOME_MARK_LABELS: Record<string, string> = { "1h": "+1 h", "24h": "+24 h", "7d": "+7 d" };
const outcomeMarks = (["1h", "24h", "7d"] as const).filter((m) =>
  Object.values(outcomes?.cohorts ?? {}).some((rows) => rows.some((r) => r.marks[m].n > 0)),
);
const sinceLabel = numberFile.firstIndexedAt
  ? formatDayLong(numberFile.firstIndexedAt)
  : `block ${formatCount(numberFile.firstIndexedBlock)}`;
/* The time-to-graduation buckets of the outcomes block (pipeline/stats.py
   _outcome_bucket_key): under 10 s, 10 s to the 5-minute cutoff, over it. */
const TTG_LABELS: Record<string, string> = {
  u10: "under 10 s",
  mid: "10 s to 5 min",
  over: "over 5 min",
};
const firstBuy = numberFile.firstBuy;
const firstBuyAll = firstBuy?.cohorts.all[0] ?? {
  bucket: "all", n: 0, launchTxBuy: 0, launchTxBuyShare: null,
  outside: { sameBlock: 0, within1s: 0, within3s: 0, within5s: 0, after5s: 0, none: 0 },
  sameBlockShare: null, within1sShare: null, within3sShare: null, within5sShare: null, noneShare: null,
  insufficient: true,
};

export const metadata: Metadata = social("/cohorts", "Cohorts", "How pons launches graduate, by pair token, creator tax, hour and day; when the first outside buy landed; and where the price went after graduation. Every figure with its sample size.", "firstbuy");

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
            of graduations were done within {cutoffWords}, and{" "}
            <Stat
              className="mono"
              name={`fast-under-60-${label}`}
              value={fast.under60.rate}
              n={fast.n}
              window={label}
              updatedAt={crawledAt}
              insufficient={fast.under60.insufficient}
            />{" "}
            within 60 seconds.
          </>
        )}
      </p>
    </div>,
    <Register
      key="pair"
      ariaLabel={`Graduation rate by pair token, ${label}`}
      caption={`By the token a launch is paired against, n = ${nLaunches} launches.`}
      columns={COHORT_COLUMNS("Pair token")}
      rows={w.cohorts.pair.map((r) => cohortRegisterRow(pairLabel(r.bucket), r))}
      foot={cohortFooting(w)}
      note={excluded(w.cohortsExcluded.pair) || null}
    />,
    <Register
      key="tax"
      ariaLabel={`Graduation rate by creator tax, ${label}`}
      caption={`By creator tax, n = ${nLaunches} launches.`}
      columns={COHORT_COLUMNS("Creator tax")}
      rows={w.cohorts.tax.map((r) => cohortRegisterRow(taxLabel(r.bucket), r))}
      foot={cohortFooting(w)}
      note={excluded(w.cohortsExcluded.tax) || null}
    />,
    <Register
      key="hour"
      ariaLabel={`Graduation rate by hour of day, UTC, ${label}`}
      caption={`By hour of day, UTC, n = ${nLaunches} launches.`}
      columns={COHORT_COLUMNS("Hour (UTC)")}
      rows={observedHours.map((r) => cohortRegisterRow(hourLabel(r.bucket), r))}
      foot={cohortFooting(w)}
      note={`${emptyHoursNote}${excluded(w.cohortsExcluded.hour)}`.trim() || null}
    />,
    <Register
      key="day"
      ariaLabel={`Graduation rate by day of week, UTC, ${label}`}
      caption={`By day of week, UTC, n = ${nLaunches} launches.`}
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
        caption={`How many tokens each deployer launched, n = ${formatCount(distinct)} deployers. No addresses are shown.`}
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
          leaving out graduations under {formatDurationLong(w.excludingFast.cutoffSeconds)}:{" "}
          {formatCount(w.excludingFast.graduations)} of {formatCount(w.launches)}
          {w.excludingFast.oneIn === null ? "" : `, ${formatOneIn(w.excludingFast.oneIn)}`}
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
            Rows with fewer than 30 launches show the count instead of a rate.
          </p>
          <p className="note note--fine">
            All time means since {sinceLabel}, block {formatCount(numberFile.firstIndexedBlock)} to
            block {formatCount(numberFile.headBlock)}.
          </p>
        </details>
      </div>

      {outcomes ? (
        /* A6 (METHOD.md 2026-09-12): what the pool's price did after the
           graduation, against its own opening price. Medians only, each
           with the n of graduations whose mark had elapsed at crawledAt;
           "no trade" is an outcome of its own, not a gap. */
        <div className="card" id="h-outcomes">
          <div className="card-header">
            <h2 className="kicker card-kicker">AFTER GRADUATION</h2>
            <span className="note note--fine">
              {formatCount(outcomes.matched)} graduations with a pons pool
            </span>
          </div>
          <p className="note">
            The pool&rsquo;s price at {outcomeMarks.map((m) => OUTCOME_MARK_LABELS[m]).join(", ")} after
            graduation, against its opening price. Each cell is the median for the graduations old
            enough to have reached that mark, with their number. A pool with no trade by the mark
            counts as no trade, not as a price.
          </p>
          <Register
            ariaLabel="Price after graduation by time to graduation"
            caption="Change against the opening price, by how long the graduation took."
            columns={OUTCOME_COLUMNS("Time to graduation", outcomeMarks)}
            rows={outcomes.cohorts.ttg.map((r) => outcomeRegisterRow(TTG_LABELS[r.bucket] ?? r.bucket, r, outcomeMarks))}
          />
          <Register
            ariaLabel="Price after graduation by pair token"
            caption="Change against the opening price, by the token the launch was paired against."
            columns={OUTCOME_COLUMNS("Pair token", outcomeMarks)}
            rows={outcomes.cohorts.pair.map((r) => outcomeRegisterRow(pairLabel(r.bucket), r, outcomeMarks))}
          />
          <Register
            ariaLabel="Price after graduation by creator tax"
            caption="Change against the opening price, by creator tax."
            columns={OUTCOME_COLUMNS("Creator tax", outcomeMarks)}
            rows={outcomes.cohorts.tax.map((r) => outcomeRegisterRow(taxLabel(r.bucket), r, outcomeMarks))}
          />
        </div>
      ) : null}

      {firstBuy ? (
        /* A5b (METHOD.md 2026-09-13). Whole record, not a window: its
           population is stated on the card. Two facts per launch kept apart:
           the launch transaction's own opening buy, and the first buy from
           any other transaction -- sniping is a statement about the second. */
        <div className="card" id="h-firstbuy">
          <div className="card-header">
            <h2 className="kicker card-kicker">FIRST BUY</h2>
            <span className="note note--fine">launches at least one hour old</span>
          </div>
          <p className="note">
            {firstBuy.indexedFromBlock === null
              ? "First buys are not yet indexed; every row below is n = 0 until the first crawl that records them."
              : `Counted from block ${formatCount(firstBuy.indexedFromBlock)}; earlier launches were never read for buys.`}{" "}
            Shares are cumulative from the launch block. The launch&rsquo;s own opening buy, sent in
            the launch transaction, is counted separately.
          </p>
          <Register
            ariaLabel="First-buy timing by creator tax"
            caption={`When the first outside buy landed, by creator tax, n = ${formatCount(firstBuyAll.n)} launches.`}
            columns={FIRSTBUY_COLUMNS("Creator tax")}
            rows={firstBuy.cohorts.taxBucket.map((r) => firstBuyRegisterRow(taxLabel(r.bucket), r))}
            foot={firstBuyRegisterRow("All", firstBuyAll)}
          />
          <Register
            ariaLabel="First-buy timing by pair token"
            caption={`When the first outside buy landed, by the token a launch is paired against, n = ${formatCount(firstBuyAll.n)} launches.`}
            columns={FIRSTBUY_COLUMNS("Pair token")}
            rows={firstBuy.cohorts.pairClass.map((r) => firstBuyRegisterRow(pairLabel(r.bucket), r))}
            foot={firstBuyRegisterRow("All", firstBuyAll)}
          />
        </div>
      ) : null}

      <Footer />
    </main>
  );
}
