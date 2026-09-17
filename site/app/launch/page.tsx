import type { Metadata } from "next";
import type { ReactElement } from "react";
import Link from "next/link";
import { Footer } from "../../components/Footer";
import { readLaunch } from "../../lib/launch";
import { formatDayLong } from "../../lib/format";

/* LEDGE's own launch, for the reader a post sends here.

   Added 2026-09-17. The pre-registration lived only on /method, an anchor
   9,000 pixels down a 2,600-word reference page written for someone
   auditing the numbers. The reader from X has three seconds and needs
   five things: what is being launched, what we commit to, what we expect,
   how it is judged, and the hash that proves it was written first.

   Every figure here is copied from PREREGISTRATION.md and dated to that
   file's own crawl (2026-09-12). The file is not edited above its Outcome
   heading once committed, so these figures do not track the live record;
   the live figures are one link away, on their own pages. */

export const metadata: Metadata = {
  title: "LEDGE's own launch — LEDGE",
  description:
    "LEDGE launches a token on pons. What it expects and what it commits to were written down and committed before the launch, and are counted afterwards by the same rules as every other launch.",
};

/** "19 Sep 2026, 16:00 UTC" from the ISO stamp in data/launch.json. */
function launchLabel(iso: string): string {
  const d = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

const COMMITMENTS = [
  {
    what: "The creator wallet does not buy on the curve.",
    detail: "Not in the launch block, not after. The token's page shows distinct buyers in its launch block.",
  },
  {
    what: "No buys are arranged.",
    detail: "No bought volume, no coordinated fill. The only promotion is telling people the launch exists.",
  },
  {
    what: "Every reading is published as it happens.",
    detail:
      "From the same index and the same definitions as every other token: buyers in the launch block, first outside buy, fill, time to graduation or not.",
  },
];

export default function LaunchPage(): ReactElement {
  const launch = readLaunch();
  const commit = launch?.preregistrationCommit ?? null;
  const committedOn = launch?.preregistrationCommittedOn ? formatDayLong(`${launch.preregistrationCommittedOn}T00:00:00Z`) : null;

  return (
    <main className="sheet">
      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">LEDGE&rsquo;s own launch</span>
          <span className="mono token-status">
            {launch?.address ? "live" : launch?.launchAt ? `launches ${launchLabel(launch.launchAt)}` : "not launched yet"}
          </span>
        </div>
        <div className="card-body">
          <h1 className="capability-line">
            A token on pons, counted by the tool that counts all the others, with the expectation
            written down first.
          </h1>
          <p className="dek">
            One launch is n=1 and proves nothing about the tool. What it shows is the method: we
            said what we expect before the outcome was known, and the outcome is published in the
            same place either way.
          </p>
          {launch?.address ? (
            <p className="note">
              The token is live. <Link href={`/t/${launch.address}`}>Its own page</Link> is the record.
            </p>
          ) : null}
        </div>
      </section>

      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">What is being launched</span>
        </div>
        <div className="card-body">
          <p className="note">
            LEDGE, on pons, Robinhood Chain. Paired with ETH, graduation threshold 4.2 ETH, creator
            tax 3%.{" "}
            {launch?.launchAt
              ? `Launch: ${launchLabel(launch.launchAt)}, chosen for when most of the venue is awake, not from the hour-of-day rates.`
              : "The launch day and hour are the last thing set; the document is frozen the moment they are."}
          </p>
        </div>
      </section>

      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">What we commit to</span>
          <span className="note note--fine">checkable by anyone</span>
        </div>
        <div className="card-body">
          <ol className="token-rows">
            {COMMITMENTS.map((row) => (
              <li key={row.what} className="token-row">
                <div className="token-row-head">
                  <span className="token-row-what">{row.what}</span>
                </div>
                <p className="token-row-detail">{row.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">What we expect</span>
          <span className="note note--fine">record as of 12 Sep 2026</span>
        </div>
        <div className="card-body">
          <p className="note">
            Launches like this one, ETH-paired with a 2 to 3% creator tax: 2.52% graduated (588 of
            23,353), 1.37% leaving out graduations inside 5 minutes. Roughly 1 in 40, and 1 in 73
            the slow way.
          </p>
          <p className="note">
            We expect the slow way or not at all. If it graduates, in tens of minutes to hours, not
            seconds. A fill inside five minutes contradicts the commitments above and would be
            reported as such. If it does not graduate, that is the base-rate outcome and is
            published with the same prominence.
          </p>
        </div>
      </section>

      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">How it is judged</span>
        </div>
        <div className="card-body">
          <p className="note">
            The token&rsquo;s own page is the record. Its readings at launch, +1 h, +24 h and +7 d
            are copied into the document&rsquo;s Outcome section with their measurement times, and
            each expectation above is marked matched or not matched in one line, without narrative.
          </p>
          {commit ? (
            <p className="note note--fine">
              Written first and committed as <code>{commit}</code>
              {committedOn ? ` on ${committedOn}` : ""}. Nothing above its Outcome heading is edited
              after that.{" "}
              <a href={`https://github.com/hemjay07/ledge/commit/${commit}`}>The commit</a> ·{" "}
              <a href="https://github.com/hemjay07/ledge/blob/main/PREREGISTRATION.md">the full text</a>{" "}
              · <Link href="/method#h-preregistration">on the method page</Link>.
            </p>
          ) : (
            <p className="note note--fine">Not yet committed.</p>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
