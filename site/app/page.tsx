import type { ReactElement } from "react";
import Link from "next/link";
import { Age } from "../components/Age";
import { ColophonStrip, RunningHead } from "../components/ColophonStrip";
import { Figure } from "../components/Figure";
import { Footer } from "../components/Footer";
import { LedgerEntry } from "../components/LedgerEntry";
import { Register } from "../components/Register";
import { Scale } from "../components/Scale";
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
import { excludingFastSentence, ponsNumberSentence } from "../lib/summary";

const { crawledAt, staleAfterSeconds } = numberFile;

export default function Home(): ReactElement {
  const exFast = h24.excludingFast;
  const cutoff = formatDuration(exFast.cutoffSeconds);
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
        {/* the fold — everything a phone screenshot must carry */}
        <RunningHead mark="LEDGE" win="Trailing 24 hours · 01" />

        <div className="fold">
          <h1 className="kicker">The Pons Number</h1>
          <div className="figure-block">
            <Figure
              name="pons-number"
              value={h24.rate}
              n={h24.launches}
              window="24h"
              updatedAt={crawledAt}
              insufficient={h24.insufficient}
              accessibleText={ponsNumberSentence(h24, crawledAt)}
            />
          </div>
          <p className="caption">
            of <b>{formatCount(h24.launches)}</b> launches in the last 24&nbsp;hours graduated{" "}
            <span className="den">
              · <span className="mono">{formatCount(h24.graduations)}</span> graduations ·{" "}
              <Age crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />
            </span>
          </p>
        </div>

        <div className="rule-hair" style={{ marginTop: "1.5rem" }} />
        <div className="second">
          <Figure
            name="excluding-fast"
            variant="secondary"
            value={exFast.rate}
            n={h24.launches}
            window="24h"
            updatedAt={crawledAt}
            insufficient={exFast.insufficient}
            accessibleText={excludingFastSentence(h24, cutoffWords, true)}
          />
          <p className="gloss">
            excluding launches that graduated inside {cutoffWords}
            {exFast.oneIn === null ? null : (
              <>
                {" "}
                · <b className="mono">{formatOneIn(exFast.oneIn)}</b>
              </>
            )}{" "}
            ·{" "}
            <span className="mono">
              {formatCount(exFast.graduations)} of {formatCount(h24.launches)}
            </span>
          </p>
        </div>
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
            Rates are printed to the precision the sample supports: two decimals at
            n&nbsp;≥&nbsp;1,000, one decimal below, and “not enough data” under 30.
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
            . The {cutoff} mark is the descriptive threshold used for the excluding-fast figure,
            not a boundary. The scale ends at one hour.
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
          <p className="note note--fine">
            Indexed from block {formatCount(numberFile.firstIndexedBlock)} to block{" "}
            {formatCount(numberFile.headBlock)}.{" "}
            {allTime.orphans > 0
              ? `${formatCount(allTime.orphans)} graduations had no launch in the record and are excluded from every rate.`
              : "Every graduation in the record has a launch behind it."}
          </p>
        </LedgerEntry>

        <Footer />
      </main>
    </>
  );
}

function excludedNote(excluded: number): string {
  return excluded === 0
    ? "No launches were excluded from this cohort."
    : `${formatCount(excluded)} launches were excluded from this cohort because the factory read failed. They still count in every rate.`;
}
