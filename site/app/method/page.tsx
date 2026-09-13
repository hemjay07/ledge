import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Footer } from "../../components/Footer";
import { numberFile } from "../../lib/number";
import { methodHtml } from "../../lib/method";

export const metadata: Metadata = {
  title: "Method — LEDGE",
  description:
    "How the Pons Number is measured: sources, definitions, cohort buckets, freshness, and the command that regenerates every figure from the public data.",
};

const RECOMPUTE = "python pipeline/recompute.py --check";

export default function Method(): ReactElement {
  const html = methodHtml();

  return (
    <main className="sheet">
      <div className="evidence-lead">
        <h1 className="kicker">METHOD</h1>
        <p className="dek">How every number on this site is counted, and how to recompute it.</p>
        <p className="note">LEDGE does not score, rank, or predict individual tokens.</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="kicker card-kicker">RECOMPUTE</h2>
          <span className="note note--fine mono">definitions {numberFile.definitionsVersion}</span>
        </div>
        <p className="note" id="h-recompute">
          Every figure on this site comes from <code>data/number.json</code>, which is regenerated
          from the raw launch and graduation files with no network access. Clone the repository and
          run:
        </p>
        <pre className="cmd">{RECOMPUTE}</pre>
        <p className="note note--fine">
          The command exits non-zero if the regenerated file differs from the committed one by a
          single byte. Continuous integration runs it on every commit, so a rendered number that
          does not follow from the public data cannot deploy. Schema version{" "}
          {numberFile.schemaVersion} · chain {numberFile.chainId} · first indexed block{" "}
          {numberFile.firstIndexedBlock.toLocaleString("en-US")}.
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="kicker card-kicker">DEFINITIONS</h2>
          <span className="note note--fine">binding on the crawler, the site and the tests</span>
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
          Other sites publish figures about pons under different definitions. Where a number here
          looks unlike one there, this is usually why.
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
          Read from each site&rsquo;s own pages on the date above. A site that changes its
          definitions after that date is not reflected here until this table is re-read.
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="kicker card-kicker">THE RECORD</h2>
          <span className="note note--fine">append-only, dated</span>
        </div>
        <p className="note" id="h-record">
          Two things on this site never get rewritten. The changelog under DEFINITIONS above
          carries a dated entry for every change to a definition, with the figures that moved
          when it changed. And <code>data/number.json</code> is committed on every crawl, so its
          git history is the sequence of every number this site has ever published, with the raw
          files each one was computed from beside it. A figure quoted from here on a given day
          can be checked against what the site published that day.
        </p>
      </div>

      <Footer />
    </main>
  );
}
