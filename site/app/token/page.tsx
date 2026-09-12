import type { Metadata } from "next";
import type { ReactElement } from "react";
import Link from "next/link";
import { Footer } from "../../components/Footer";

/* The token, for someone who followed the pons listing here.

   Written from LAUNCH.md "What the token is" (2026-09-10) and added to the
   site on 2026-09-12 (REVAMP.md, "two surfaces the mockups did not have"):
   a buyer who lands on ledge.tools from the listing must find that the token
   exists and what it is for, or the token is detached from the project.

   Three rules bind this page harder than any other on the site.

   1. Nothing here is a promise of return. No yield, no revenue share, no
      buyback, no airdrop. Those are the shape of a security, and this page
      says so rather than hinting otherwise.
   2. Nothing is claimed as running until it runs. Each thing holders get
      carries its status. LAUNCH.md: "an unbuilt promise in the one line
      every buyer reads is exactly the defect this file exists to prevent."
   3. The agent gets one sentence, as what the fees would build. PLAN.md
      Phase 2: it may be stated as intent, never as owed, dated or nearly
      done. If it is never built, nobody who read this page was misled. */

export const metadata: Metadata = {
  title: "The token — LEDGE",
  description:
    "What the LEDGE token on pons is, what holding it does, and what it does not do. The data on this site stays free and unkeyed for everyone.",
};

const STATUS = {
  launched: false,
  telemetry: false,
  room: false,
  votes: false,
} as const;

function Status({ on, label }: { on: boolean; label: string }): ReactElement {
  return (
    <span className={on ? "mono token-status token-status--on" : "mono token-status"}>
      {on ? label : "not yet running"}
    </span>
  );
}

export default function Token(): ReactElement {
  return (
    <main className="sheet">
      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">The token</span>
          <Status on={STATUS.launched} label="launched on pons" />
        </div>
        <div className="card-body">
          <h1 className="capability-line">
            LEDGE will launch a token on pons. The data on this site stays free for everyone,
            token or not.
          </h1>
          <p className="dek">
            Every figure here is public and unkeyed, and stays that way. The token does not buy
            access to any number. What it buys is set out below, each with whether it is running
            yet.
          </p>
        </div>
      </section>

      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">1 · The token is the subject</span>
          <Status on={STATUS.telemetry} label="on the front page" />
        </div>
        <div className="card-body">
          <p className="dek">
            LEDGE has timed every graduation on pons. Then it launches one. Every reading this
            site takes of another launch, it takes of its own, from the same index, under the
            same definitions, with no special treatment: distinct buyers in its own launch block,
            its own fill, its own time to graduation, its own creator fees as they accrue. On the
            front page, as it happens, including the parts that look bad.
          </p>
          <p className="note">
            It is the only token on the venue whose complete launch telemetry is published by the
            instrument that measures the venue. It can go wrong in public, which is the point.
          </p>
        </div>
      </section>

      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">2 · The room hears it first</span>
          <Status on={STATUS.room} label="posting" />
        </div>
        <div className="card-body">
          <p className="dek">
            The bot posts each reading to the holders&rsquo; room as the index produces it: a
            graduation and how long it took, a launch entering the graveyard, a curve taking its
            first buys from many distinct wallets in its own block.
          </p>
          <p className="note">
            Every one of those facts is on this site, free, seconds later. The room gets them
            without watching for them. The bot says what happened and never what it means or what
            to do with it.
          </p>
        </div>
      </section>

      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">3 · Holders decide what is measured next</span>
          <Status on={STATUS.votes} label="open" />
        </div>
        <div className="card-body">
          <p className="dek">
            What the index covers next — another venue, another chain, a cohort nobody has cut —
            is put to the room. It is a say over the roadmap, not over the numbers: no vote can
            change a definition, move a threshold or unpublish a finding. Those are settled by{" "}
            <Link href="/method">the method</Link> and its recompute gate.
          </p>
        </div>
      </section>

      <section className="card token-card">
        <div className="card-header">
          <span className="kicker card-kicker">What holders do not get</span>
        </div>
        <div className="card-body">
          <ul className="token-nots">
            <li>No yield, revenue share, buyback or airdrop.</li>
            <li>No early or exclusive access to any figure.</li>
            <li>No say over any published number.</li>
            <li>Nothing on this site behind a wallet, ever.</li>
          </ul>
          <p className="note">
            Creator fees from the token fund the work. If enough comes in, the next thing built
            is an agent that acts on rules a holder writes against these figures — stated here
            as intent, not as owed.
          </p>
        </div>
      </section>

      <p className="note note--fine token-foot">
        The launch itself: form fields, description and sequence are public in the repository
        (<code>LAUNCH.md</code>). This page changes when a status above does, and the change is
        dated on <Link href="/method">the method page</Link>.
      </p>

      <Footer />
    </main>
  );
}
