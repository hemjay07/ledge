import type { Metadata } from "next";
import type { ReactElement } from "react";
import Link from "next/link";
import { ColophonStrip, RunningHead } from "../components/ColophonStrip";
import { Footer } from "../components/Footer";
import { numberFile } from "../lib/number";
import { formatStamp } from "../lib/format";

export const metadata: Metadata = {
  title: "No such entry — LEDGE",
  description: "This page is not in the register.",
};

export default function NotFound(): ReactElement {
  return (
    <main className="sheet">
      <RunningHead mark="LEDGE" win="No such entry · 404" />

      <div className="fold">
        <h1 className="kicker">No such entry</h1>
        <div className="figure-block">
          <span className="figure" aria-hidden="true">
            404
          </span>
          <span className="vh">Not found. This page is not in the register.</span>
        </div>
        <p className="caption">
          this page is not in the register{" "}
          <span className="den">
            · the entries that exist are listed below
          </span>
        </p>
      </div>

      <div className="rule-hair" style={{ marginTop: "1.5rem" }} />
      <div className="second">
        <p className="gloss">
          <Link href="/">The Pons Number</Link> · <Link href="/cohorts">Cohorts</Link> ·{" "}
          <Link href="/method">Method</Link> · <Link href="/number">Card</Link> ·{" "}
          <a href="/number.json">number.json</a>
        </p>
      </div>
      <ColophonStrip stamp={formatStamp(numberFile.crawledAt)} />

      <Footer />
    </main>
  );
}
