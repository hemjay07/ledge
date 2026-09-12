import type { ReactElement } from "react";
import Link from "next/link";
import { Footer } from "../components/Footer";
import { HomeLiveCard, HomeLiveProvider, HomeNowCard } from "../components/Live";
import { Shape } from "../components/Shape";
import { StaleBanner } from "../components/StaleBanner";
import { Stat } from "../components/Stat";
import { allTime, numberFile } from "../lib/number";
import {
  formatCount,
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

export default function Home(): ReactElement {
  const r30 = ladderRung(30);
  const r60 = ladderRung(60);
  const r300 = ladderRung(300);
  const ttgInsufficient = allTime.ttg.insufficient;
  const ttgN = allTime.ttg.n;

  const raisedNothingFact = raisedNothing ? sampleFact(raisedNothing) : null;

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
              LEDGE indexes every launch from the pons factory contract, hourly, and times every
              graduation.
            </p>
          </div>

          {/* ---- the table: finished inside | share | count -------------- */}
          <div className="home-table">
            <div className="scroller">
              <table>
                <caption>
                  Every graduation on pons, all-time, by how long it took to finish.
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
                <em>Two populations: a spike at the instant end, a trough, then a broad hump.</em>
              </p>
            </div>
          </div>

          <HomeNowCard />

          {/* ---- three doors ---------------------------------------------- */}
          <Link className="card home-door home-door-1" href="/live">
            <span className="kicker card-kicker">Live</span>
            <p className="note">Every curve taking buys right now, ranked however you sort it.</p>
          </Link>
          <Link className="card home-door home-door-2" href="/graduated">
            <span className="kicker card-kicker">Graduated</span>
            <p className="note">Every launch that crossed the threshold, in full.</p>
          </Link>
          <Link className="card home-door home-door-3" href="/graveyard">
            <span className="kicker card-kicker">Graveyard</span>
            <p className="note">Every launch that never graduated.</p>
          </Link>

          {/* LEDGE's own launch: pre-registration, then /t/{address} — REVAMP.md 2026-09-12 */}
          </HomeLiveProvider>
        </div>

        <p className="note home-rest">
          More: <Link href="/number">the Pons Number</Link> ·{" "}
          <Link href="/cohorts">cohorts by pair, tax, hour and day</Link> ·{" "}
          <Link href="/cockpit">pair &times; tax</Link> · <Link href="/method">how it is counted</Link>.
        </p>

        <Footer />
      </main>
    </>
  );
}
