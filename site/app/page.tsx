import type { ReactElement } from "react";
import Link from "next/link";
import { ColophonStrip, RunningHead } from "../components/ColophonStrip";
import { Fold } from "../components/Fold";
import { Footer } from "../components/Footer";
import { LedgerEntry } from "../components/LedgerEntry";
import { LiveBoard } from "../components/LiveBoard";
import { Lookup } from "../components/Lookup";
import { Register } from "../components/Register";
import { Scale } from "../components/Scale";
import { SheetNav } from "../components/SheetNav";
import { StaleBanner } from "../components/StaleBanner";
import { Stat } from "../components/Stat";
import { allTime, h24, numberFile } from "../lib/number";
import type { CohortRow, WindowData } from "../lib/schema";
import {
  formatCount,
  formatDuration,
  formatDurationLong,
  formatStamp,
  pairLabel,
} from "../lib/format";
import { COHORT_COLUMNS, cohortFooting, cohortRegisterRow } from "../lib/rows";
import { fastShareFacts } from "../lib/summary";
import { sameMeasurement } from "../lib/windows";

const { crawledAt, staleAfterSeconds } = numberFile;

/* keyed off the data: while all-time holds exactly what the trailing 24 hours
   holds, the second pair sentence would restate one measurement as two */
const allTimeIsSameMeasurement = sameMeasurement(h24, allTime);

/** A pair bucket, or an empty one standing in its place: a missing bucket has
    measured nothing, so it carries n = 0 and prints its sample size. */
function pairRow(w: WindowData, bucket: string): CohortRow {
  return (
    w.cohorts.pair.find((r) => r.bucket === bucket) ?? {
      bucket,
      launches: 0,
      graduations: 0,
      rate: null,
      insufficient: true,
    }
  );
}

export default function Home(): ReactElement {
  const exFast = h24.excludingFast;
  const cutoffWords = formatDurationLong(exFast.cutoffSeconds);
  const fast = fastShareFacts(h24);

  const stable = pairRow(h24, "stable");
  const eth = pairRow(h24, "eth");
  const stableAll = pairRow(allTime, "stable");
  const ethAll = pairRow(allTime, "eth");

  /* the rate slot of a pair sentence: the shared gate decides whether a
     percentage may stand there, exactly as it does in the table below it */
  const pairRate = (row: CohortRow, name: string, window: string) => (
    <Stat
      className="mono"
      name={name}
      value={row.rate}
      n={row.launches}
      window={window}
      updatedAt={crawledAt}
      insufficient={row.insufficient}
    />
  );

  const counts = (row: CohortRow) => (
    <span className="mono">
      {formatCount(row.graduations)} of {formatCount(row.launches)}
    </span>
  );

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
          /* why the second figure exists: most graduations are the fast ones */
          finding={
            fast.insufficient ? (
              <Stat
                value={null}
                n={fast.n}
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
                  value={fast.underCutoff.rate}
                  n={fast.n}
                  window="24h"
                  updatedAt={crawledAt}
                  insufficient={fast.underCutoff.insufficient}
                />{" "}
                of graduations completed inside {cutoffWords};{" "}
                <Stat
                  className="mono"
                  name="fast-under-60"
                  value={fast.under60.rate}
                  n={fast.n}
                  window="24h"
                  updatedAt={crawledAt}
                  insufficient={fast.under60.insufficient}
                />{" "}
                inside 60 seconds.{" "}
                <span className="den">
                  (n&nbsp;=&nbsp;<span className="mono">{formatCount(fast.n)}</span> graduations ·
                  24 h)
                </span>
              </>
            )
          }
          fine={
            <>
              {h24.lowerBound
                ? "A launch near the end of the window may still graduate, so the 24-hour figure is a lower bound for the most recent hours. "
                : ""}
              {h24.orphans > 0
                ? `${formatCount(h24.orphans)} graduations had no launch in the record and are excluded from every rate.`
                : ""}
            </>
          }
        />
        <ColophonStrip stamp={formatStamp(crawledAt)} />
        {/* end of fold */}

        <LedgerEntry
          folio="02"
          id="h-lookup"
          heading="One launch"
          headingNote="· against the published cohorts"
        >
          <Lookup />
        </LedgerEntry>

        <LedgerEntry
          folio="03"
          id="h-pair"
          heading="By pair token"
          headingNote={`· 24 h · n = ${formatCount(h24.launches)} launches`}
        >
          <p className="lede">
            Launches paired with a stablecoin graduated at {pairRate(stable, "pair-stable", "24h")}{" "}
            ({counts(stable)}); paired with ETH, {pairRate(eth, "pair-eth", "24h")} ({counts(eth)}).
            Two counts over the same window, not a cause.
          </p>
          {allTimeIsSameMeasurement ? null : (
            <p className="note">
              Over the indexed record: stablecoin{" "}
              {pairRate(stableAll, "pair-stable-all-time", "all-time")} ({counts(stableAll)}), ETH{" "}
              {pairRate(ethAll, "pair-eth-all-time", "all-time")} ({counts(ethAll)}).
            </p>
          )}
          <Register
            ariaLabel="Graduation rate by pair token"
            caption="Graduations of launches, by the token the pool is paired against."
            columns={COHORT_COLUMNS("Pair token")}
            rows={h24.cohorts.pair.map((r) => cohortRegisterRow(pairLabel(r.bucket), r))}
            foot={cohortFooting(h24)}
            note={excludedNote(h24.cohortsExcluded.pair)}
          />
        </LedgerEntry>

        <LedgerEntry
          folio="04"
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

        <LiveBoard folio="05" />

        <LedgerEntry folio="06" id="h-what" heading="What this is">
          <p className="lede">
            LEDGE reads the Pons factory contract every hour, records every launch it finds, and
            counts how many graduated — in the last 24 hours and over the indexed record, split by
            pair token and by creator tax. Every figure on this page is printed with the number of
            launches it was counted from.
          </p>
          <p className="note">
            It will never rank a token, never name a wallet, and never print a rate without its
            denominator.
          </p>
          <p className="note">
            No public tool publishes the graduation rate of launches by configuration; this does.
          </p>
        </LedgerEntry>

        <LedgerEntry folio="07" id="h-cohorts" heading="More cohorts">
          <p className="note">
            Creator tax, hour of day, day of week, launches per deployer and the all-time window
            are in full on <Link href="/cohorts">the cohorts page</Link>.
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
