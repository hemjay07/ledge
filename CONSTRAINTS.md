# LEDGE — constraints

Every agent that designs, writes, reviews, or tests LEDGE reads this file first. A build that violates any line here fails review regardless of anything else.

Amended 2026-09-09 by `REPOSITION.md`. Four clauses were relaxed because they were costing revenue while protecting nothing about the truth of a number; six were kept, and each now carries the commercial reason it is kept, because a constraint whose reason is only "we said so" gets argued away at the worst moment. The relaxations are listed in the changelog at the bottom, not silently applied — clause 9 applies to this file too.

## The never-list

1. **Never score, predict, or recommend an individual token.** No per-token verdicts, badges, "safety" labels, grades, or probabilities of anything. No sentence that tells a reader what a token will do or what to do about it.

   **Ranking by a measured quantity is permitted, provided the quantity is shown.** A list ordered by buys, volume, curve fill, or age is an ordering of facts, not a claim about a future, and the reader can see exactly what it was ordered by. "Most buys in the last hour, 41" is a fact; "most promising" is a verdict. Per-token pages may state that token's own facts — its buys, its distinct buyers, its fill against its own threshold, what its cohort did — and may not state a conclusion.

2. **Never print a wallet or deployer address as a subject.** Deployer statistics are aggregate distributions. The only addresses on the site are the pons factory, a token's own address on its own page, and LEDGE's own contracts, shown as provenance. *Kept for legal exposure, not delicacy: naming individuals as manipulators on a US LLC's platform invites a takedown we could not fight.*

3. **Never show a number without its denominator.** Every rate carries `n`; every cohort carries its sample size; every figure carries the window it was computed over. A count carries the window too. *Kept because this is what lets a figure survive contact with a $551M company's communications team.*

4. **Never fake precision.** No confidence intervals, no decimals beyond what n supports, no extrapolations presented as counts. Cohorts with n < 30 render as "not enough data (n=…)" — never as a percentage. *Same reason as 3.*

5. **Never hide an ugly number.** If the rate falls, the rate falls. If a finding reverses when more data arrives, we publish the reversal and keep the old value in the changelog. *Kept because it is the only citable thing we own. Choosing which true figure leads is free and ours to choose; deleting one is not.*

6. **Never present the 5-minute cutoff as a definition of "rigged".** It is a descriptive threshold. Copy says "graduated inside 5 minutes" and "excluding launches that graduated inside 5 minutes" — never "organic" as a bare label without that definition within reach. Where a coordination signal is wanted, prefer first-block buyer concentration, which costs money to fake.

7. **Never let a stale number look fresh.** Every figure shows its age. Past the published `staleAfterSeconds` the page says so plainly and the card renders the age.

8. **Never require a wallet or an account to see a figure.** No connect-wallet gate, no paywall, no sign-in on any number. `/number.json` stays public and unkeyed. Every rate, count, cohort, distribution and per-token fact is readable by anyone, for ever, without identifying themselves. *This is the clause the whole project rests on: an instrument that checks who you are before it answers is not an instrument.*

   **An optional email field is permitted** for the weekly dispatch. There is no integrity content in refusing to let a reader subscribe.

   **Automation may be conditioned; information may not.** A push alert, the bot added to someone's own group, a saved watchlist — these deliver no figure that is not already free and unkeyed on the site, and conditioning one of them on holding the token hides nothing from anyone. The test is exact and it is not a matter of judgement: *if a person without the token cannot reach that figure by looking, the gate is illegal.* Convenience may be earned. Knowing may not.

   The distinction is not a loophole and the difference between the two is the difference between this project and a signal service. A gated alert says "here is a thing you could have seen"; a gated number says "you may not see". The first is a courier. The second is what this clause exists to forbid.

9. **Never move a threshold, a band, or a constraint quietly.** Any change to a definition — window, cutoff, bucket edges — or to this file is a dated entry on `/method` and in the changelog below.

10. **Never imply a relationship with pons.** No "official", no "partner", no "in collaboration with", no endorsement, and no borrowing of their mark, wordmark styling, or palette. Reference pons in lowercase and link back to the app, as their documentation asks. Carry a non-affiliation line in the footer and on `/method`. *Kept because their documentation forbids the alternative explicitly, and because this is the one line that would actually end the relationship.*

11. **Never present an external figure as a chain measurement.** A number sourced from a third-party API rather than derived from chain data is exempt from the recompute gate and must say on the page where it came from. An unlabelled external figure is the same defect as a missing denominator.

## The copy list

Still banned everywhere — the site, the card, the README, the token description:

- Any claim that cannot be supported: "guaranteed", "safe", "risk-free", "will", "sure thing", or any per-token verdict vocabulary — score, grade, rating, odds, chance, likely, rug.
- "We believe", "our mission", "in today's fast-moving…"
- Any emoji in UI copy. *A matter of visual identity rather than principle, and it costs nothing.*
- "DYOR" and "not financial advice" as boilerplate — `/method` states what the numbers are and are not, once, plainly.
- "Connect wallet".
- Gradients, glows, purple/violet, hero illustrations, mascots.
- Any sentence telling the reader what to do with a number.

No longer banned: **energy.** Forceful, direct writing about true numbers is not dishonesty, and the ban on it was costing us readers while protecting nothing. "Alpha", "edge" and "signals" are unbanned as ordinary words; they remain banned as promises.

## Design posture

Two registers under one roof.

**Instrument pages** — `/number`, `/method`, `/cohorts` — keep the broadsheet: one figure carries the page, type does the work, colour is reserved for the stale state.

**Discovery pages** — `/`, `/live`, `/graduated`, `/creators`, `/t/{address}` — may be dense, may update live, and may spend colour on a progress rule against a launch's own threshold. The stale state keeps its own colour and stays unambiguous against anything else colour is spent on.

## Statistical posture

- Counts and rates only. No modelling.
- Every chain-derived number on the site must be reproducible from the public data files with a one-line script documented on `/method`. External figures are labelled under clause 11 and exempt.
- The independent recompute in CI must match the rendered numbers exactly, or the deploy fails.

## Changelog

- **2026-09-10** — clause 8 split into information and automation. Every figure stays free and unkeyed to anyone for ever, which is unchanged and is now stated more strongly than before. What changes is that a convenience which *delivers* a figure — an alert, the bot in someone's own group, a watchlist — may be conditioned on holding the token, because it withholds no information from anyone: the test is whether a person without the token can still reach that figure by looking, and if they cannot, the gate is not permitted. Reason: the token had no honest reason to exist. `LAUNCH.md` said in as many words that holders get nothing, four independent assessments on 2026-09-10 called that the critical defect, and the operator who will launch it said the same unprompted. The alternatives were both worse: gating a number would end the project's only real claim, and promising a return would make the token a security-shaped thing a solo developer should not be issuing. This is the one relaxation that unlocks a reason to hold without touching what anyone can know. The design posture is also relaxed in the same pass: one accent colour is now permitted for live activity, provided it stays unambiguous against the stale colour, because "colour is reserved for the stale state" was making the discovery pages inert and protected nothing about whether a number is true.

- **2026-09-09** — clause 1 split: scoring, predicting and recommending stay banned; ranking by a shown measured quantity is permitted, and a per-token page may state that token's own facts. Clause 8 relaxed to permit an optional email field. Clause 11 added for external figures. Clause 10 rewritten from "never negotiate position relative to pons" to a concrete non-affiliation rule matching their published guidance. The copy list narrowed to claims that cannot be supported; the ban on energetic writing is lifted. Design posture split into instrument and discovery registers. Reason, in full, in `REPOSITION.md`: the relaxed clauses were costing the acquisition, retention and conversion surfaces while protecting nothing about whether a number is true.
