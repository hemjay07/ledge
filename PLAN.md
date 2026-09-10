# LEDGE — the plan

Written 2026-09-10, after the direction changed from "a statistics site with a
token attached" to **"a free data layer, and an agent that acts on it"**. That
change came from the operator who will decide whether to launch this, and it is
the first product idea in this project's life that came from someone who has
actually earned on the venue.

This file exists to stop the thrashing. In one week this project re-aimed about
five times, and only two of those were driven by evidence arriving rather than
by the most recent conversation. An audit on 2026-09-10 called that out and it
was correct. So this plan names its phases, names what DONE means for each, and
names the only things that are allowed to change it.

---

## What LEDGE is now, in one sentence

**Every figure about the pons launchpad, free to everyone for ever — and an
agent, for holders, that acts on rules the user writes against those figures.**

Information is free. Automation is what the token buys. That distinction is
`CONSTRAINTS.md` clause 8 as amended on 2026-09-10, and it is the whole design.

---

## Phase 0 — two decisions that change everything else

Nothing below can be estimated until these are answered. Both are for the
operator, not for us.

**0.1 How does the agent get authority to spend?** An agent has to sign
transactions with someone's money. This is the hard problem and the dangerous
one, and it has three answers, not two.

*Correction, 2026-09-10:* an earlier draft of this file assumed CHIT could
supply the primitive, on the strength of its documentation mentioning "a finite
ETH gas budget, an expiry, and a tightly scoped session policy". That was a
misreading and it has been checked. **CHIT is a gas-sponsorship layer**: it pays
transaction FEES. Its budget is a gas budget. Its documentation mentions no
spending authority, no trading, no swaps and no DEX execution, and it states it
is a private-beta prototype on Sepolia and **not live on Robinhood Chain**. It
answers "who pays the gas", which is real and small. It does not answer "what is
allowed to spend the user's money", which is everything.

The three real options:

- **Non-custodial: the agent prepares, the user signs.** LEDGE watches for the
  user's rule, builds the transaction, and hands it over for a one-click signature
  in their own wallet. **No key ever exists on our side and no spending authority
  is ever delegated, so the entire category of risk that could ruin Mujeeb
  personally does not arise.** The cost is that it does not fire while the user
  sleeps. The thing worth noticing is that the hard part of this product is
  *noticing*, not *clicking*: on an 18,000-launch-a-day venue nobody can watch,
  and the value is in the watching. This is days to weeks and it is available now.
- **Delegated, via a third-party account-abstraction provider with session keys.**
  Fully automatic and safe if the provider is sound. The open question is whether
  any such provider supports Robinhood Chain, which is new. **Unverified — needs
  checking before it is counted on.**
- **Build scoped delegation ourselves.** Months, and it puts custody risk on one
  solo developer. The honest recommendation if it comes to this is not to build
  the agent at all.

**The default is the first one** unless the second turns out to be available,
because it delivers most of the value with none of the risk, and because it can
start now. Only ever describe it as what it is: it does not trade for you while
you sleep.

**0.2 What does the agent trade?** Curves on pons only, or graduated tokens in
their Uniswap v4 pools as well? Different integration, different risk, different
timeline. Curves-only is smaller and is the obvious v1.

**Until 0.1 is answered, Phase 2 has no estimate and will not be started.** The
question to put to the operator is not "can we use CHIT" — it cannot do this —
but "do you know of an account-abstraction provider with session keys live on
Robinhood Chain", and failing that, whether a prepare-and-sign agent is enough
for what he had in mind.

---

## Phase 1 — the site does its new job (days, not weeks)

The site's job changed. It used to be "publish an honest number". It is now
**"show a person what is happening, and show them what they could have an agent
watch for"**. That is a real information architecture, which is why the revamp
kept sliding around before: it had no job to be designed against.

- **1.1 UX pass.** Intuitive, straightforward, no reading required to understand
  what you are looking at. The audience closes a tab in two seconds.
  *Already done:* front door rebuilt (live pulse, one claim, the distribution
  chart, three paths); home page cut from ten sections to five; the histogram
  carries the accent colour; navigation split into what you browse and how we
  know; the tick that fires only when data lands.
  *Left:* the tables are still tables; terminology is still analyst-shaped in
  places; `/cohorts` and `/cockpit` are untouched broadsheets; nothing has been
  designed for a phone first.
- **1.2 The trigger vocabulary, stated in the interface.** Every figure that
  could one day be an agent rule — distinct buyers in the launch block, fill
  against a launch's own threshold, time since first buy, buys in a window —
  should read on the site as a thing you could watch for, without promising
  anything that watches it yet.
- **1.3 Domain cutover.** `ledge.tools` is registered but still on the
  registrar's parking nameservers. Runbook is in `DEPLOY.md`, seven steps, five
  need dashboard access.

**DONE means:** a person who has never seen it understands what it is in under
five seconds, on a phone, and nothing on it promises a feature that does not
exist.

---

## Phase 2 — the token (revised 2026-09-11)

**Revised.** An earlier draft put the token after a working agent, on the
grounds that launching first would be selling a promise. That was wrong, and it
was wrong because it treated build time as free. It is not free: building the
agent costs money and weeks that a solo developer does not have spare, and the
token launch is the cheapest available test of whether anyone wants this at all.
An independent model on 2026-09-10 put roughly a 94% chance of the token earning
under $100, which is a further argument for finding out early and cheaply rather
than after months of work.

So: **launch on what exists.** A live tool publishing figures nobody else has.
If it converts, the fees fund the agent. If it does not, we learned that in days
and no time was sunk into building for nobody.

**The one line that may not be crossed.** The token is sold on what exists. The
agent may be stated as what the money would build — that is a statement of
intent and it is true. It may never be stated as owed, dated, or nearly done.
The test is simple: **if the agent is never built, nobody who bought should have
been misled.** They bought a working thing and funded an attempt at more. What
that rules out is one sentence in the launch post, anything shaped like "agent
coming soon, buy now", and `CONSTRAINTS.md`'s copy list already bans it.

Everything for the launch itself is written: `LAUNCH.md` has the form fields and
the description, `PITCH.md` has the case for the operator.

**DONE means:** launched on what exists, with no claim about the agent that
would embarrass us if it never shipped.

## Phase 3 — the agent, narrow (gated on 0.1 and on Phase 2 converting)

**Not a product. One rule, one trigger, one execution, a hard ceiling and an
expiry.** Something that can be run in front of a room and seen to fire. Built
with what Phase 2 raised, and only if Phase 2 raised something.

- **3.1 The rule the user writes.** The user authors it. We supply triggers and
  execution and never a default strategy, a preset, or a leaderboard of winning
  rules. The moment we ship a suggested rule we are recommending tokens and
  every honest figure on the site stops counting for anything. This will feel
  unfriendly in onboarding and that is the price.
- **3.2 Prepare-and-sign by default.** No key on our side, no delegated spending
  authority. Fully automatic only if 0.1 turns up a session-key provider live on
  this chain.
- **3.3 Failure paths first.** A reverted transaction, a reorganisation, a stale
  trigger, an RPC outage, a token that graduates between trigger and execution.
  Designed before the happy path, not after.

**DONE means:** it fires, in front of a witness, inside its ceiling, and every
way it can fail is written down and tested.

## Phase 4 — the agent proper

Only after Phase 3 has shipped something narrow and someone has used it. Scope to be written
then, from what people actually asked for in Phase 2, not from what we imagine
now.

---

## Not doing, and why

- **Cross-launchpad indexing.** Weeks of work for a number DefiLlama already
  publishes. Mentioned by the operator, and the weakest item he raised.
- **A creator-coaching or "when to launch" product.** The hour-of-day effect is
  real but not usable: raw and organic hour orderings barely agree, crowding
  explains about a fifth of it, and the whole thing may reflect who launches at
  2am rather than anything about 2am. Recorded in `METHOD.md`, deliberately not
  built.
- **Selling the data as an API.** Assessed and rejected: the closest competitor
  publishes the same category free and open-source with no revenue model, and
  this audience does not pay subscriptions for tools.
- **Naming or ranking wallets and deployers.** Legal exposure. Not negotiable.

---

## The risks, in the order they can hurt

1. **Custody.** One bug is someone else's money and it is Mujeeb personally
   holding it. Mitigated only by never holding a key. If Phase 0.1 comes back
   "ours", this risk alone is a reason not to build the agent.
2. **The recommendation line.** Easy to cross by accident, usually in onboarding
   where a blank rule box feels unfriendly. Crossing it forfeits everything.
3. **Promising the agent early.** Covered by the Phase 3 gate.
4. **The moat is a head start, not a moat.** Graduation time is one subtraction
   on two public timestamps, and Bitquery and Dune hold the data. Nobody has
   published it, which is worth something and is not defensible for long.
5. **The economics are a lottery.** $15,000 to the creator needs $2.14M of
   cumulative volume. The median graduated token pays its creator $0.91 a day.
   The warm room is most of the odds.

---

## What is allowed to change this plan

Only three things, and this list is the point of the file:

1. **Phase 0 comes back with an answer**, which sets or removes Phase 3.
2. **The operator says what is missing**, because he holds the distribution and
   his criteria are the closest thing to a spec this project has.
3. **A measurement contradicts something in here.** Not an opinion, not a mood,
   and not the most recent thing anyone said — a number that can be checked.

Anything else is the thrashing, and the answer to it is to finish the current
phase first.
