import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Footer } from "../../components/Footer";
import { GraveyardBoard } from "../../components/Graveyard";
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
        <GraveyardBoard />
        <Footer />
      </main>
    </>
  );
}
