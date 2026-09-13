# What to adjust and what to build — brainstorm, 2026-09-13

Four lenses ran after `RESEARCH-2026-09-13.md` §6 (the X pass) landed: a
trader, a contrarian, a pragmatist, a radical. Their full returns are in the
session; this is the synthesis, written as decisions. Everything here is
bound by `CONSTRAINTS.md` and slots into `TODO.md`; nothing below reorders
section A (the data layer comes first).

## Where the four agreed

**1. First-buy timing is the statistic.** The trader wanted it per token
("was I sniped"), the pragmatist scoped it (one field, forward-only, 3–4 h),
the radical wanted it as an alert, and the contrarian's objection — that
@rhanalyticsnow already ships it at wallet level — is the reason to build it
*our* way, not a reason not to: nobody publishes the aggregate with n, and
nobody shows a launch its own first-buy delay next to the population's.
**Decision: A5b stays first after the data layer, and grows one surface:**
on `/t/{address}`, the token's own first-buy delay in seconds beside the
1 s / 3 s / 5 s shares for its tax band, with n. A token's own fact on its
own page names no wallet. The 5-second snipe-tax edge goes into the
histogram in the same change, with the dated method entry.

**2. A page is a pull; this market moves on pushes.** The contrarian's
sharpest point: every account that gets quoted (ponsscan.com,
@rhanalyticsnow) posts, hourly or daily; a correct page at a URL waits. The
radical and the trader arrived at the same answer from the product side
(a narrow Telegram alert; a daily "died today" digest). **Decision: the
Telegram room (B2) is the first push channel, and it carries two things
only:** graduations as they land (already built, not yet running), and one
daily digest computed from `number.json` — launches, zero-buy share,
graduations, median time-to-graduation, each with its n — so the Worker
still computes no statistic. X posts are findings from the same digest, not
tape.

**3. Say the difference where a visitor compares.** Three of four
independently asked for the front-page line and a dated comparison on
`/method`. **Decision: C5 as worded** — *no scores, no wallets, no tape —
the population, its method, and its n* — **plus a comparison table on
`/method`** with an "as observed on 13 Sep 2026" date: ponsscan.xyz's fixed
n=12 cohort against our n-with-window; ponsscan.com's zero-trades-in-12-h
survival against our zero-buys-in-72-h; wallet-claiming against no wallet
named. Facts from their public pages, no adjectives.

**4. The trust surfaces are cheap and nobody else can copy them.** The
pragmatist listed them (coverage/agreement/freshness on `/method`; a
"recompute this ↗" beside each rate, generated from the same code path as
the number; "not enough data (n=17)" visibly counting toward 30). The
contrarian's "neutral incident record" is the same apparatus seen from
outside: the dated method changelog and the git history of `number.json`
already are an append-only log. **Decision: A4 publishes the three figures
even while coverage is ugly, with the one-line reason; the per-cohort
recompute link and the counting-up n ship with A6; `/method` gets one
paragraph saying the changelog and the data history are the record, and
where to find them.**

## What to adjust

- **The token's success metric is referral traffic, not fees.** The
  contrarian is right that fees under $100 would tell us nothing new
  (`PLAN.md` already puts that at 94%). The launch is a way for pons
  wallets to notice the site exists. `LAUNCH.md` gets the metric: visits to
  ledge.tools from the token page and from the room in the first week, with
  the count published on `/t/{our address}` under the same rules as every
  other figure.
- **Every survival/graveyard figure carries its definition inline**
  (already in TODO C5) — the comparison table is why.
- **"All-time" becomes "since 5 September"** until A7 lands, then "since
  14 August".

## Rejected, with the clause

- **Creator pages `/creators/{addr}` and a self-buy badge for other
  creators** (radical 2, 5): a page keyed by a creator address names a
  wallet — `CONSTRAINTS` 2 — and a standing "0 self-buys" claim about
  someone else's launch is a verdict — clause 1. Our own pre-registration
  is different only because it is ours. Not built.
- **Paying to opt out of a leaderboard** (radical 7): hides a number —
  clause 5. Not built.
- **A live zero-buy ticker on the homepage** (trader 3): the Worker computes
  no statistics, and the site is a static export; the honest version is the
  daily digest above.
- **The recompute bounty** (radical 8): good, needs fees to fund it; written
  down under D until there are any.
- **The public pre-registration playbook for any creator** (radical 1):
  free and clause-clean, but it is a template plus an index of filers, and
  the index is the wallet-naming problem again. The template alone can be a
  page under `/method` after launch; the index is not built.

## Owner's steps that came out of this

- Reach out to ponsscan.com for a co-byline (radical 3): their daily tape
  post ending "definitions and n: ledge.tools/method". Zero build cost; one
  message.
- The Telegram room is now on the critical path for distribution, not just
  for graduations: create the bot and the group (TODO B2).

## Order, once section A is done

1. A5b — first-buy timing with the per-token surface and the 5 s edge.
2. C5 + the dated comparison table + the record paragraph on `/method`.
3. A4 figures on `/method`; per-cohort recompute link; counting-up n (with A6).
4. B2 running, with the daily digest.
5. `LAUNCH.md` metric; then B5.
