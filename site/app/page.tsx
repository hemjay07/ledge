import type { ReactElement } from "react";
import Link from "next/link";
import { ColophonStrip, RunningHead } from "../components/ColophonStrip";
import { Fold } from "../components/Fold";
import { Footer } from "../components/Footer";
import { LedgerEntry } from "../components/LedgerEntry";
import { LiveBoard } from "../components/LiveBoard";
import { LivePulse } from "../components/Live";
import { Lookup } from "../components/Lookup";
import { Register } from "../components/Register";
import { Scale } from "../components/Scale";
import { Shape } from "../components/Shape";
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
  renderableSample,
  formatOneIn,
  insufficientText,
} from "../lib/format";
import { COHORT_COLUMNS, cohortFooting, cohortRegisterRow } from "../lib/rows";
import { fastShareFacts, underSecondsFact } from "../lib/summary";
import { sameMeasurement } from "../lib/windows";

const { crawledAt, staleAfterSeconds } = numberFile;

/* The dated sample the fold leads with. Null when the file carries none, and
   null when the one it carries has no denominator: the fold prints nothing
   rather than a share with nothing under it. */
const raisedNothing = renderableSample(numberFile.samples, "raisedNothing");

/* keyed off the data: while all-time holds exactly what the trailing 24 hours
   holds, the second pair sentence would restate one measurement as two */
const allTimeIsSameMeasurement = sameMeasurement(h24, allTime);

/* The capability line's own fact, off the whole record rather than the
   trailing 24 hours: it is a claim about what "graduated" means at all, not
   about today, so it is measured over the same window the shape below it
   draws from. */
const UNDER_TEN_SECONDS_THRESHOLD = 10;
const underTen = underSecondsFact(allTime, UNDER_TEN_SECONDS_THRESHOLD);

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
      excludingFast: { cutoffSeconds: 300, graduations: 0, rate: null, oneIn: null, insufficient: true },
    }
  );
}

export default function Home(): ReactElement {
  const exFast = h24.excludingFast;

/* "1 in N", or the sample size when the sample cannot support a rate.
   CONSTRAINTS 4: below the minimum this prints its n, never a ratio. */
const exFastOneIn =
  exFast.insufficient || exFast.oneIn === null
    ? insufficientText(h24.launches)
    : formatOneIn(exFast.oneIn);
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

  /* the same slot for the row's excluding-fast rate. The finding below is a
     comparison BETWEEN buckets, and the page's headline says the raw rate is
     contaminated by graduations the deployer arranged -- so a comparison
     printed on the raw rate would invite exactly the reading the headline
     spends its whole fold refusing. */
  const pairSlowRate = (row: CohortRow, name: string, window: string) => (
    <Stat
      className="mono"
      name={name}
      value={row.excludingFast.rate}
      n={row.launches}
      window={window}
      updatedAt={crawledAt}
      insufficient={row.excludingFast.insufficient}
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
        <SheetNav current="home" />
        <RunningHead mark="LEDGE" win="Trailing 24 hours" />

        {/* ---- the front door: live pulse, capability, proof, paths ---- */}

        <div className="discovery-lead">
          <h2 className="kicker">Live now</h2>
          <LivePulse />
        </div>

        <div className="capability">
          <p className="capability-line">
            LEDGE times every pons graduation, not just whether one happened.
          </p>
          <p className="capability-facts">
            Of <span className="mono">{formatCount(allTime.graduations)}</span> graduations,{" "}
            <Stat
              className="mono"
              name="under-ten-seconds"
              value={underTen.rate}
              n={underTen.n}
              window="all-time"
              updatedAt={crawledAt}
              insufficient={underTen.insufficient}
            />{" "}
            finished in under 10&nbsp;seconds, some in the same block as their own launch.
            &ldquo;Graduated&rdquo; is not one thing.
          </p>
        </div>

        {/* The only decision anyone makes here, so it sits where it can be
            reached without scrolling.

            It was halfway down the page, under a heading, beneath the proof and
            the paths. Browsing the board is not a decision and reading the
            evidence is not a decision; pasting an address to find out whether a
            specific token has anything behind it is, and it is what a person
            arriving from a group chat already has in their clipboard. One input
            costs almost no vertical space, and putting it above the proof puts
            the action before the argument for it. */}
        <section className="lookup-lead" id="h-lookup">
          <Lookup />
        </section>

        <div className="shape-lead">
          <h2 className="kicker">The shape of the record</h2>
          <Shape
            histogram={allTime.ttg.histogram}
            n={allTime.ttg.n}
            insufficient={allTime.ttg.insufficient}
          />
          <p className="note note--fine">
            Time to graduation for every launch LEDGE holds, counted over{" "}
            <span className="mono">{formatCount(allTime.ttg.n)}</span> graduations. The bars are
            counts, drawn from zero; no bucket is a label.
          </p>
        </div>

        <nav className="paths-on" aria-label="Go deeper">
          <Link href="/live">The live board</Link>
          <Link href="/graduated">Every graduation</Link>
          <Link href="/graveyard">The graveyard</Link>
        </nav>

        {/* The population figures, stated and linked rather than reprinted.

            They used to occupy this page in full, identically to /number, which
            made the home page twice as long and put the most discouraging true
            thing on the site in front of a first-time reader. CONSTRAINTS 5
            forbids HIDING an unflattering number; it does not require it to be
            the first thing anyone reads, and it is not hidden: the figure is
            stated here with its denominator, /number carries it in full with
            its card, and /method carries how it was measured. Which true thing
            leads is a choice, and this is the choice. */}
        <section className="headline-rate">
          <p className="lede">
            Of {formatCount(h24.launches)} launches in the last 24 hours,{" "}
            {formatCount(h24.excludingFast.graduations)} graduated on demand rather than filling
            inside {cutoffWords} — {exFastOneIn}. Counting every graduation, {formatCount(h24.graduations)}.
          </p>
          <p className="note">
            <Link href="/number">The Pons Number in full</Link> ·{" "}
            <Link href="/method">how it is measured</Link>
          </p>
        </section>
        <ColophonStrip stamp={formatStamp(crawledAt)} />

        {/* The ~150-word entry this used to be named our own constraints back at a
            reader who does not care what we refuse to do (design critique,
            2026-09-10). What it measures and how is one line, linked, on
            /method instead. */}
        <LedgerEntry id="h-what" heading="What this is">
          <p className="note">
            How LEDGE measures every figure here is on <Link href="/method">the method page</Link>.
          </p>
        </LedgerEntry>

        <LedgerEntry id="h-cohorts" heading="More cohorts">
          <p className="note">
            Creator tax, hour of day, day of week, launches per deployer and the all-time window
            are in full on <Link href="/cohorts">the cohorts page</Link>.
          </p>
        </LedgerEntry>

        <LedgerEntry id="h-config" heading="Configurations">
          <p className="note">
            Pair token crossed with creator tax, all 20 cells in both windows, is on{" "}
            <Link href="/cockpit">the configurations page</Link>.
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
