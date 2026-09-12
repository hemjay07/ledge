import type { Metadata } from "next";
import type { ReactElement } from "react";
import Link from "next/link";
import { Footer } from "../../components/Footer";

/* The token, for someone who followed the pons listing here.

   Written from LAUNCH.md "What the token is" (2026-09-10), added to the site
   2026-09-12, and cut down the same day: the first version was five cards of
   paragraphs that opened with a disclaimer. A trader wants three things in
   six lines -- what is it, what do I get, what is the catch.

   Three rules bind this page harder than any other on the site.

   1. Nothing here is a promise of return. No yield, no revenue share, no
      buyback, no airdrop. Those are the shape of a security.
   2. Nothing is claimed as running until it runs. Each thing carries its
      status; "from launch" is for what starts the moment the token exists
      (the site already measures every token), "not yet running" for what
      needs something built first.
   3. The agent gets one sentence, as what the fees would build (PLAN.md
      Phase 2): intent, never owed, dated or nearly done. */

export const metadata: Metadata = {
  title: "The token — LEDGE",
  description: "What the LEDGE token on pons is, what holding it gets you, and what it does not.",
};

type Status = "from launch" | "after launch" | "not yet running" | "running";

const ROWS: { what: string; detail: string; status: Status }[] = [
  {
    what: "Its own launch, measured live on the front page",
    detail:
      "Buyers in its launch block, fill, time to graduation, creator fees — the same readings LEDGE takes of every other token, including the bad ones.",
    status: "from launch",
  },
  {
    what: "A room that hears every reading first",
    detail:
      "The bot posts each graduation, each launch that dies, each curve taking real buys, as it happens. What happened, never what to do.",
    status: "not yet running",
  },
  {
    what: "A say in what gets measured next",
    detail: "Another venue, another chain, a cohort nobody has cut. Never a say over a published number.",
    status: "after launch",
  },
];

export default function Token(): ReactElement {
  return (
    <main className="sheet">
      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">The token</span>
          <span className="mono token-status">not launched yet</span>
        </div>
        <div className="card-body">
          <h1 className="capability-line">
            The one token on pons whose launch is measured, live, by the tool that measures all
            the others.
          </h1>
          <p className="dek">
            LEDGE launches on pons like any other token. Everything on this site stays free
            for everyone; holding buys the three things below.
          </p>
        </div>
      </section>

      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">What holding gets you</span>
        </div>
        <div className="card-body">
          <ol className="token-rows">
            {ROWS.map((row) => (
              <li key={row.what} className="token-row">
                <div className="token-row-head">
                  <span className="token-row-what">{row.what}</span>
                  <span
                    className={
                      row.status === "running" || row.status === "from launch"
                        ? "mono token-status token-status--on"
                        : "mono token-status"
                    }
                  >
                    {row.status}
                  </span>
                </div>
                <p className="note token-row-detail">{row.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">Where the money goes</span>
        </div>
        <div className="card-body">
          <p className="dek">
            Creator fees fund the work. If enough comes in, the next thing built is an agent
            that acts on rules you write against these figures — intent, not a promise.
          </p>
          {/* One line, not a card of three "no"s (2026-09-12). It stays because
              a tool token that hinted at yield would be claiming something it
              cannot pay and should not promise; saying so once is the whole
              cost of never being asked. */}
          <p className="note">
            It is not a claim on revenue: no yield, buyback or airdrop, and no vote over a
            published number. The data is free to everyone either way.
          </p>
        </div>
      </section>

      <p className="note note--fine token-foot">
        Launch details are public in the repository (<code>LAUNCH.md</code>). When a status
        above changes, the change is dated on <Link href="/method">the method page</Link>.
      </p>

      <Footer />
    </main>
  );
}
