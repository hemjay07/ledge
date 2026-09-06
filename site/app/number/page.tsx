import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Age } from "../../components/Age";
import { ColophonStrip, RunningHead } from "../../components/ColophonStrip";
import { Figure } from "../../components/Figure";
import { Footer } from "../../components/Footer";
import { SheetNav } from "../../components/SheetNav";
import { StaleBanner } from "../../components/StaleBanner";
import { h24, numberFile, SITE_URL } from "../../lib/number";
import {
  formatCount,
  formatDurationLong,
  formatOneIn,
  formatStamp,
} from "../../lib/format";
import { excludingFastSentence, ponsNumberSentence, shareSummary } from "../../lib/summary";

const { crawledAt, staleAfterSeconds } = numberFile;

const exFast = h24.excludingFast;
const cutoffWords = formatDurationLong(exFast.cutoffSeconds);

/* One string reaches the description, both unfurl descriptions and the card's
   alt text, and it is built by the shared formatter: when the rate may not be
   printed, none of the four carries a percentage. */
const summary = shareSummary(h24, cutoffWords);

export const metadata: Metadata = {
  title: "The Pons Number — LEDGE",
  description: summary,
  alternates: { canonical: `${SITE_URL}/number` },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/number`,
    siteName: "LEDGE",
    title: "The Pons Number",
    description: summary,
    images: [
      { url: "/og/number.png", width: 1200, height: 630, alt: summary },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "The Pons Number",
    description: summary,
    images: ["/og/number.png"],
  },
};

export default function NumberCard(): ReactElement {
  return (
    <>
      <StaleBanner crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />

      <main className="sheet">
        <SheetNav current="card" />
        <RunningHead mark="LEDGE" win="Trailing 24 hours · 01" />

        <div className="fold">
          <h1 className="kicker">The Pons Number</h1>
          <div className="figure-block">
            <Figure
              name="pons-number"
              value={h24.rate}
              n={h24.launches}
              window="24h"
              updatedAt={crawledAt}
              insufficient={h24.insufficient}
              accessibleText={ponsNumberSentence(h24, crawledAt)}
            />
          </div>
          <p className="caption">
            of <b>{formatCount(h24.launches)}</b> launches in the last 24&nbsp;hours graduated{" "}
            <span className="den">
              · <span className="mono">{formatCount(h24.graduations)}</span> graduations ·{" "}
              <Age crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />
            </span>
          </p>
        </div>

        <div className="rule-hair fold-rule" />
        <div className="second">
          <Figure
            name="excluding-fast"
            variant="secondary"
            value={exFast.rate}
            n={h24.launches}
            window="24h"
            updatedAt={crawledAt}
            insufficient={exFast.insufficient}
            accessibleText={excludingFastSentence(h24, cutoffWords)}
          />
          <p className="gloss">
            excluding launches that graduated inside {cutoffWords}
            {exFast.oneIn === null ? null : (
              <>
                {" "}
                · <b className="mono">{formatOneIn(exFast.oneIn)}</b>
              </>
            )}{" "}
            ·{" "}
            <span className="mono">
              {formatCount(exFast.graduations)} of {formatCount(h24.launches)}
            </span>
          </p>
        </div>
        <ColophonStrip stamp={formatStamp(crawledAt)} />

        <div className="card-note">
          <p className="note note--fine">
            <span className="mono">stale</span> in <a href="/number.json">number.json</a> is what the
            generating run knew about itself when it wrote the file; compute the age of the
            measurement from <span className="mono">crawledAt</span>. The card image carries the age
            it had at generation.
          </p>
        </div>

        <Footer />
      </main>
    </>
  );
}
