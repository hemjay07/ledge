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

**0.1 Whose execution layer?** An agent has to sign transactions. There are two
worlds and they differ by an order of magnitude:

- *His.* CHIT is described in its own documentation as a gas-sponsorship layer
  running scoped sessions across programmable accounts, each with a finite
  budget, an expiry and a tight policy. That is exactly the primitive a safe
  agent needs, and it means **neither project ever holds a user's key.** If this
  is available, the agent is weeks.
- *Ours.* Building scoped delegation, key handling, execution and failure paths
  from nothing is months, and it puts custody risk on one solo developer. If
  this is the answer, the honest recommendation is not to build the agent at all
  and to find a third-party execution layer instead.

**0.2 What does the agent trade?** Curves on pons only, or graduated tokens in
their Uniswap v4 pools as well? Different integration, different risk, different
timeline. Curves-only is smaller and is the obvious v1.

**Until 0.1 is answered, Phase 2 has no estimate and will not be started.**

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

## Phase 2 — the agent, narrow (gated on 0.1)

**Not a product. One rule, one trigger, one execution, a hard spend ceiling and
an expiry.** Something that can be run in front of a room and seen to fire.

- **2.1 The rule the user writes.** The user authors it. We supply triggers and
  execution and never a default strategy, a preset, or a leaderboard of winning
  rules. The moment we ship a suggested rule we are recommending tokens and
  every honest figure on the site stops counting for anything. This will feel
  unfriendly in onboarding and that is the price.
- **2.2 Scoped delegation only.** No key ever touches our infrastructure. A hard
  maximum spend and an expiry, both set by the user, both enforced on-chain.
- **2.3 Failure paths first.** What happens on a reverted transaction, a
  reorganisation, a stale trigger, an RPC outage, a token that graduates between
  trigger and execution. These get designed before the happy path, not after.

**DONE means:** it fires, on-chain, inside its ceiling, in front of a witness,
and every way it can fail has been written down and tested.

---

## Phase 3 — the token (gated on Phase 2 being real)

**The token launches when the agent is demonstrably real, not when it is
finished.** Those are different bars and the distinction is the whole point.

Launching before is selling a promise. `CONSTRAINTS.md` bans "coming soon"
outright, and the reason is not squeamishness: the single asset this project has
is that nothing on it has ever been overstated. Announcing an agent to give
people something to look forward to, taking their money, and then finding the
agent is harder than we thought would be exactly the behaviour the site exists
to measure other people doing.

Everything for the launch itself is already written: `LAUNCH.md` has the form
fields and the description, `PITCH.md` has the case for the operator.

**DONE means:** the token is launched with something working behind it.

---

## Phase 4 — the agent proper

Only after Phase 3 has told us whether anyone wants this. Scope to be written
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

1. **Phase 0 comes back with an answer**, which sets or removes Phase 2.
2. **The operator says what is missing**, because he holds the distribution and
   his criteria are the closest thing to a spec this project has.
3. **A measurement contradicts something in here.** Not an opinion, not a mood,
   and not the most recent thing anyone said — a number that can be checked.

Anything else is the thrashing, and the answer to it is to finish the current
phase first.
