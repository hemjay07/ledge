import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Age } from "../../components/Age";
import { ColophonStrip, RunningHead } from "../../components/ColophonStrip";
import { Footer } from "../../components/Footer";
import { GraduatedBoard } from "../../components/Graduated";
import { LedgerEntry } from "../../components/LedgerEntry";
import { SheetNav } from "../../components/SheetNav";
import { StaleBanner } from "../../components/StaleBanner";
import { graduatedFile } from "../../lib/graduated";
import { allTime, numberFile } from "../../lib/number";
import { formatCount, formatDurationLong, formatStamp, rateText } from "../../lib/format";

const MIN_N = 30;

const { crawledAt, staleAfterSeconds } = numberFile;
const { ttg } = allTime;

export const metadata: Metadata = {
  title: "Graduated — LEDGE",
  description:
    "Every Pons graduation, ranked by how long it took to graduate. No score, no grade, no verdict — the duration is the finding.",
};

/* The ladder's own context table: cumulative shares of ALL-TIME graduations
   completing within each mark, read verbatim from data/number.json's
   allTime.ttg.ladder. These are Class A shares — computed by
   pipeline/recompute.py, gated at n = 30 — and this page never recomputes
   them. */
function LadderContext(): ReactElement {
  if (ttg.insufficient || ttg.n < MIN_N) {
    return (
      <p className="note">
        {`not enough data (n=${formatCount(ttg.n)}) to place a graduation against the population.`}
      </p>
    );
  }

  return (
    <>
      <div className="scroller" tabIndex={0} role="group" aria-label="Cumulative share of all-time graduations by time to graduate">
        <table>
          <caption>
            Cumulative share of all-time graduations completing within each mark. Read from the
            last computed measurement, not recomputed here.
          </caption>
          <thead>
            <tr>
              <th scope="col">Within</th>
              <th scope="col">Cumulative graduations</th>
              <th scope="col">Share (n = {formatCount(ttg.n)})</th>
            </tr>
          </thead>
          <tbody>
            {ttg.ladder.map((rung) => (
              <tr key={rung.atSeconds}>
                <th scope="row">{formatDurationLong(rung.atSeconds)}</th>
                <td className="fig n">{formatCount(rung.cumulative)}</td>
                <td className="fig">
                  {rateText({ rate: rung.cumulativeShare, n: ttg.n, insufficient: ttg.insufficient })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note note--fine">
        Median time to graduate {ttg.p50 === null ? "not enough data" : formatDurationLong(ttg.p50)}
        ; slowest observed {ttg.max === null ? "not enough data" : formatDurationLong(ttg.max)}. n
        {" = "}
        {formatCount(ttg.n)} matched graduations, {formatStamp(crawledAt)}.
      </p>
    </>
  );
}

function ExcludedNote(): ReactElement {
  const { excludedNoLaunch, excludedUnmatched, rows, totalGraduationRows } = graduatedFile;
  return (
    <>
      <p className="lede" style={{ marginTop: "0.5rem" }}>
        {formatCount(rows.length)} graduations below carry a matched launch and a time to graduate,
        read from {formatCount(totalGraduationRows)} graduation records indexed at build time.
      </p>
      <p className="note">
        {formatCount(excludedNoLaunch)} graduations are excluded because no launch is on record for
        the token: it graduated before this index began recording launches, so there is no launch
        timestamp to measure a duration from.
        {excludedUnmatched > 0
          ? ` A further ${formatCount(excludedUnmatched)} graduation${excludedUnmatched === 1 ? "" : "s"} could not be joined to a launch despite carrying no orphan flag; they are counted here rather than dropped.`
          : ""}
      </p>
    </>
  );
}

export default function Graduated(): ReactElement {
  return (
    <>
      <StaleBanner crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />

      <main className="sheet">
        <SheetNav current="graduated" />
        <RunningHead mark="LEDGE · GRADUATED" win="Every graduation, ranked · 01" />

        <div className="fold" style={{ paddingBottom: "1.5rem" }}>
          <h1 className="kicker">Graduated</h1>
          <p className="lede" style={{ marginTop: "0.5rem" }}>
            One row per token that reached its own graduation threshold: how long it took, its pair,
            its creator tax, and when it graduated. Ranked by time to graduate, fastest first,
            because the duration is printed on every row.
          </p>
        </div>
        <ColophonStrip stamp="Graduated · list built at deploy time, no live API" />

        <LedgerEntry folio="02" id="h-ladder" heading="Time to graduate, across the population">
          <LadderContext />
        </LedgerEntry>

        <LedgerEntry folio="03" id="h-graduated-board" heading="Every graduation">
          <ExcludedNote />
          <p className="note note--fine">
            <Age crawledAt={graduatedFile.generatedAt} staleAfterSeconds={graduatedFile.staleAfterSeconds} prefix="list built" />
          </p>
          <GraduatedBoard data={graduatedFile} />
        </LedgerEntry>

        <LedgerEntry folio="04" id="h-graduated-what" heading="What this counts">
          <p className="lede">
            Time to graduate is one token&rsquo;s own graduation timestamp minus its own launch
            timestamp — a fact about that token, not a rate over the population. The ladder above is
            the population figure, computed once by the same pipeline that produces the rest of the
            site and gated at n = 30; this list never recomputes a share or a percentage.
          </p>
          <p className="note">
            No row carries a label beyond its own facts. The duration is printed; nothing here
            says what it means.
          </p>
        </LedgerEntry>

        <Footer />
      </main>
    </>
  );
}
