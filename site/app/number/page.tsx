import type { Metadata } from "next";
import type { ReactElement } from "react";
import { ColophonStrip, RunningHead } from "../../components/ColophonStrip";
import { Fold } from "../../components/Fold";
import { Footer } from "../../components/Footer";
import { SheetNav } from "../../components/SheetNav";
import { StaleBanner } from "../../components/StaleBanner";
import { h24, numberFile, SITE_URL } from "../../lib/number";
import { formatDurationLong, formatStamp } from "../../lib/format";
import { shareSummary } from "../../lib/summary";

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

        <Fold w={h24} crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />
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
