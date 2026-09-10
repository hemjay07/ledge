import type { Metadata } from "next";
import type { ReactElement } from "react";
import { ColophonStrip, RunningHead } from "../../components/ColophonStrip";
import { Footer } from "../../components/Footer";
import { LedgerEntry } from "../../components/LedgerEntry";
import { LiveBoardFull } from "../../components/Live";
import { SheetNav } from "../../components/SheetNav";
import { StaleBanner } from "../../components/StaleBanner";
import { numberFile } from "../../lib/number";

const { crawledAt, staleAfterSeconds } = numberFile;

export const metadata: Metadata = {
  title: "Live board — LEDGE",
  description:
    "Every Pons curve with activity in the indexed window: buys, sells, distinct first-block buyers, and each launch's own fill against its own graduation threshold. No score, no grade, no verdict.",
};

export default function Live(): ReactElement {
  return (
    <>
      <StaleBanner crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />

      <main className="sheet">
        <SheetNav current="live" />
        <RunningHead mark="LEDGE · LIVE" win="Every curve with activity · 01" />

        <div className="fold" style={{ paddingBottom: "1.5rem" }}>
          <h1 className="kicker">The live board</h1>
          <p className="lede" style={{ marginTop: "0.5rem" }}>
            One row per token that has taken a trade in the indexed window: its buys, its sells,
            its distinct first-block buyers, and its own fill against its own graduation
            threshold. Sortable by a column every row already shows.
          </p>
        </div>
        <ColophonStrip stamp="Live · refreshes every 15 s" />

        <LedgerEntry folio="02" id="h-live-board" heading="Every curve with activity">
          <LiveBoardFull />
        </LedgerEntry>

        <LedgerEntry folio="03" id="h-live-what" heading="What this counts">
          <p className="lede">
            Buys, sells, and quote in and out are counted from indexed curve trades, not read
            from the curve itself: the curve skims a fee and the creator tax off quote in before
            its own reserve sees it, so the net-quote fill here is an upper bound on the curve's
            real reserve, not a live read of it. A launch older than the indexed record has a
            partial count, and its own row says so.
          </p>
          <p className="note">
            Distinct first-block buyers is absent, never zero, when that launch's own block was
            never indexed. Zero means the block was read and nobody bought in it.
          </p>
        </LedgerEntry>

        <Footer />
      </main>
    </>
  );
}
