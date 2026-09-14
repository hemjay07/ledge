# What is left, in order

Written 2026-09-12, after the page-by-page pass. This is the working list;
`PLAN.md` holds the phases and `INDEXER.md`, `OUTCOMES.md`,
`PREREGISTRATION.md`, `LAUNCH.md` hold the detail for the items that have
their own file.

Rule for this list: one item is worked at a time, it is finished (built,
tested, screenshotted, pushed, CI green) before the next is started, and
anything found along the way is written down here rather than done
immediately.

---

## A. The data layer — before anything else

The site is done enough to launch behind. The data under it is not, and it
is the only part a sceptic can break.

**A1. The box.** DigitalOcean $6 droplet, Ubuntu 24.04. *Owner's step.*
Blocks A2 and A3. Everything else can proceed without it.

**A2. Cut the crawl over.** `INDEXER.md` §1 and §4.1–2. systemd timer every
10 min, deploy key, one lock. `crawl.yml` loses `schedule`, keeps
`workflow_dispatch` as the phone fallback. `staleAfterSeconds` 7200 → 1800.
**DONE when:** four consecutive timer runs commit, the banner is down for a
full day, and the GitHub publish jobs still fire on the data push.
*2026-09-13 23:00Z: 13 consecutive pushes since 18:47Z (one push race with
a hand push, recovered next run), publish jobs fire, bound lowered. What
remains is the full day without the banner.*

**A3. Cut the live index over.** `INDEXER.md` §2 and §4.3. The Node runner
is built and tested (`worker/host/`); this is installing it, running it
beside the Worker cron for an hour, then removing the cron.
*2026-09-13: both public endpoints refused Cloudflare's egress from 18:05Z
(190+ consecutive tick failures) while answering the box in 0.3 s. The
smaller fix is built and running: an RPC relay on the box
(`ops/rpc-proxy.mjs`, keyed, Cloudflare ranges only) and a keyed Worker
client. Owner's step to flip it: `wrangler secret put RPC_PROXY_KEY` with
the key from `/etc/ledge/proxy.env` on the box, `RPC_URL =
"http://176.97.72.180:8545"` in `worker/wrangler.toml`, deploy. If the
relay holds, A3's D1 shim is not needed.*
*2026-09-14 00:54Z: done differently and better — the gateway (`gateway/`)
replaced the relay, and the tick itself now runs on the box
(`ledge-tick.service`, `worker/host/`) against D1 over its HTTP API with the
owner's D1 token, a tick every 10 s, beside the Worker's cron for the
overlap hour. Remaining: the owner deploys the Worker with the daily-only
cron (`wrangler.toml [triggers]` already changed in the repo), then the
coverage check (≥ 99% of sampled launches for a day).*
**DONE when:** coverage of sampled launches ≥ 99% for a day, the Worker's
`[triggers]` are gone, and the tick's own log shows no gap over an hour.

**A4. The watchdog and the reconciliation figures.** `INDEXER.md` §3 plus
the Telegram alert. Coverage, agreement, freshness — hourly, published on
`/method` with their n, and a message to the owner when either cursor is
past its bound.
**DONE when:** the figures are on `/method` and killing the service on
purpose produces a message within the hour.

**A5. Post-graduation outcomes.** `OUTCOMES.md`, steps 1–3 (decode
`Initialize`/`Swap` on the PoolManager, hour bars in the data partitions,
the `outcomes` block in `pipeline/stats.py`, a dated `METHOD.md` entry),
then the backfill from 2026-09-05.
**DONE when:** the +24 h figure has n ≥ 30 in at least two
time-to-graduation buckets and the method entry is written.
*2026-09-14 01:13Z: met by the first probe pass (20 pools): +24 h has
n = 43 (10 s–5 min) and n = 69 (over 5 min); medians −90.0% and −91.6%
against the opening price. Full probe (670 marks) running.*

**A5b. First-buy timing.** From RESEARCH-2026-09-13 §6: sniping is the
pain everyone names and someone else already measures it at the wallet
level. Ours is the aggregate, with n and no wallet: share of launches whose
first buy landed within 1 s / 3 s / 5 s of the launch block, by creator-tax
band. Needs the crawl to record the first buy per launch (one field, not
the tape), a dated method entry, and the 5-second snipe-tax edge in the
graduation buckets. Per BRAINSTORM-2026-09-13 §1 it also gets one surface:
on `/t/{address}`, the token's own first-buy delay beside its tax band's
shares — a token's own fact on its own page, no wallet.
**DONE when:** the figure is on `/cohorts` with n, the buckets show the
5 s edge, and `/t/{address}` shows the token's own delay beside them.
*2026-09-13: pipeline, stats, method entry and the `/cohorts` card are
live (first reading, n = 21,293: 79.9% of launches carry an opening buy
in the launch tx; of outside first buys, 39.9% land within 1 s and 60.0%
within 5 s of the launch block; 24.6% had none after an hour). The
`/t/{address}` surface is not built: the Worker holds no first-buy record
outside its own window, so it needs either a per-token KV publish from the
crawl or a lookup file. Decide before building.*

**A7. Backfill the record to 14 August.** pons v2's first launch (Bitquery
archive). "All-time" then means what a reader thinks it means, and every
cohort's n grows by about three weeks of launches.

**A6. Outcomes on the surfaces.** The cohort card on `/t/{address}` (the
slot is already commented in), a column on `/graduated`, and the homepage
line once it clears n.
*2026-09-14: the AFTER GRADUATION card is on `/cohorts` (three registers,
medians with n, no-trade share). `/t/{address}` and `/graduated` still
to do.*

---

## B. Before the token launches

**B1. Sign off the pre-registration.** `PREREGISTRATION.md` needs three
things from the owner: the creator tax, the two commitments as written, and
the launch window. Then it is frozen, committed, and its hash goes on
`/method` and in the homepage slot.

**B2. The Telegram room.** `TELEGRAM_BOT_TOKEN`, a room, and
`TELEGRAM_GRAVEYARD_CHAT_ID` set. *Owner's step, with me.* Until it runs,
`/token` says "not yet running" and that stays true. Per
BRAINSTORM-2026-09-13 §2 the room is the first push channel and carries a
second thing: one daily digest from `number.json` (launches, graduations
with rate, excluding-fast, median time-to-graduation, the whole record,
each with n; 12:00 UTC; `worker/src/digest.ts`, built 2026-09-13) — the
Worker still computes no statistic. Zero-buy share waits for a Class A
figure; the sample on the homepage is a dated measurement, not a window.
**DONE when:** a graduation posts to the room within a minute of the tick,
and the digest has posted on two consecutive days.

**B6. The token's success metric.** Referral visits to ledge.tools from the
token page and the room in the first week, published on `/t/{our address}`
— not fees (BRAINSTORM-2026-09-13, "What to adjust"). Goes into `LAUNCH.md`
before B5.

**B3. `www.ledge.tools`.** Add the domain in Vercel, change the CNAME at
Namecheap. *Owner's step.*

**B4. Phase 0 questions to the operator.** `PLAN.md` §0: is there a
session-key account-abstraction provider live on Robinhood Chain, and is
prepare-and-sign enough for what he had in mind. The answer sets or removes
Phase 3.

**B5. The launch itself.** `LAUNCH.md`: the token image, the 146-character
description, the sequence. Nothing here is done until A1–A4 are, because
the first thing anyone checks is whether the live layer is real.

---

## C. The site, once the data layer is solid

**C1. Names on `/graduated`.** That board is built at deploy time from
`data/graduated.json`, so it has no name column; the names live in D1. Either
the build reads them from the API, or the crawl writes them into the data
file. The second is better: the name then belongs to the canonical record.

**C2. Search by name.** Decided 2026-09-12 after a brainstorm: a **collision
page**, never a finder. `/n/{name}` lists every indexed launch using that
name, ordered by a column printed on the row, each with its address, with
the line "N launches use this name; anyone can deploy another in seconds"
and an empty state that says what was searched rather than implying the name
does not exist. No autocomplete, no fuzzy match, no "verified" marker, no
logging of popular queries. Needs a one-time name backfill (~165k tokens,
~550 multicalls, an hour on the box) or it covers 0.3% of the record and its
silence lies.

**C5. The one line of difference on the homepage.** Four sites score; one
publishes the tape daily. Ours: *no scores, no wallets, no tape — the
population, its method, and its n.* One line under the kicker. And every
survival/graveyard figure carries its definition inline (ours is zero buys
in 72 h; ponsscan's is zero trades in 12 h).

**C6. The comparison and the record on `/method`.** A dated ("as observed
on 13 Sep 2026") table of definitions: ponsscan.xyz's fixed n=12 cohort
against our n-with-window; ponsscan.com's zero-trades-in-12-h survival
against our zero-buys-in-72-h; wallet-claiming against no wallet named.
Facts from their public pages, no adjectives. Plus one paragraph saying the
dated changelog and the git history of `number.json` are the append-only
record, and where they are. With A6: a "recompute this ↗" beside each rate,
generated from the same code path as the number, and "not enough data
(n=17)" showing the live n.

**C3. The homepage slot.** Before launch it carries the pre-registration;
after launch it becomes "LEDGE, measured by LEDGE" — `/t/{our address}` on
the front page under the same rules as every other token.

**C4. A public `tokens.json`.** The name table beside `number.json`, so
anyone can grep the index without an endpoint. Cheap, and it is the honest
minimum version of C2.

---

## D. Written down, not scheduled

- `/graveyard` (2026-09-13): a row with `buys: 0, sells: 2` is on the live
  board. A sell with no buy is impossible on-chain, so the launch block (or
  an early block) was never read and the row is a coverage artefact, not a
  zero-buy launch. Rows whose launch block was not read must be excluded
  or labelled; fold into A4 with the coverage figure.
- `/cockpit`'s window toggle: the grid shares one picker across both
  windows, and splitting it broke a functional test. Left as it is.
- `/live`'s phone cards are ~185 px; the brief wanted ~120. Reachable only
  by restructuring the stats block.
- The site still has no error page for a token address that is well-formed
  but not a pons launch — the API says so, the page prints its message.
- First-block-buyer aggregates across launches (no wallet named). Real, and
  the weakest of the three data ideas.
- A standing recompute bounty, funded from creator fees, for anyone who
  reproduces a discrepancy between a published number and the chain
  (BRAINSTORM-2026-09-13). Needs fees to exist first.
- The pre-registration template as a public page under `/method` after
  launch — the template only; an index of who filed one names wallets.
- Rejected outright, with the clause: creator pages keyed by address and a
  self-buy badge for other creators (clause 2, clause 1); paying to opt out
  of a board (clause 5); a live ticker on the static homepage (Worker
  computes no statistics).
