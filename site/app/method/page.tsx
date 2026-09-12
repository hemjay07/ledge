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

      <Footer />
    </main>
  );
}
