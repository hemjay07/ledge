import type { Metadata } from "next";
import type { ReactElement } from "react";
import { ColophonStrip, RunningHead } from "../../components/ColophonStrip";
import { Footer } from "../../components/Footer";
import { LedgerEntry } from "../../components/LedgerEntry";
import { GraveyardBoard } from "../../components/Graveyard";
import { SheetNav } from "../../components/SheetNav";
import { StaleBanner } from "../../components/StaleBanner";
import { numberFile } from "../../lib/number";

const { crawledAt, staleAfterSeconds } = numberFile;

export const metadata: Metadata = {
  title: "The graveyard — LEDGE",
  description:
    "Launches LEDGE has indexed that took zero buys, at least 72 hours after their own launch block. Scoped to the activity index's own window: a launch outside that window is not counted. No score, no grade, no verdict.",
};

export default function Graveyard(): ReactElement {
  return (
    <>
      <StaleBanner crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />

      <main className="sheet">
        <SheetNav current="graveyard" />
        <RunningHead mark="LEDGE · GRAVEYARD" win="Launches at zero buys · 01" />

        <div className="fold" style={{ paddingBottom: "1.5rem" }}>
          <h1 className="kicker">The graveyard</h1>
          <p className="lede" style={{ marginTop: "0.5rem" }}>
            One row per launch LEDGE has indexed that took zero buys, at least 72 hours after its
            own launch block: its pair, its creator tax, its age, its sells, and its distinct
            first-block buyers where that block was itself indexed.
          </p>
        </div>
        <ColophonStrip stamp="Live · refreshes every 15 s" />

        <LedgerEntry folio="02" id="h-graveyard-scope" heading="What this can and cannot see">
          <p className="lede">
            The activity index that feeds this page only began recording curve trades recently.
            A launch that finished its whole life before that start has no row here at all, and
            its absence means it was never measured -- it does not mean the launch took a buy.
            The exact count of launches the index currently holds, and the oldest one among them,
            is printed above the table on every load.
          </p>
        </LedgerEntry>

        <LedgerEntry folio="03" id="h-graveyard-board" heading="Launches at zero buys, 72h or older">
          <GraveyardBoard />
        </LedgerEntry>

        <LedgerEntry folio="04" id="h-graveyard-what" heading="What this counts">
          <p className="lede">
            Buys and sells are counted from indexed curve trades. A row's buy count is always
            zero -- that is the gate a launch has to meet to appear here at all -- and its sell
            count is whatever LEDGE indexed regardless. A launch older than the indexed record has
            a partial count, and its own row says so.
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
