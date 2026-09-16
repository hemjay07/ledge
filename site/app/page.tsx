import type { ReactElement } from "react";
import Link from "next/link";
import { Footer } from "../components/Footer";
import { HomeLiveCard, HomeLiveProvider, HomeNowCard } from "../components/Live";
import { Shape } from "../components/Shape";
import { StaleBanner } from "../components/StaleBanner";
import { Stat } from "../components/Stat";
import { allTime, numberFile } from "../lib/number";
import { readLaunch } from "../lib/launch";
import {
  formatCount,
  formatDayLong,
  formatDuration,
  isInsufficient,
  renderableSample,
  sampleFact,
  sampleProvenance,
} from "../lib/format";
import { underSecondsFact } from "../lib/summary";
import type { LadderRung } from "../lib/schema";

const { crawledAt, staleAfterSeconds } = numberFile;

/* The hook's own fact, over the whole record rather than a trailing window:
   it is a claim about what "graduated" means at all, so it is measured over
   the same window the shape below it draws from. */
const UNDER_TEN_SECONDS_THRESHOLD = 10;
const underTen = underSecondsFact(allTime, UNDER_TEN_SECONDS_THRESHOLD);

/* The dated sample the callout leads with. Null when the file carries none,
   and null when the one it carries has no denominator: the callout prints
   nothing rather than a share with nothing under it. */
const raisedNothing = renderableSample(numberFile.samples, "raisedNothing");

/** A rung of the published time-to-graduation ladder, by its own threshold.
    `ttg.ladder` carries the cumulative counts and shares at 30, 60 and 300
    seconds already computed by the pipeline -- this reads the rung off the
    file rather than inventing a cutoff here (CONSTRAINTS 9). */
function ladderRung(atSeconds: number): LadderRung | undefined {
  return allTime.ttg.ladder.find((r) => r.atSeconds === atSeconds);
}

/** One row of the four-row table: a threshold, its cumulative share and its
    cumulative count, both read off the same rung so they can never diverge. */
function TableRow({
  label,
  count,
  rate,
  n,
  insufficient,
  statName,
}: {
  label: string;
  count: number;
  rate: number | null;
  n: number;
  insufficient: boolean;
  statName: string;
}): ReactElement {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="fig">
        <Stat
          className="mono"
          name={statName}
          value={rate}
          n={n}
          window="all-time"
          updatedAt={crawledAt}
          insufficient={insufficient}
        />
      </td>
      <td className="fig n mono">{formatCount(count)}</td>
    </tr>
  );
}

const launch = readLaunch();

export default function Home(): ReactElement {
  const r30 = ladderRung(30);
  const r60 = ladderRung(60);
  const r300 = ladderRung(300);
  const ttgInsufficient = allTime.ttg.insufficient;
  const ttgN = allTime.ttg.n;

  const raisedNothingFact = raisedNothing ? sampleFact(raisedNothing) : null;
  /* RESEARCH-2026-09-13 §1: pons has run since July and "all-time" reads as
     the venue's life to anyone who knows it. The record starts where it
     starts; the caption says the date. */
  const sinceLabel = numberFile.firstIndexedAt
    ? formatDayLong(numberFile.firstIndexedAt)
    : `block ${formatCount(numberFile.firstIndexedBlock)}`;

  return (
    <>
      <StaleBanner crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />

      <main className="sheet">
        <div className="home-grid">
          <HomeLiveProvider>
          <HomeLiveCard staleAfterSeconds={staleAfterSeconds} />

          {/* ---- the hook ------------------------------------------------ */}
          <div className="home-hook">
            <h2 className="kicker">&ldquo;Graduated&rdquo; is not one thing.</h2>
            <h1 className="capability-line">
              Of <span className="mono">{formatCount(allTime.graduations)}</span> graduations on
              pons,{" "}
              <Stat
                className="mono"
                name="under-ten-seconds"
                value={underTen.rate}
                n={underTen.n}
                window="all-time"
                updatedAt={crawledAt}
                insufficient={underTen.insufficient}
                precision={0}
              />{" "}
              finished in under 10&nbsp;seconds.
            </h1>
            <p className="dek home-dek">
              LEDGE counts every pons launch and times every graduation. Every number here says how
              many it was counted from.
            </p>
            {/* C5 (BRAINSTORM-2026-09-13): the one line of difference. Four pons
                sites score or publish the tape; a visitor arriving from one needs
                to know why this page looks different, in one line, before the
                table. It is a separate line, not part of the dek, because the dek
                is held to 25 words by landing-copy.test.ts. */}
            <p className="note home-difference">
              Nothing here is rated and no wallet is named. Just what the whole population did, and
              how it was counted.
            </p>
          </div>

          {/* ---- the table: finished inside | share | count -------------- */}
          <div className="home-table">
            <div className="scroller">
              <table>
                <caption>
                  Every graduation on pons since {sinceLabel}, by how long it took to finish.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Finished inside</th>
                    <th scope="col">Share</th>
                    <th scope="col">Count</th>
                  </tr>
                </thead>
                <tbody>
                  <TableRow
                    label="10 seconds"
                    statName="ttg-10s"
                    count={underTen.count}
                    rate={underTen.rate}
                    n={underTen.n}
                    insufficient={underTen.insufficient}
                  />
                  <TableRow
                    label="30 seconds"
                    statName="ttg-30s"
                    count={r30?.cumulative ?? 0}
                    rate={r30?.cumulativeShare ?? null}
                    n={ttgN}
                    insufficient={ttgInsufficient}
                  />
                  <TableRow
                    label="60 seconds"
                    statName="ttg-60s"
                    count={r60?.cumulative ?? 0}
                    rate={r60?.cumulativeShare ?? null}
                    n={ttgN}
                    insufficient={ttgInsufficient}
                  />
                  <TableRow
                    label="5 minutes"
                    statName="ttg-300s"
                    count={r300?.cumulative ?? 0}
                    rate={r300?.cumulativeShare ?? null}
                    n={ttgN}
                    insufficient={ttgInsufficient}
                  />
                  <tr>
                    <th scope="row">Median</th>
                    <td className="fig mono">
                      {ttgInsufficient || allTime.ttg.p50 === null
                        ? "not enough data"
                        : formatDuration(allTime.ttg.p50)}
                    </td>
                    <td className="fig n mono">n={formatCount(ttgN)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- the callout: raised nothing, equal weight to the hook --- */}
          {raisedNothing && raisedNothingFact ? (
            <div className="home-callout">
              <p className="callout-figure">
                <Stat
                  className="mono"
                  name="raised-nothing"
                  value={raisedNothingFact.rate ?? null}
                  n={raisedNothingFact.n}
                  window="sampled"
                  updatedAt={raisedNothing.measuredAt}
                  insufficient={isInsufficient(raisedNothingFact)}
                />{" "}
                of pons launches never take a single buy.
              </p>
              <p className="note note--fine">{sampleProvenance(raisedNothing)}</p>
              <p className="note note--fine">
                <Link href="/graveyard">The graveyard</Link> counts this every day.
              </p>
            </div>
          ) : null}

          {/* ---- the finding: the shape of the record --------------------- */}
          <div className="home-finding">
            <div className="card-header">
              <span className="kicker card-kicker">FINDING · time to graduation</span>
            </div>
            <div className="card-body">
              <Shape histogram={allTime.ttg.histogram} n={allTime.ttg.n} insufficient={allTime.ttg.insufficient} />
              <p className="note note--fine">
                n = <span className="mono">{formatCount(allTime.ttg.n)}</span> graduations.
              </p>
              <p className="note note--fine">
                <em>Two kinds of graduation: a spike inside the first seconds, then a gap, then the broad hump of the rest.</em>
              </p>
            </div>
          </div>

          <HomeNowCard />

          {/* ---- three doors ---------------------------------------------- */}
          <Link className="card home-door home-door-1" href="/live">
            <span className="kicker card-kicker">Live</span>
            <p className="note">Every curve taking buys right now.</p>
          </Link>
          <Link className="card home-door home-door-2" href="/graduated">
            <span className="kicker card-kicker">Graduated</span>
            <p className="note">Every launch that graduated, and how long it took.</p>
          </Link>
          <Link className="card home-door home-door-3" href="/graveyard">
            <span className="kicker card-kicker">Graveyard</span>
            <p className="note">Every launch that took no buys in its first 72 hours.</p>
          </Link>

          {/* LEDGE's own launch (REVAMP.md 2026-09-12, TODO C3): the
              pre-registration before the token exists; the token's own page,
              under the same rules as every other token, after. */}
          {launch ? (
            launch.address ? (
              <Link className="card home-door home-launch" href={`/t/${launch.address}`}>
                <span className="kicker card-kicker">LEDGE, measured by LEDGE</span>
                <p className="note">
                  Our own token, on its own page, with the same readings as every other launch:
                  buyers in the launch block, first outside buy, fill, and what launches like it did.
                </p>
              </Link>
            ) : (
              <Link className="card home-door home-launch" href="/launch">
                <span className="kicker card-kicker">LEDGE&rsquo;s own launch, pre-registered</span>
                <p className="note">
                  Before the token exists: a 3% creator tax, a creator wallet that never buys its
                  own curve, no arranged buys, and every reading published under the same rules as
                  every other launch. Committed as <span className="mono">{launch.preregistrationCommit}</span>.
                </p>
              </Link>
            )
          ) : null}
          </HomeLiveProvider>
        </div>


        <p className="note home-rest">
          Also: <Link href="/number">the card</Link> · <Link href="/cohorts">cohorts</Link> ·{" "}
          <Link href="/cockpit">pair &times; tax</Link> · <Link href="/method">method</Link>.
        </p>

        <Footer />
      </main>
    </>
  );
}
