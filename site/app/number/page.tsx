import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Age } from "../../components/Age";
import { Fold } from "../../components/Fold";
import { Stat } from "../../components/Stat";
import { Footer } from "../../components/Footer";
import { StaleBanner } from "../../components/StaleBanner";
import { h24, numberFile, SITE_URL } from "../../lib/number";
import { formatCount, formatDurationLong, renderableSample } from "../../lib/format";
import { fastShareFacts, shareSummary } from "../../lib/summary";

const { crawledAt, staleAfterSeconds } = numberFile;

/* The card page carries the sample too: this page is the one that travels. */
const raisedNothing = renderableSample(numberFile.samples, "raisedNothing");

const exFast = h24.excludingFast;
const cutoffWords = formatDurationLong(exFast.cutoffSeconds);

/* One string reaches the description, both unfurl descriptions and the card's
   alt text, and it is built by the shared formatter: when the rate may not be
   printed, none of the four carries a percentage. */
const summary = shareSummary(h24, cutoffWords);
const fast = fastShareFacts(h24);

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
        <div className="card">
          <div className="card-header">
            <span className="kicker card-kicker">THE PONS NUMBER · last 24 hours</span>
            <Age crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} prefix="measured" />
          </div>

          {/* The poster figure, the second figure and the fast-graduation
              finding, exactly as Fold/OneInFigure render them today — this
              page is the one that travels, and the share card is generated
              from it. Nothing here changes what a figure says or its data
              attributes (tests/og*.test.ts, tests/lead.test.tsx,
              tests/sample.test.tsx). */}
          <Fold
            w={h24}
            crawledAt={crawledAt}
            staleAfterSeconds={staleAfterSeconds}
            sample={raisedNothing}
            /* Why the second figure exists: most graduations are the fast
               ones. This sentence used to sit on the home page. When the home
               page stopped reprinting the whole instrument on 2026-09-10 it
               would otherwise have been left on no page at all, and a
               finding that exists on no page is hidden, which CONSTRAINTS 5
               forbids. It lives here, on the page the figure belongs to and
               the one that travels. */
            finding={
              fast.insufficient ? (
                <Stat
                  value={null}
                  n={fast.n}
                  window="24h"
                  updatedAt={crawledAt}
                  insufficient
                  name="fast-shares"
                />
              ) : (
                <>
                  <Stat
                    className="mono"
                    name="fast-under-cutoff"
                    value={fast.underCutoff.rate}
                    n={fast.n}
                    window="24h"
                    updatedAt={crawledAt}
                    insufficient={fast.underCutoff.insufficient}
                  />{" "}
                  of graduations completed inside {cutoffWords};{" "}
                  <Stat
                    className="mono"
                    name="fast-under-60"
                    value={fast.under60.rate}
                    n={fast.n}
                    window="24h"
                    updatedAt={crawledAt}
                    insufficient={fast.under60.insufficient}
                  />{" "}
                  inside 60 seconds.{" "}
                  <span className="den">
                    (n&nbsp;=&nbsp;<span className="mono">{formatCount(fast.n)}</span> graduations ·
                    24 h)
                  </span>
                </>
              )
            }
          />

          <details className="board-what-counts">
            <summary>How this is counted</summary>
            <p className="note note--fine">
              <span className="mono">stale</span> in <a href="/number.json">number.json</a> is what the
              generating run knew about itself when it wrote the file; compute the age of the
              measurement from <span className="mono">crawledAt</span>. The card image carries the age
              it had at generation. Full data: <a href="/number.json">number.json</a>.
            </p>
          </details>
        </div>

        <Footer />
      </main>
    </>
  );
}
