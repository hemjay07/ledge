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

## What the 2026-09-11 assessment settled

The owner said three times that the interface was wrong for the audience. Twice
I defended it on the grounds that the typography is distinctive and a generic
sans with gradients would look like every other dashboard on this chain. **That
defence conflated two decisions**: keeping a typographic identity, and keeping a
flat single-plane document. Only the first was ever argued. Three independent
assessors were asked, one of them briefed specifically to argue against changing
anything.

**They agreed with him on every structural point, including the defender.**

| Claim | Verdict | The measurement |
|---|---|---|
| The page is enormous | **True** | `/graduated` ships **1.31 MB** of HTML, **2,539 rows**, about **112,000 px** — roughly 125 laptop screens. It grows ~250 rows a day. |
| No pagination | **True** | Nothing anywhere is paginated, virtualised or load-more. |
| No search or filter | **True** | One exact-address lookup. No narrowing a board by pair, tax, activity or age. |
| One plane, no layers | **True** | Every navigation is a full page load. No panels, drawers, tabs or overlays. |
| Too many navs | **True, but a symptom** | Nine destinations exist because there is no single decision surface. |

**Where they split, and the line I took.** He said the look is wrong. All three
said the ARCHITECTURE is wrong and the look is an asset — including the
researcher who spent the task inside DexScreener, Photon, BullX, Axiom, Padre
and PonsScan, and found every one of them to be a dark dashboard with an accent
gradient. His finding: a screenshot of LEDGE is identifiable, a screenshot of
PonsScan looks like five other products. The defender put it as *"build the
scaffolding, do not burn the building"*.

So: **the scaffolding was never built, and no amount of visual work fixes a page
that scrolls 125 screens.** The typefaces and palette stay. The structure changes.

### The work, all of it unanimous

1. **Pagination** on the long boards. Named first by all three.
2. **Filters** by pair, tax, age and activity, with the state in the URL so a
   filtered view is shareable. Every filtered view states its own n, because a
   count over a subset that does not say it is a subset is the same defect as a
   missing denominator.
3. **The lookup into a persistent top bar**, so the only decision on the site is
   reachable without scrolling past the evidence for it.
4. **Navigation down to a smaller primary set**, proof pages behind one entry.
5. **A homepage line saying what this is** before it says what it found. *(done)*

### One disagreement, and the middle I took

The interaction designer said no modals, everything a page or a drawer. The
researcher said a token-detail modal, as every trading terminal does. **A board
row will open a panel**, so a reader keeps their place in the list — **and the
token page stays a real URL underneath**, because that is the thing people paste
into group chats and burying it inside an overlay would throw that away.

### A failure worth recording, because it is a pattern

The graveyard rendered the full forty-word window caveat inside **every row**,
which wrapped in a narrow column, made each row ~450 px tall and pushed the
token address off screen. It did that because I instructed it to make the window
prominent on every row. The rule — every count carries its window — is right.
The instruction for satisfying it was not. **A constraint applied literally,
without judgement about how it renders, produces a page that satisfies the rule
and cannot be used.** Fixed by stating the window once in the caption with a
short per-row marker.

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

---

## 2026-09-12 — the homepage direction, decided page by page

Three complete homepage mockups were built against `design/DESIGN-BRIEF` (kept
in `design/homepage-{terminal,editorial,instrument}.html` with screenshots at
390 and 1280, both themes). None was taken whole. The build is:

- **Instrument's skeleton**: framed cards with a tonal step and a hairline, a
  12-column grid on desktop (hook left, lookup and live right; finding and board
  full width), explicit live / stale / loading / empty states drawn, not
  described.
- **Terminal's order and density**: on a phone, lookup, live, headline, the
  four-row table (share *and* count on every row), the 93.5% callout with equal
  weight to the hook, the chart, five board rows, three doors. The stale clock
  is behaviour, not a colour swatch.
- **Editorial's one sentence** as the kicker: *"Graduated" is not one thing.*
  The headline under it carries the denominator in the sentence: *Of 2,922
  graduations on pons, 15% finished in under 10 seconds.*
- **Chart bars are one colour.** All three mockups coloured the first, last or
  peak bucket differently. That is a verdict about which population is which,
  CONSTRAINTS 6 bans it, and the existing Shape test fails it.

**Two surfaces the mockups did not have, added because the operator named what
was missing (`PLAN.md`, "what is allowed to change this plan", item 2):**

1. **`/token`** — written from `LAUNCH.md` "What the token is": the three things
   holders get, the list of what they do not, and one sentence that the agent is
   what fees would build — exactly the allowance `PLAN.md` Phase 2 gives the
   launch post, and no more. Built before launch. A buyer who follows the pons
   listing to ledge.tools must find that the token exists and what it is for.
2. **A homepage slot for LEDGE's own launch.** Before launch it holds the
   pre-registration (1.5). After launch it is *LEDGE, measured by LEDGE*: the
   `/t/{our address}` facts on the front page under the same rules as every
   other token (`LAUNCH.md` §1). The place is reserved in the homepage build;
   the content lands with 1.5.

Sequence for this pass, one page at a time, each screenshotted at 390 and 1280
in both themes and reviewed before the next: home → `/live` → `/t/{address}` →
`/graduated` → `/graveyard` → `/token` → pre-registration → evidence pages.
