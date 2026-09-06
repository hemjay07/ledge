import type { Metadata } from "next";
import type { ReactElement } from "react";
import { ColophonStrip, RunningHead } from "../../components/ColophonStrip";
import { Footer } from "../../components/Footer";
import { LedgerEntry } from "../../components/LedgerEntry";
import { SheetNav } from "../../components/SheetNav";
import { numberFile } from "../../lib/number";
import { methodHtml } from "../../lib/method";
import { formatStamp } from "../../lib/format";

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
      <SheetNav current="method" />
        <RunningHead mark="LEDGE · METHOD" win={`Definitions ${numberFile.definitionsVersion} · 01`} />

      <div className="fold" style={{ paddingBottom: "1.5rem" }}>
        <h1 className="kicker">Method</h1>
        <p className="lede" style={{ marginTop: "0.5rem" }}>
          These are counts of past launches. They describe the population, not any token. LEDGE
          does not score, rank, or predict individual tokens.
        </p>
      </div>
      <ColophonStrip stamp={formatStamp(numberFile.crawledAt)} />

      <LedgerEntry
        folio="02"
        id="h-recompute"
        heading="Recompute"
        headingNote={`· definitions ${numberFile.definitionsVersion}`}
      >
        <p className="note">
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
      </LedgerEntry>

      <LedgerEntry
        folio="03"
        id="h-definitions"
        heading="Definitions"
        headingNote="· binding on the crawler, the site and the tests"
      >
        <div className="method" dangerouslySetInnerHTML={{ __html: html }} />
      </LedgerEntry>


      <Footer />
    </main>
  );
}
