import type { Metadata } from "next";
import { social } from "../../lib/social";
import type { ReactElement } from "react";
import { Footer } from "../../components/Footer";
import { LiveBoardFull } from "../../components/Live";
import { StaleBanner } from "../../components/StaleBanner";
import { numberFile } from "../../lib/number";

const { crawledAt, staleAfterSeconds } = numberFile;

export const metadata: Metadata = social("/live", "Live board", "Every pons curve with activity in the indexed window: buys, sells, distinct first-block buyers, and each launch's own fill against its own graduation threshold. No score, no grade, no verdict.", "graduation");

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
