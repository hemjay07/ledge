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

**A3. Cut the live index over.** `INDEXER.md` §2 and §4.3. The Node runner
is built and tested (`worker/host/`); this is installing it, running it
beside the Worker cron for an hour, then removing the cron.
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

**A6. Outcomes on the surfaces.** The cohort card on `/t/{address}` (the
slot is already commented in), a column on `/graduated`, and the homepage
line once it clears n.

---

## B. Before the token launches

**B1. Sign off the pre-registration.** `PREREGISTRATION.md` needs three
things from the owner: the creator tax, the two commitments as written, and
the launch window. Then it is frozen, committed, and its hash goes on
`/method` and in the homepage slot.

**B2. The Telegram room.** `TELEGRAM_BOT_TOKEN`, a room, and
`TELEGRAM_GRAVEYARD_CHAT_ID` set. *Owner's step, with me.* Until it runs,
`/token` says "not yet running" and that stays true.
**DONE when:** a graduation posts to the room within a minute of the tick.

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

**C3. The homepage slot.** Before launch it carries the pre-registration;
after launch it becomes "LEDGE, measured by LEDGE" — `/t/{our address}` on
the front page under the same rules as every other token.

**C4. A public `tokens.json`.** The name table beside `number.json`, so
anyone can grep the index without an endpoint. Cheap, and it is the honest
minimum version of C2.

---

## D. Written down, not scheduled

- `/cockpit`'s window toggle: the grid shares one picker across both
  windows, and splitting it broke a functional test. Left as it is.
- `/live`'s phone cards are ~185 px; the brief wanted ~120. Reachable only
  by restructuring the stats block.
- The site still has no error page for a token address that is well-formed
  but not a pons launch — the API says so, the page prints its message.
- First-block-buyer aggregates across launches (no wallet named). Real, and
  the weakest of the three data ideas.
