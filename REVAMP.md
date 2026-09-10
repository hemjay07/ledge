# Phase 1 — the revamp, planned

The detail behind `PLAN.md` Phase 1. Written 2026-09-11.

**This is a plan. Nothing in it has been built.** Items marked *(done)* were
completed before this plan was written and are listed so the remaining work is
visible against them.

---

## Why this phase carries more weight than it used to

The order changed on 2026-09-11: site, then token, then agent. That means **the
site is the entire thing anyone is buying at launch.** It is no longer a warm-up
for the real product. If it does not stand on its own, there is nothing to sell.

The owner's requirement, in his words: *"real, live actionable data"*, and a UX
that is *"intuitive, straightforward and easy to use"*. Right now the live layer
is two numbers and a table.

---

## The one insight this plan is built around

A person does three things here, and only one of them is a decision:

1. **"What is happening right now?"** — browsing. The live board.
2. **"Is this specific token worth anything?"** — **the decision.** Someone sees
   an address in a Telegram group, pastes it, and wants to know whether anything
   real is behind it.
3. **"Can I trust this?"** — the evidence pages.

**Job 2 is the actionable moment and it is currently the weakest surface on the
site.** It is a Worker-rendered page of sentences. It is also the page that gets
pasted, because it is about one token rather than about a population, and it is
the surface an agent rule would eventually be written against.

So the centre of this phase is the lookup and the per-token page. Not the home
page, which is already rebuilt, and not the broadsheets, which are evidence.

---

## 1.1 The per-token page and the lookup — the centre of this phase

**What it must answer, in the order someone asks it:** is this real, how far
along is it, and what did tokens like it do?

Everything needed is already indexed: fill against that launch's own threshold,
buys and sells, quote in and out, first buy time, last activity, **distinct
buyers in the launch's own block**, time to graduation if it graduated, and the
cohort it belongs to.

- Rebuild `/t/{address}` from a page of sentences into a page of facts a person
  can read at a glance. The sentences are good and stay available — the Telegram
  bot and the API render from the same objects and must not diverge.
- Put the lookup at the top of the site, not halfway down the home page. It is
  the most interactive thing here and it is currently buried.
- Make the first-block buyer count the most prominent reading on the page. It is
  the one number that costs real money to fake, and it is the closest thing to
  "is anyone actually here" that the record holds.
- Accept a pasted `ponsfamily.com` URL as well as a bare address. People copy
  URLs, not addresses.

**Line that must not be crossed:** the page states that token's own facts and
never a conclusion. `CONSTRAINTS` 1 permits the first explicitly and forbids the
second. "41 buys, 7 distinct buyers in its launch block" is a fact. Any badge,
score, colour meaning good or bad, or sentence telling the reader what to do
fails review.

**DONE:** a person pastes an address on a phone and has their answer without
scrolling or reading a paragraph.

---

## 1.2 The live board — the browse surface

The strongest live asset and currently a table.

- Give each row a fill rule against its **own** threshold, which is per pair
  token and never 4.2 ETH assumed.
- Surface distinct first-block buyers on the row, not just in the per-token page.
- Make a row's link to its token page obvious. Right now the board is a
  destination rather than a doorway.
- It must be legible on a phone, which a wide table is not. This probably means
  a card-per-token layout below a breakpoint rather than a horizontally
  scrolling table.

**DONE:** readable on a phone without horizontal scrolling, and every row is a
door.

---

## 1.3 Phone first

Nothing here has been designed phone-first, and this audience is on phones.
Every page gets checked at 390px: the boards, the per-token page, the lookup,
the chart, the nav. The screenshot tool already renders 390px.

**DONE:** no page scrolls sideways, and no figure is clipped, at 390px in both
themes.

---

## 1.4 Terminology

The site speaks analyst. "Cohorts", "configurations", "the Pons Number",
"excluding fast graduations" are all internal nouns.

Rename the signposts and the headings. **Do not rename a definition**: `METHOD.md`
defines these terms and `CONSTRAINTS` 9 makes a definition change a dated entry.
A nav label and a page heading are signposts, not definitions. *(The nav split
into "what you browse" and "how we know" is done; "Configurations" became "Pair
and tax".)*

**DONE:** nothing in the primary path requires a glossary.

---

## 1.5 The pre-registration — new, and it only works if written first

Before the token launches, publish what we expect and why: the figures we are
leaning on, what we think will happen, and how confident we are. Afterwards,
publish what actually happened, matched or not.

**This is not evidence the tool works and must never be described as such.** One
launch is n = 1, and treating a single outcome as proof is precisely the error
this site exists to measure other people making. What it demonstrates is method.

The failure case is worth more than the success case. Nobody else on this chain
will publish "we said this, we got that, we were wrong", and that asymmetry is
the entire point of writing it in advance.

It also has to be honest about what we are **not** using. The hour-of-day effect
is real but not usable guidance — `METHOD.md`'s 2026-09-10 entry sets out why —
so the pre-registration must not quietly lean on it.

**DONE:** published, dated, and immutable in the changelog before the token
exists. Worthless if written afterwards.

---

## 1.6 The evidence pages, calmed

`/cohorts`, `/cockpit`, `/method`, `/number` stay dense — they are the proof and
density is appropriate. But they should stop being the default path and stop
opening with methodology before any figure. Lowest priority in this phase.

**DONE:** reachable, unchanged in rigour, no longer the first thing anyone hits.

---

## 1.7 Domain cutover

`ledge.tools` is registered and still on the registrar's parking nameservers.
Seven steps in `DEPLOY.md`; five need dashboard access and are the owner's. Also
still unset: the firewall rate-limit rule and the Cloudflare credentials that let
the API answer independently of the site. Both matter on a launch day and
neither matters now.

**DONE:** `ledge.tools` serves the site, `api.ledge.tools` answers, the rate
limit exists.

---

## Order, and why

1. **1.1 the per-token page and lookup** — the decision surface, the thing that
   gets pasted, and the weakest page on the site.
2. **1.2 the live board** — the browse surface and the only thing that moves.
3. **1.3 phone** — cuts across both above; done as they are built rather than
   after.
4. **1.5 the pre-registration** — small, and must exist before Phase 2.
5. **1.4 terminology** — cheap, do it alongside.
6. **1.6 evidence pages** — last, and skippable if time is short.
7. **1.7 domain** — the owner's, in parallel, any time.

---

## Explicitly not in this phase

- Anything that mentions, implies or teases the agent. Phase 2 sells what exists.
- Cross-venue anything.
- A "when to launch" tool. Measured, found not to support guidance, recorded.
- Changing the typefaces or the palette. Anton, IBM Plex Mono and Newsreader on
  bone and ink are deliberate; a generic sans with an accent gradient is what
  every other dashboard on this chain looks like.
- New statistics. Everything above renders figures that already exist. Any new
  one goes through `pipeline/stats.py` and the recompute gate, which is a
  different kind of work and not this phase.

---

## What DONE looks like for Phase 1 as a whole

A person who has never heard of this arrives from a Telegram link on a phone,
understands what it is in five seconds, pastes a token address, gets an answer,
and can tell that the numbers are checkable. Nothing on the site promises
anything that does not exist.
