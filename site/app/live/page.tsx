import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Footer } from "../../components/Footer";
import { LiveBoardFull } from "../../components/Live";
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
        <LiveBoardFull />
        <Footer />
      </main>
    </>
  );
}
