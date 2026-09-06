import type { ReactElement } from "react";
import Link from "next/link";
import { ColophonStrip, RunningHead } from "../components/ColophonStrip";
import { Fold } from "../components/Fold";
import { Footer } from "../components/Footer";
import { LedgerEntry } from "../components/LedgerEntry";
import { Register } from "../components/Register";
import { Scale } from "../components/Scale";
import { SheetNav } from "../components/SheetNav";
import { StaleBanner } from "../components/StaleBanner";
import { Stat } from "../components/Stat";
import { allTime, h24, numberFile } from "../lib/number";
import {
  formatCount,
  formatDuration,
  formatDurationLong,
  formatOneIn,
  formatStamp,
  isInsufficient,
  hourLabel,
  pairLabel,
  taxLabel,
  histogramLabel,
} from "../lib/format";
import { COHORT_COLUMNS, cohortFooting, cohortRegisterRow, shareCell } from "../lib/rows";
import { SAME_MEASUREMENT_NOTE, sameMeasurement } from "../lib/windows";

const { crawledAt, staleAfterSeconds } = numberFile;

/* keyed off the data, so the all-time surfaces return by themselves once the
   index reaches back further than a day */
const allTimeIsSameMeasurement = sameMeasurement(h24, allTime);

export default function Home(): ReactElement {
  const exFast = h24.excludingFast;
  const cutoffWords = formatDurationLong(exFast.cutoffSeconds);
  const observedHours = h24.cohorts.hour.filter((r) => r.launches > 0);
  const emptyHours = h24.cohorts.hour.length - observedHours.length;
  const distinct = h24.deployers.distinct;
  const fastSharesInsufficient =
    isInsufficient({
      rate: h24.fastShares.under300Share,
      n: h24.fastShares.n,
      insufficient: h24.fastShares.insufficient,
    }) ||
    isInsufficient({
      rate: h24.fastShares.under60Share,
      n: h24.fastShares.n,
      insufficient: h24.fastShares.insufficient,
    });

  return (
    <>
      <StaleBanner crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />

      <main className="sheet">
        <SheetNav current="number" />
        {/* the fold — everything a phone screenshot must carry */}
        <RunningHead mark="LEDGE" win="Trailing 24 hours · 01" />

        <Fold
          w={h24}
          crawledAt={crawledAt}
          staleAfterSeconds={staleAfterSeconds}
          secondaryCounts
          dek={
            <p className="dek">
              Pons is a token launchpad on Robinhood Chain. A launch graduates when its bonding
              curve fills to 4.2&nbsp;ETH and the token moves to an open market. LEDGE reads every
              launch from the factory contract and counts, hourly.
            </p>
          }
        />
        <ColophonStrip stamp={formatStamp(crawledAt)} />
        {/* end of fold */}

        <LedgerEntry
          folio="02"
          id="h-fast"
          heading="Fast graduations"
          headingNote={`· n = ${formatCount(h24.fastShares.n)} graduations · 24 h`}
        >
          <p className="note">
            {fastSharesInsufficient ? (
              <Stat
                value={null}
                n={h24.fastShares.n}
                window="24h"
                updatedAt={crawledAt}
                insufficient
                name="fast-shares"
              />
            ) : (
              <>
                <Stat
                  className="mono"
                  name="fast-under-cutoff"
                  value={h24.fastShares.under300Share}
                  n={h24.fastShares.n}
                  window="24h"
                  updatedAt={crawledAt}
                  insufficient={h24.fastShares.insufficient}
                />{" "}
                of graduations completed inside {cutoffWords};{" "}
                <Stat
                  className="mono"
                  name="fast-under-60"
                  value={h24.fastShares.under60Share}
                  n={h24.fastShares.n}
                  window="24h"
                  updatedAt={crawledAt}
                  insufficient={h24.fastShares.insufficient}
                />{" "}
                inside 60 seconds.
              </>
            )}
          </p>
          <p className="note note--fine">
            {h24.lowerBound
              ? "A launch near the end of the window may still graduate, so the 24-hour figure is a lower bound for the most recent hours. "
              : ""}
            {h24.orphans > 0
              ? `${formatCount(h24.orphans)} graduations had no launch in the record and are excluded from every rate.`
              : ""}
          </p>
        </LedgerEntry>

        <LedgerEntry
          folio="03"
          id="h-ttg"
          heading="Time to graduation"
          headingNote={`· n = ${formatCount(h24.ttg.n)} graduations · 24 h`}
        >
          {h24.ttg.p90 !== null && h24.ttg.p50 !== null ? (
            <p className="lede">
              9 in 10 graduations happened within {formatDuration(h24.ttg.p90)}. Median{" "}
              {formatDuration(h24.ttg.p50)}.
            </p>
          ) : null}

          <Scale ttg={h24.ttg} cutoffSeconds={exFast.cutoffSeconds} />

          <p className="note note--fine">
            {(
              [
                ["p10", h24.ttg.p10],
                ["p25", h24.ttg.p25],
                ["p50", h24.ttg.p50],
                ["p75", h24.ttg.p75],
                ["p90", h24.ttg.p90],
                ["p95", h24.ttg.p95],
                ["max", h24.ttg.max],
              ] as const
            )
              .filter(([, v]) => v !== null)
              .map(([k, v]) => `${k} ${formatDuration(v as number)}`)
              .join(" · ")}
            .
          </p>
        </LedgerEntry>

        <Register
          folio="04"
          heading="By pair token"
          headingId="h-pair"
          headingNote={`· 24 h · n = ${formatCount(h24.launches)} launches`}
          ariaLabel="Graduation rate by pair token"
          caption="Graduations of launches, by the token the pool is paired against."
          columns={COHORT_COLUMNS("Pair token")}
          rows={h24.cohorts.pair.map((r) => cohortRegisterRow(pairLabel(r.bucket), r))}
          foot={cohortFooting(h24)}
          note={excludedNote(h24.cohortsExcluded.pair)}
        />

        <Register
          folio="05"
          heading="By creator tax"
          headingId="h-tax"
          headingNote={`· 24 h · n = ${formatCount(h24.launches)} launches`}
          ariaLabel="Graduation rate by creator tax"
          caption="Creator tax read from the factory at launch."
          columns={COHORT_COLUMNS("Creator tax")}
          rows={h24.cohorts.tax.map((r) => cohortRegisterRow(taxLabel(r.bucket), r))}
          foot={cohortFooting(h24)}
          note={excludedNote(h24.cohortsExcluded.tax)}
        />

        <Register
          folio="06"
          heading="By hour (UTC)"
          headingId="h-hour"
          headingNote={`· 24 h · ${observedHours.length} hours observed`}
          ariaLabel="Graduation rate by hour, UTC"
          caption="Hours holding n = 0 in this window are not listed."
          columns={COHORT_COLUMNS("Hour (UTC)")}
          rows={observedHours.map((r) => cohortRegisterRow(hourLabel(r.bucket), r))}
          foot={cohortFooting(h24)}
          note={
            <>
              The remaining {emptyHours} hourly buckets hold n&nbsp;=&nbsp;0 in this window. Both
              windows, and the day-of-week rows, are on{" "}
              <Link href="/cohorts">the cohorts page</Link>.
            </>
          }
        />

        <LedgerEntry
          folio="07"
          id="h-dep"
          heading="Deployers"
          headingNote={`· 24 h · n = ${formatCount(distinct)} distinct`}
        >
          <p className="lede">
            <span className="mono">{formatCount(distinct)}</span> distinct deployers launched{" "}
            <span className="mono">{formatCount(h24.launches)}</span> tokens.
{" "}
            <Stat
              className="mono"
              name="deployers-launched-2plus"
              value={h24.deployers.launched2plusShare}
              n={distinct}
              window="24h"
              updatedAt={crawledAt}
              insufficient={h24.deployers.insufficient}
            />{" "}
            launched two or more;{" "}
            <Stat
              className="mono"
              name="deployers-from-10plus"
              value={h24.deployers.from10plusShare}
              n={h24.launches}
              window="24h"
              updatedAt={crawledAt}
              insufficient={h24.deployers.insufficient}
            />{" "}
            of all launches came from deployers with ten or more.
          </p>
          <Register
            ariaLabel="Distribution of launches per deployer"
            caption="Launches per deployer, as counts of deployers. No addresses."
            columns={[
              "Launches per deployer",
              "Deployers (n)",
              `Share of ${formatCount(distinct)}`,
            ]}
            rows={h24.deployers.histogram.map((row) => ({
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
        </LedgerEntry>

        <LedgerEntry
          folio="08"
          id="h-all"
          heading="All-time"
          headingNote={`· since block ${formatCount(numberFile.firstIndexedBlock)}`}
        >
          {allTimeIsSameMeasurement ? (
            <p className="note">{SAME_MEASUREMENT_NOTE}</p>
          ) : (
          <div className="alltime">
            <div>
              <Stat
                className="at-v"
                name="all-time-rate"
                value={allTime.rate}
                n={allTime.launches}
                window="all-time"
                updatedAt={crawledAt}
                insufficient={allTime.insufficient}
              />
              <span className="at-k">
                {formatCount(allTime.graduations)} graduations of {formatCount(allTime.launches)}{" "}
                launches
              </span>
            </div>
            <div>
              <Stat
                className="at-v"
                name="all-time-excluding-fast"
                value={allTime.excludingFast.rate}
                n={allTime.launches}
                window="all-time"
                updatedAt={crawledAt}
                insufficient={allTime.excludingFast.insufficient}
              />
              <span className="at-k">
                excluding launches that graduated inside {cutoffWords}
                {allTime.excludingFast.oneIn === null
                  ? ""
                  : ` · ${formatOneIn(allTime.excludingFast.oneIn)}`}{" "}
                · {formatCount(allTime.excludingFast.graduations)} of{" "}
                {formatCount(allTime.launches)}
              </span>
            </div>
          </div>
          )}
          <p className="note note--fine">
            Indexed from block {formatCount(numberFile.firstIndexedBlock)} to block{" "}
            {formatCount(numberFile.headBlock)}.
          </p>
        </LedgerEntry>

        <Footer />
      </main>
    </>
  );
}

/* Nothing is said when nothing was excluded: a sentence whose only content is
   an absence is padding, and the All footing already reconciles the buckets
   against the population. */
function excludedNote(excluded: number): string | null {
  return excluded === 0
    ? null
    : `${formatCount(excluded)} launches were excluded from this cohort because the factory read failed. They still count in every rate.`;
}
