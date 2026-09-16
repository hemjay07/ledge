import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Footer } from "../../components/Footer";
import { numberFile } from "../../lib/number";
import { changelogHtml, methodHtml, preregistrationHtml } from "../../lib/method";
import { readLaunch } from "../../lib/launch";
import { readCoverage } from "../../lib/coverage";
import { coverageCardText } from "../../lib/coverage-text";
import { formatDayLong } from "../../lib/format";

export const metadata: Metadata = {
  title: "Method — LEDGE",
  description:
    "How every number on LEDGE is counted: the source, the definitions, how other pons sites define theirs, and the command that regenerates every figure from the public data.",
};

const RECOMPUTE = "python pipeline/recompute.py --check";

export default function Method(): ReactElement {
  const html = methodHtml();
  const changelog = changelogHtml();
  const coverage = readCoverage();
  const coverageText = coverage ? coverageCardText(coverage) : null;
  const launch = readLaunch();
  const preregistration = preregistrationHtml();

  return (
    <main className="sheet">
      <div className="evidence-lead">
        <h1 className="kicker">METHOD</h1>
        <p className="dek">How every number on this site is counted, and how to check it yourself.</p>
        <p className="note">LEDGE rates, ranks and predicts nothing. It counts.</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="kicker card-kicker">RECOMPUTE</h2>
          <span className="note note--fine mono">definitions {numberFile.definitionsVersion}</span>
        </div>
        <p className="note" id="h-recompute">
          Every figure on this site is in one file, <code>data/number.json</code>, built from the
          raw launch and graduation records with no network access. Clone the repository and run:
        </p>
        <pre className="cmd">{RECOMPUTE}</pre>
        <p className="note note--fine">
          If the file it rebuilds differs from the published one by a single byte, the command
          fails, and so does the deploy. Schema version {numberFile.schemaVersion}, chain{" "}
          {numberFile.chainId}, first indexed block{" "}
          {numberFile.firstIndexedBlock.toLocaleString("en-US")}.
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="kicker card-kicker">DEFINITIONS</h2>
          <span className="note note--fine">binding on the crawl, the site and the tests</span>
        </div>
        <div className="method" id="h-definitions" dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      {/* C6 (BRAINSTORM-2026-09-13 §3): a reader who has seen another pons
          site's survival or safety figure will compare it with ours and, if
          the definitions differ silently, assume ours is wrong. The table
          states the definitions side by side, from their public pages, with
          the date they were read. Facts only; no adjectives. */}
      <div className="card">
        <div className="card-header">
          <h2 className="kicker card-kicker">COMPARED</h2>
          <span className="note note--fine">as observed on 13 Sep 2026</span>
        </div>
        <p className="note" id="h-compared">
          Other sites publish pons figures under other definitions. When a number here does not
          match one there, this table is usually why.
        </p>
        <div className="scroller">
          <table>
            <caption>Definitions, side by side, as read from each site on 13 September 2026.</caption>
            <thead>
              <tr>
                <th scope="col">Figure</th>
                <th scope="col">LEDGE</th>
                <th scope="col">ponsscan.com</th>
                <th scope="col">ponsscan.xyz</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">A dead launch</th>
                <td>zero buys in the 72 hours after its launch block</td>
                <td>zero trades in 12 hours</td>
                <td>&mdash;</td>
              </tr>
              <tr>
                <th scope="row">Sample behind a figure</th>
                <td>every indexed launch in a stated window, with n on the row</td>
                <td>the live tape</td>
                <td>a fixed cohort of 12 tokens from July, re-checked every 5 minutes</td>
              </tr>
              <tr>
                <th scope="row">Per-token verdict</th>
                <td>none; a token page shows its own facts and its cohort</td>
                <td>none stated</td>
                <td>a rule-based number from 0 to 100 per token</td>
              </tr>
              <tr>
                <th scope="row">Wallets</th>
                <td>never named</td>
                <td>leaderboard; wallet-claiming (link an X profile) announced</td>
                <td>creator leaderboard</td>
              </tr>
              <tr>
                <th scope="row">Reproducing a figure</th>
                <td>
                  <code>{RECOMPUTE}</code> from the public data; CI refuses a mismatch
                </td>
                <td>not stated</td>
                <td>open source</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="note note--fine">
          Read from each site&rsquo;s own pages on the date above. If a site changes its
          definitions later, this table is wrong until it is read again.
        </p>
      </div>

      {coverage && coverageText ? (
        /* INDEXER.md §3, TODO A4: the live index measured against the
           canonical record after every crawl (pipeline/coverage.py). A count
           about our own index, published with its n like everything else. */
        <div className="card">
          <div className="card-header">
            <h2 className="kicker card-kicker">THE LIVE INDEX</h2>
            <span className="note note--fine">measured {formatDayLong(coverage.measuredAt)}</span>
          </div>
          <p className="note" id="h-coverage">
            The live board, the graveyard and each token page read from a second index that
            follows the chain every few seconds. After every crawl, {coverage.sampled} launches
            from the last 24 hours of the canonical record are checked against it.
          </p>
          <p className="note">{coverageText.coverage}</p>
          <p className="note">{coverageText.launchBlock}</p>
          <p className="note note--fine">{coverageText.freshness}</p>
        </div>
      ) : null}

      {launch ? (
        /* PREREGISTRATION.md, committed before LEDGE's own launch and never
           edited above its Outcome heading; the hash is how anyone checks. */
        <div className="card">
          <div className="card-header">
            <h2 className="kicker card-kicker">PRE-REGISTRATION</h2>
            <span className="note note--fine mono">
              commit {launch.preregistrationCommit} · {formatDayLong(`${launch.preregistrationCommittedOn}T00:00:00Z`)}
            </span>
          </div>
          <p className="note" id="h-preregistration">
            LEDGE launches its own token on pons. What it expects and what it commits to were
            written down first, committed to the public repository as{" "}
            <code>{launch.preregistrationCommit}</code>, and are not edited above the Outcome
            heading. {launch.address ? (
              <>
                The token is live: <a href={`/t/${launch.address}`}>its own page</a> is the record,
                under the same definitions as every other token.
              </>
            ) : (
              "The token has not launched yet."
            )}
          </p>
          <details className="board-what-counts">
            <summary>Open the pre-registration</summary>
            <div className="method" id="h-preregistration-text" dangerouslySetInnerHTML={{ __html: preregistration }} />
          </details>
        </div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <h2 className="kicker card-kicker">THE RECORD</h2>
          <span className="note note--fine">append-only, dated</span>
        </div>
        <p className="note" id="h-record">
          Two things here are never rewritten. The changelog below has a dated entry for every
          change to a definition, with the figures that moved. And <code>data/number.json</code>{" "}
          is committed on every crawl, so its git history is every number this site has ever
          published, next to the raw records it was built from. A figure quoted from here on any
          day can be checked against what the site said that day.
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="kicker card-kicker">CHANGELOG</h2>
          <span className="note note--fine">every change to a definition, dated</span>
        </div>
        <details className="board-what-counts">
          <summary>Open the changelog</summary>
          <div className="method" id="h-changelog" dangerouslySetInnerHTML={{ __html: changelog }} />
        </details>
      </div>

      <Footer />
    </main>
  );
}
