import type { Metadata } from "next";
import { social } from "../../lib/social";
import type { ReactElement } from "react";
import { Footer } from "../../components/Footer";
import { GraveyardBoard } from "../../components/Graveyard";
import { StaleBanner } from "../../components/StaleBanner";
import { numberFile } from "../../lib/number";

const { crawledAt, staleAfterSeconds } = numberFile;

export const metadata: Metadata = social("/graveyard", "The graveyard", "Launches LEDGE has indexed that took zero buys, at least 72 hours after their own launch block. Scoped to the activity index's own window: a launch outside that window is not counted. No score, no grade, no verdict.", "graveyard");

export default function Graveyard(): ReactElement {
  return (
    <>
      <StaleBanner crawledAt={crawledAt} staleAfterSeconds={staleAfterSeconds} />

      <main className="sheet">
        <GraveyardBoard />
        <Footer />
      </main>
    </>
  );
}
