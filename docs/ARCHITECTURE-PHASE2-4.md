# LEDGE — Architecture (Phases 2–4)

Binding inputs: `CONSTRAINTS.md`, `METHOD.md`, `SPEC.md`, `PONS_CONTRACTS.md`, `ARCHITECTURE.md` (Phase 1), `design/DESIGN_SYSTEM.md`. This document decides only what those delegate. Any change to a definition requires a dated `/method` changelog entry (CONSTRAINTS §9).

`RESEARCH-PHASE2-3.md` did not exist when this was written. Every dependency on it is marked **[R1]**–**[R7]** and collected in §12. Nothing in §§1–4 blocks on research; §§5–6 have one blocking item each.

---

## 0. Constraints carried forward, and the one new one

| | |
|---|---|
| Timeline | Solo, agent-assisted, one launch covering Phases 2–4. Day-by-day order in §11. |
| Stack | Python 3.12 stdlib pipeline; Next.js 16 static export on Vercel; add TypeScript Workers and Foundry. |
| Deployment | GitHub Actions (unlimited, public repo) + Vercel free + Cloudflare free. Target running cost $0–10/mo. |
| Scale | ~19,000 launches/day (~800/h, ~13/min), ~640 graduations/day. Site traffic unknown; design for 10× current. |
| Non-negotiable (Phase 1) | Block-header timestamps. Every figure carries `n`. CI recompute diff byte-for-byte. |
| **Non-negotiable (new)** | **`pipeline/stats.py` stays the only place a statistic is defined.** No rate, share, or percentile is ever computed in TypeScript or Solidity. The live layer observes and looks up; it does not aggregate. |

That last line is the spine of this design. Everything below follows from it.

### The Class A / Class B split

Every figure LEDGE publishes falls into exactly one class, and the class decides where it may be computed.

**Class A — statistics.** Rates, shares, percentiles, cohort rows, deployer distributions. Denominated, windowed, reproducible. Computed **only** by `pipeline/stats.py`, serialised into `data/number.json`, and covered byte-for-byte by `recompute.py --check`. The live layer may *read* these; it may never derive one.

**Class B — observations.** Readings about a single token taken from the chain right now: `phase`, curve fill in wei against the 4.2 ETH threshold, launch block, seconds elapsed since launch, whether a `PoolGraduated` has been seen. There is no denominator because there is no population — these are facts about one object, and CONSTRAINTS permits per-token *outcome and cohort* facts (Phase 4 death card) while forbidding scores. Class B carries `observedAt` and `source: "chain"`, never `crawledAt`.

The interesting case is the sentence the product actually wants: *"minute 14 — 75% of graduations have already happened by now."* The "minute 14" is Class B. The "75%" is Class A. A naive implementation computes the 75% in the Worker from a percentile array, which is exactly the drift the recompute gate exists to prevent.

**Decision: the ladder.** `pipeline/stats.py` emits a monotone step table into `number.json`, and the live layer does a *table lookup*, not arithmetic:

```json
"ttg": {
  "n": 107, "insufficient": false,
  "p10": 12, "p25": 72, "p50": 96, "p75": 540, "p90": 3000, "p95": 6600, "max": 18000,
  "ladder": [
    { "atSeconds": 30,    "cumulative": 21, "cumulativeShare": 0.196262 },
    { "atSeconds": 60,    "cumulative": 47, "cumulativeShare": 0.439252 },
    { "atSeconds": 120,   "cumulative": 63, "cumulativeShare": 0.588785 },
    { "atSeconds": 300,   "cumulative": 72, "cumulativeShare": 0.672897 },
    { "atSeconds": 600,   "cumulative": 79, "cumulativeShare": 0.738318 },
    { "atSeconds": 900,   "cumulative": 84, "cumulativeShare": 0.785047 },
    { "atSeconds": 1800,  "cumulative": 92, "cumulativeShare": 0.859813 },
    { "atSeconds": 3600,  "cumulative": 99, "cumulativeShare": 0.925234 },
    { "atSeconds": 7200,  "cumulative": 104, "cumulativeShare": 0.971963 },
    { "atSeconds": 14400, "cumulative": 106, "cumulativeShare": 0.990654 },
    { "atSeconds": 21600, "cumulative": 107, "cumulativeShare": 1.0 }
  ]
}
```

Edges are fixed in `stats.py` (`LADDER_EDGES`), so they are a definition and moving one needs a `/method` entry. `cumulative` is the raw count so the reader can check the share; `cumulativeShare` is `null` with the whole `ttg` block `insufficient: true` when `n < 30`, and the live layer then prints "not enough graduations yet to place this (n=…)" instead of a percentage. The Worker's placement function is nine lines: find the largest rung with `atSeconds <= elapsed`, print its share and `ttg.n`. It cannot drift from Python because it does no maths. Values above are illustrative shape derived from the committed 24 h window (n=107, so in reality this block ships `insufficient: true` — the implementation derives all of them).

**Decision: the cross cohort.** "What happened to launches configured like this one" is pair class × creator-tax bucket, a 2-D cohort `number.json` does not currently carry. Add `cohorts.pairTax` — 20 rows (4 pair classes × 5 tax buckets), emitted always, every row with `launches`, `graduations`, `rate|null`, `insufficient`, and its own `excludingFast` block, in both `h24` and `allTime`. Computed by `stats.py`, gate-covered. Most rows will be `insufficient: true` at current n, and the lookup page will honestly say so — that is the correct behaviour, not a bug. Rows are ordered pair-major (`eth/0%`, `eth/1%`, …), fixed, so the byte diff is stable.

With those two additions, the live layer computes **zero** statistics.

---

## 1. Decision: the always-on layer

Phase 2 needs sub-minute freshness for one token's live state, an HTTP surface for lookups, per-address HTML for the death card, and a Telegram webhook.

| Criterion | A: Cloudflare Workers + D1 + KV | B: Fly.io VM running the Python | C: Vercel cron | D: Supabase edge + Postgres |
|---|---|---|---|---|
| Cron granularity | 1 minute (Cron Triggers) | arbitrary (own loop) | **Hobby = daily** | 1 minute (pg_cron) |
| Cost at current traffic | $0 | ~$2/mo (shared-cpu-1x, 256 MB) + volume | $20/mo to get cron | $0 (free project, pauses after 7 idle days) |
| Cost at 10× traffic | $0 (1,440 cron/day + ~50k req/day, under 100k/day) | ~$2/mo unchanged | $20/mo | $0–25/mo (free tier egress) |
| Reuses `stats.py` | No — but by design it computes nothing | **Yes, directly** | n/a | No |
| Edge HTML + OG + webhook | Native, one runtime | Needs a web framework, a TLS cert, a CDN in front | Native | Edge functions, separate from pg |
| Ops surface | Stateless, no host to patch | A pet: disk, restarts, memory, silent death | Managed | Managed, but two products |
| Reversibility | Easy — the API contract is the boundary | Easy | — | Medium |
| Risk | Subrequest cap (50 free / 1,000 paid) per cron invocation | Single instance is a single point of failure; RPC 429s collide with the hourly Action | Disqualifying | Free-tier pausing kills sub-minute freshness |

**C is disqualified** on cron granularity as the brief anticipated. **D** is disqualified because a project that pauses when idle cannot be the freshness layer for a site whose whole claim is that it never lies about being fresh.

**Recommendation: A — Cloudflare Workers + D1 + KV.** The reason is not cost; it is that the Class A / Class B split removes the only argument for B. If the live layer computed statistics, running the proven Python next to `stats.py` would be worth a VM's ops burden. It does not: it ingests two event topics and serves table lookups. Against that, A also supplies the three other things Phases 2–4 need — per-request HTML for `/t/{address}`, PNG generation for the death card, and a webhook endpoint — each of which is extra work on B.

**Monthly cost at 10× current traffic: $0.** Workers free tier is 100,000 requests/day; the cron itself is 1,440. Ten times the current site traffic plus one API call per page view stays under that. The tipping point is ~100k req/day, at which Workers Paid is $5/mo and D1 is included to 25 GB. **Budget line: $0 now, $5/mo ceiling.**

**Runner-up: B (Fly.io).** Switch if **[R3]** shows that minute-level ingest cannot fit the Worker subrequest budget — specifically if timestamping ~13 launches/min needs more than ~15 batched subrequests per tick, or if the RPC withdraws batch support (Phase 1 §14 already tracks that risk).

### What is computed where — the binding table

| Figure | Computed by | Published in | Covered by which gate |
|---|---|---|---|
| The Number (24 h, all-time), excluding-fast, "1 in N" | `stats.py` | `data/number.json` | `recompute.py --check` byte diff |
| TTG percentiles and the ladder | `stats.py` | `data/number.json` | same |
| Cohorts incl. new `pairTax` | `stats.py` | `data/number.json` | same |
| Fast shares, deployer distribution | `stats.py` | `data/number.json` | same |
| Oracle reading | `stats.py` (read from `number.json`) | Robinhood Chain | Foundry tests + post-write read-back diff |
| Token's `phase`, curve fill, launch ts, elapsed seconds | Worker (`eth_call`, chain reads) | `/api/token/{a}` | vector gate (§9), schema gate |
| Ladder placement string | Worker **lookup** into `number.json` ladder | `/api/token/{a}` | vector gate — Python and TS must agree byte-for-byte on the fixture |
| Cohort row for a token's config | Worker **lookup** into `number.json` `pairTax` | `/api/token/{a}` | vector gate |
| Live board rows (last ~200 launches) | Worker (D1 select) | `/api/live` | schema gate; nightly reconciliation vs Python |

Nothing in the right-hand column of the Worker rows is a statistic. That is checkable, and §9 checks it.

---

## 2. Decision: data model for the live layer

Canonicity is settled and must be stated on `/method`: **the Python pipeline and the repo are canonical for the Number. D1 is canonical for nothing.** D1 answers one question — "what is true about this token right now" — and is disposable; wiping it costs at most a re-index of the retention window.

### D1 schema (`worker/schema.sql`)

```sql
-- One row per TokenLaunched seen by the minute indexer.
CREATE TABLE IF NOT EXISTS launch (
  token           TEXT PRIMARY KEY,          -- lowercase 0x address
  curve           TEXT NOT NULL,
  pair_token      TEXT NOT NULL,
  pair_class      TEXT NOT NULL,             -- eth | stable | stock | other
  creator_tax_bps INTEGER,                   -- NULL when enrichment failed
  block           INTEGER NOT NULL,
  ts              INTEGER NOT NULL,          -- block header timestamp, seconds
  tx_hash         TEXT NOT NULL,
  log_index       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS launch_block_idx ON launch (block DESC);
CREATE INDEX IF NOT EXISTS launch_ts_idx    ON launch (ts DESC);

-- One row per PoolGraduated. token is NOT a foreign key: a graduation can
-- arrive for a launch outside the retention window, and it must still be
-- recorded rather than silently dropped.
CREATE TABLE IF NOT EXISTS graduation (
  token             TEXT PRIMARY KEY,
  block             INTEGER NOT NULL,
  ts                INTEGER NOT NULL,
  pair_token_amount TEXT NOT NULL,           -- raw uint256 as decimal string
  tx_hash           TEXT NOT NULL,
  log_index         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS graduation_block_idx ON graduation (block DESC);

-- Single-row cursor. Mirrors data/state.json in spirit, never in authority.
CREATE TABLE IF NOT EXISTS cursor (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  last_indexed_block    INTEGER NOT NULL,
  last_tick_at          INTEGER NOT NULL,
  last_success_at       INTEGER NOT NULL,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  last_error            TEXT
);

-- Telegram abuse counters. Bucketed by hour so eviction is a range delete.
CREATE TABLE IF NOT EXISTS tg_usage (
  chat_id   TEXT NOT NULL,
  hour_key  INTEGER NOT NULL,                -- unix hour
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, hour_key)
);
```

**No `curve_buy` table.** The brief asks for curve fill and first-block buyer count. Curve fill is a single view read on the curve contract at lookup time (**[R1]**) — one `eth_call` for the one token being asked about, versus indexing an event stream of unknown volume (**[R2]**) for 19,000 tokens a day of which almost none are ever looked up. First-block buyer concentration needs the events and is therefore **deferred**: when it lands it will be a Class A statistic computed by Python over a bounded sample, exactly as the Phase 1 tax cohort was, not a Worker table. This is the single largest complexity saving in the design and it removes the design's dependency on the unknown in **[R2]**.

**Retention.** `DELETE FROM launch WHERE ts < unixepoch() - 604800` at the end of each tick, same for `graduation`. Seven days ≈ 133,000 launch rows ≈ 25 MB, against a 5 GB free limit — two orders of margin, and the ceiling is bounded regardless of how long LEDGE runs. A lookup for a token older than seven days returns `not_indexed` and the response still carries the cohort figures and the token's chain state, because those come from `getLaunchedToken`, not D1. **Everything except "when exactly did this launch" survives eviction.**

**The live board is a query, not a buffer.** `SELECT token, pair_class, creator_tax_bps, ts, block FROM launch ORDER BY block DESC LIMIT 200`. No ring buffer to maintain, no second write path. Per CONSTRAINTS §2 and the brief, the aggregate board renders **no addresses and no tickers**: each row is `{ pairClass, taxBucket, ageSeconds, graduated }` and the token address is stripped in the Worker before serialisation, not in the client. The board is a view of the population, not a list of things to click.

**Consistency between the hourly Python and the minute Worker.** They share nothing but the chain. Both resume from their own cursor, both dedupe on `(txHash, logIndex)`, both take timestamps from block headers. They will disagree by up to one hour on counts, and that is *disclosed*: the API labels cohort figures `crawledAt` and live facts `observedAt`, and the site prints both. A nightly reconciliation job (§9) compares D1's 24 h launch count against the repo's and fails loudly above 0.5% divergence — the only way a silent Worker indexing bug gets caught.

**RPC contention.** Both processes hit the same public RPC. The hourly Action runs at `:07`; the Worker cron is `* * * * *`. Mitigations: the Worker uses batch JSON-RPC at the Phase 1 envelope (50 per batch, ≥2.0 s pacing), treats a 429 as a skipped tick (it does not advance its cursor, and the next tick's window simply covers 1,200 blocks instead of 600), and records `consecutive_failures`. A tick never retries aggressively; the next tick is 60 seconds away.

### Worker tick (`worker/src/tick.ts`)

1. Read `cursor`. `from = last_indexed_block + 1`, `to = min(head, from + 5000)` — a bounded catch-up so an outage cannot produce a tick that blows the subrequest budget.
2. Two `eth_getLogs` (one per topic0), ≤1,000-block windows.
3. Batch `eth_getBlockByNumber` for distinct blocks, 50 per subrequest — ~13 launches/min → 1 subrequest in steady state, ~12 after a 45-minute outage.
4. Batch `getLaunchedToken` for new launches, 50 per subrequest, for `creatorTaxBps` and `pairToken`.
5. `INSERT OR IGNORE` both tables in one D1 batch; update `cursor`; run the retention delete.
6. Any throw: write `last_error`, increment `consecutive_failures`, leave `last_indexed_block` untouched. Same all-or-nothing posture as `crawl.py`.

`pair_class` resolution reuses the repo's mapping: the Worker reads `data/pair-tokens.json` from KV (§3), never calls `symbol()` itself. An unseen pair token lands in `other`, which is what `recompute.py` would do anyway, and the next hourly Python run classifies it for good.

### KV

| Key | Written by | TTL | Contents |
|---|---|---|---|
| `number:current` | `crawl.yml` after the data commit | none | `data/number.json` verbatim |
| `pair-tokens:current` | same | none | `data/pair-tokens.json` verbatim |
| `number:etag` | same | none | git SHA of the commit |

The Action pushes these with the Cloudflare KV REST API and a token scoped to *write one namespace*. This keeps the Worker independent of Vercel: if the site is down the API still answers, and if Cloudflare is down the static site still shows the Number. Neither can take out the other. The Worker caches the parsed `number.json` in module scope for 60 s to avoid a KV read per request.

---

## 3. Decision: the lookup API contract

Base: `https://api.ledge.tools`, also reachable same-origin at `https://ledge.tools/api/*` via the Vercel rewrite in §4.

### `GET /api/token/{address}`

```jsonc
{
  "schemaVersion": 1,
  "address": "0x23fe54b3bf9e1d2816822043c0b02b6a12f98fe2",
  "venue": "pons",

  // Class B — chain observations. No denominators, because no population.
  "observedAt": "2026-09-06T18:41:12Z",
  "source": "chain",
  "config": {
    "pairToken": "0x0000000000000000000000000000000000000000",
    "pairClass": "eth",
    "creatorTaxBps": 300,
    "taxBucket": "2-3%"
  },
  "state": {
    "phase": 0,                       // 0 live on curve, 2 graduated (PONS_CONTRACTS)
    "phaseLabel": "on the bonding curve",
    "curveFilledWei": "1743200000000000000",
    "graduationThresholdWei": "4200000000000000000",
    "curveFilledShare": 0.415,        // ratio of two observed quantities, not a statistic
    "launchBlock": 56172001,
    "launchedAt": "2026-09-06T18:27:41Z",
    "elapsedSeconds": 811,
    "graduated": false,
    "graduatedAt": null,
    "timeToGraduationSeconds": null,
    "indexed": true                   // false => launchedAt/elapsedSeconds are null
  },

  // Class A — every figure below is a verbatim lookup from number.json.
  "cohort": {
    "crawledAt": "2026-09-06T18:00:36Z",
    "definitionsVersion": "2026-09-06",
    "key": { "pairClass": "eth", "taxBucket": "2-3%" },
    "h24":     { "window": "24h",     "launches": 812,   "graduations": 14,  "rate": null,      "insufficient": true,
                 "excludingFast": { "cutoffSeconds": 300, "graduations": 4, "rate": null, "oneIn": null, "insufficient": true } },
    "allTime": { "window": "allTime", "launches": 24118, "graduations": 402, "rate": 0.016668, "insufficient": false,
                 "excludingFast": { "cutoffSeconds": 300, "graduations": 131, "rate": 0.005432, "oneIn": 184, "insufficient": false } }
  },
  "placement": {
    "crawledAt": "2026-09-06T18:00:36Z",
    "window": "allTime",
    "elapsedSeconds": 811,
    "rung": { "atSeconds": 600, "cumulative": 402, "cumulativeShare": 0.738318 },
    "n": 544,
    "insufficient": false
  },
  "links": {
    "method": "https://ledge.tools/method",
    "numberJson": "https://ledge.tools/number.json"
  }
}
```

Binding response rules, enforced by a Zod schema shared by the Worker, the site, and the vector fixtures:

- **Every Class A object carries `launches` (its `n`), a `window`, and the `crawledAt` it was computed at.** A figure without all three fails the schema and the request 500s rather than shipping a naked number (the same posture as `site/lib/schema.ts`).
- `rate: null` whenever `insufficient`. The client renders `not enough data (n=812)`. There is no code path that prints a percentage from a null.
- `placement` is `insufficient: true` with `rung: null` when `ttg.n < 30`.
- `curveFilledShare` is a Class B ratio of two observed wei quantities and is deliberately *not* denominated — it is one measurement over one constant, not a sample. It is rendered as a fill bar with both wei figures beside it, never as a lone percentage.
- No field named `score`, `risk`, `odds`, `chance`, `likely`, `safe`, `rug`, or `probability` may exist. Enforced by a key-name lint over the schema file (§9).

### Error shapes

```jsonc
{ "schemaVersion": 1, "error": "bad_address",  "message": "Not a 20-byte hex address." }              // 400
{ "schemaVersion": 1, "error": "not_pons",     "message": "This address was not launched by the Pons factory 0x7eD5…EC7e.",
  "factory": "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" }                                          // 404
{ "schemaVersion": 1, "error": "not_indexed",  "message": "Launched more than 7 days ago, or LEDGE has not reached this block yet.",
  "lastIndexedBlock": 56172588, "partial": { "config": {…}, "state": {…}, "cohort": {…} } }           // 200
{ "schemaVersion": 1, "error": "upstream_unavailable", "message": "The chain RPC did not answer. Nothing is being estimated.",
  "retryAfterSeconds": 30 }                                                                          // 503
{ "schemaVersion": 1, "error": "number_unavailable", "message": "Cohort figures are not loadable. Live state is shown alone.",
  "partial": { "config": {…}, "state": {…} } }                                                       // 200
```

`not_indexed` returns **200 with a partial**, because `getLaunchedToken` and the curve view still answer and the cohort still applies — the only casualty is the exact launch timestamp, so `elapsedSeconds` and `placement` are `null`. Degrading to a 404 there would throw away four correct facts to punish one missing one.

A Pons launch URL (`ponsfamily.com/...`) is normalised **client-side** to an address before the call; the Worker only ever accepts a 20-byte hex address. Pattern per **[R6]**.

### Other endpoints

| Endpoint | Returns | Cache |
|---|---|---|
| `GET /api/live` | `{ observedAt, lastIndexedBlock, rows: [{ pairClass, taxBucket, ageSeconds, graduated }], count }` — max 200, no addresses, no tickers | `max-age=15, stale-while-revalidate=45` |
| `GET /api/number` | KV copy of `number.json`, byte-identical | `max-age=300` |
| `GET /api/health` | `{ lastIndexedBlock, lastSuccessAt, consecutiveFailures, numberCrawledAt }` | `no-store` |
| `GET /og/t/{address}.png` | 1200×630 death card | `max-age=300` |
| `GET /t/{address}` | HTML shell with per-address meta | `max-age=60` |
| `POST /tg/{secret}` | Telegram webhook | `no-store` |

**Caching:** `Cache-Control: public, max-age=15, stale-while-revalidate=60` on `/api/token/*`, plus Cloudflare Cache API keyed on the lowercased address so a token being passed around a group chat is served from cache. Fifteen seconds is below the "sub-minute freshness" bar and above the RPC's comfort.

**Rate limiting:** a Cloudflare Rate Limiting rule, 60 requests/minute per IP on `/api/*` and `/og/*`, returning 429 with `Retry-After`. Enough for a person, not enough for a scraper who should be reading `/number.json` instead.

**CORS: open — `Access-Control-Allow-Origin: *`, `GET, OPTIONS` only.** CONSTRAINTS §8 makes the data public and ungated; locking CORS to `ledge.tools` would be an access control on a public instrument, and would defeat the purpose of the third parties embedding the Number that SPEC counts as success. `/number.json` already ships `*`.

---

## 4. Decision: which pages stay static

The recompute byte gate depends on the site rendering from the committed `number.json` at build time. Anything that moves to server rendering leaves that gate's coverage. So: **the Number never leaves the static build.**

| Route | Rendering | Why |
|---|---|---|
| `/` (landing, leads with "1 in N") | Static export, build-time `number.json` | The headline figure must be in the HTML, gate-covered, and screenshot-stable |
| `/number` (broadsheet card) | Static export | Unchanged from Phase 1 |
| `/method`, `/cohorts` | Static export | Unchanged |
| `/number.json`, `/og/number.png` | Static assets | Unchanged |
| `/live` (walk the ledge) | Static shell + client fetch of `/api/live` every 15 s | No Class A figures on the page; nothing to gate |
| `/lookup` | Static shell + client fetch of `/api/token/{a}` | Same |
| `/t/{address}` (death card) | **Worker-rendered HTML, proxied through Vercel** | Needs per-address `og:image` and `og:title` |

**The `/t/{address}` problem, and its resolution.** Next static export cannot produce per-address HTML for an unbounded address space, and a single static shell can only carry one `og:image` — which would make every death card unfurl identically, destroying the feature. Serving it from `api.ledge.tools` would work technically but the shareable URL would be wrong: the whole point is that `ledge.tools/t/0x…` is the citation.

Resolution: keep `ledge.tools` on Vercel and **proxy the two dynamic prefixes to the Worker** with external rewrites, which Vercel supports on static projects:

```json
{
  "rewrites": [
    { "source": "/t/:address",  "destination": "https://api.ledge.tools/t/:address" },
    { "source": "/api/:path*",  "destination": "https://api.ledge.tools/api/:path*" },
    { "source": "/og/t/:path*", "destination": "https://api.ledge.tools/og/t/:path*" }
  ],
  "headers": [
    { "source": "/number.json", "headers": [
      { "key": "Cache-Control", "value": "public, max-age=300" },
      { "key": "Access-Control-Allow-Origin", "value": "*" } ] } ]
}
```

Three things fall out at once: the shareable URL is on the apex domain; the death card's `og:image` is `https://ledge.tools/og/t/{address}.png`, per-address and unfurlable; and the site's own client fetches are same-origin, so the site never needs CORS at all while third parties still get it on `api.ledge.tools`.

The Worker's `/t/{address}` HTML is a **shell with baked meta and a `<noscript>` fact block**, then hydration from `/api/token/{a}`. The meta line is the death card copy the brief specifies, assembled from the same objects as the API:

`minute 14 · died · cohort 1.2% (n=156) · ETH · 3%`

"died" is the outcome word for a Pons token in `phase 0` past the observed graduation range with no `PoolGraduated` — and it is a **fact about an outcome**, in the past tense, about one token, which CONSTRAINTS permits and which the whole death-card idea rests on. It is not "will die". Any future-tense or evaluative rendering is a review blocker. Where the outcome is not yet determinable the card reads `minute 14 · on the curve · cohort …`.

**Design system:** landing, `/live` and `/t/*` inherit `design/DESIGN_SYSTEM.md` unchanged — the register, the ruled tables, the ladder rendered as the engraved scale from the Scale component, and the one colour still spent only on stale. The death card's OG uses the same `satori` pipeline as `og.mjs`, ported into the Worker (satori runs on Workers; **[R7]** confirms the font-loading path). The colophon strip is on the death card too: cropped, it must still say `LEDGE.TOOLS` and its measurement stamp.

**Staleness in the live layer.** The site already computes age client-side from `crawledAt`. The API adds a second clock: `observedAt` and, from `/api/health`, `consecutiveFailures`. If the Worker's `last_success_at` is older than 300 seconds, `/api/token` and `/api/live` set `"live": { "stale": true, "lastSuccessAt": … }` and the client shows the same vermilion correction slip, worded for the live layer. A stale live layer never falls back to guessing.

---

## 5. Decision: the on-chain oracle

A minimal, non-upgradeable contract on Robinhood Chain (chain 4663) holding the current reading. Deployed with Foundry from `contracts/`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The Pons Number, published hourly. Definitions: ledge.tools/method
/// @dev No proxy, no upgrade path, no owner-writable data other than the writer key.
contract LedgeOracle {
    struct Reading {
        uint32 rate24hBps;          // graduations/launches, basis points (2 dp of a percent)
        uint32 excludingFastBps;    // same, excluding graduations under 300 s
        uint32 launches24h;         // the denominator. Never read a rate without it.
        uint32 graduations24h;      // the numerator
        uint64 crawledAt;           // unix seconds, the window's `until`
        bytes8 definitionsVersion;  // ASCII "20260906"
    }

    uint32  public constant MIN_N = 30;      // below this, rate fields are 0 and meaningless
    uint32  public constant FAST_CUTOFF = 300;
    address public owner;
    address public writer;
    Reading private _latest;
    uint64  public publishedAt;              // block timestamp of the last publish

    event Published(uint32 rate24hBps, uint32 excludingFastBps, uint32 launches24h,
                    uint32 graduations24h, uint64 crawledAt, bytes8 definitionsVersion);
    event WriterRotated(address indexed previous, address indexed next);
    event OwnerTransferred(address indexed previous, address indexed next);

    error NotWriter();
    error NotOwner();
    error StaleReading();     // crawledAt <= the stored crawledAt
    error ImpossibleReading(); // graduations > launches, or bps > 10000

    constructor(address writer_) { owner = msg.sender; writer = writer_; }

    function publish(Reading calldata r) external {
        if (msg.sender != writer) revert NotWriter();
        if (r.crawledAt <= _latest.crawledAt) revert StaleReading();
        if (r.graduations24h > r.launches24h) revert ImpossibleReading();
        if (r.rate24hBps > 10000 || r.excludingFastBps > 10000) revert ImpossibleReading();
        _latest = r;
        publishedAt = uint64(block.timestamp);
        emit Published(r.rate24hBps, r.excludingFastBps, r.launches24h,
                       r.graduations24h, r.crawledAt, r.definitionsVersion);
    }

    function latest() external view returns (Reading memory) { return _latest; }
    function setWriter(address next) external { if (msg.sender != owner) revert NotOwner();
        emit WriterRotated(writer, next); writer = next; }
    function transferOwnership(address next) external { if (msg.sender != owner) revert NotOwner();
        emit OwnerTransferred(owner, next); owner = next; }
}
```

Design notes, each answering a constraint:

- **The denominator is on-chain.** `launches24h` and `graduations24h` ship with the rate so any reader can recompute it and so CONSTRAINTS §3 survives contact with a contract call. `MIN_N` is a public constant, so "is this reading publishable" is answerable on-chain.
- **`StaleReading` makes replay impossible** and makes a stuck Action visible: `crawledAt` simply stops advancing, and any consumer compares it to `block.timestamp` exactly as the site compares it to `now`.
- **No upgradeability, no pause, no data mutation.** The owner can rotate the writer and hand over ownership. That is the entire admin surface.
- **Storage packing:** `Reading` is 4+4+4+4+8+8 = 32 bytes, one slot. A publish is one warm SSTORE plus one for `publishedAt`. Estimated ~35–50k gas including calldata; 720 writes/month. **Gas budget: the writer key is funded with a stated ETH float and the Action fails soft below a threshold — see [R5] for the actual gas price on Robinhood Chain.** Never fund the writer beyond one month of gas.

### The Action step

A **separate job**, downstream of the data commit, `continue-on-error: true`, so an oracle failure can never block or dirty the dataset:

```yaml
  oracle:
    needs: crawl
    if: needs.crawl.outputs.committed == 'true'
    runs-on: ubuntu-latest
    continue-on-error: true               # a failed publish must never block the data
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
      - name: publish reading
        env:
          ORACLE_WRITER_KEY: ${{ secrets.ORACLE_WRITER_KEY }}
          ORACLE_ADDRESS:    ${{ vars.ORACLE_ADDRESS }}
          RPC_URL:           ${{ vars.RPC_URL }}
        run: bash contracts/script/publish.sh    # reads data/number.json, asserts n>=MIN_N, cast send, reads back
```

`publish.sh` derives the six fields from `data/number.json` with `jq` — it never recomputes anything — refuses to publish when `h24.insufficient` is true, sends with `cast send`, then **reads back with `cast call` and diffs against what it sent**, failing the job (not the workflow) on mismatch.

**Key management.** `ORACLE_WRITER_KEY` is a GitHub Actions secret on a dedicated address whose only asset is gas and whose only privilege is `publish`. The owner key is generated offline, never touches CI, and exists to run `setWriter` if the CI secret is ever exposed. Rotation is one transaction and needs no redeploy — which is the reason `writer` is a variable at all.

---

## 6. Decision: cross-venue generalisation

Two shapes were available: embed venues inside `number.json` (`venues: {pons: {…}, hood: {…}}`), or keep `number.json` as it is and publish siblings.

| Criterion | A: embed `venues` in `number.json` | B: per-venue files + an index |
|---|---|---|
| Breaks schema v2 consumers | Additive key — tolerated by non-strict parsers, but changes the file every consumer already pins | **No change to `number.json` at all** |
| "the Pons Number" as a citation | Diluted — the canonical URL now returns a bundle | Preserved: `/number.json` is Pons, forever |
| File size | Grows linearly with venues (~40 KB each) | Each fetch pays only for what it reads |
| Recompute gate | One diff | One diff per file, same script |
| Complexity | Lower | Slightly higher (an index file) |

**Recommendation: B.** `/number.json` is already a published citation and SPEC counts third-party embedding as a success metric; growing it into a bundle is the one change that could break a consumer we cannot see. Cost is one extra file.

```
data/number.json                     # unchanged. schemaVersion 2. Pons. The citation.
data/venues.json                     # index: [{ name, label, chainId, factory, firstIndexedBlock, numberPath, launches24h }]
data/venues/hood/number.json         # same schemaVersion 2 shape, hood.fun
data/venues/hood/launches/YYYY-MM-DD.jsonl[.gz]
venues/pons.json                     # definitions, in the repo root, versioned
venues/hood.json
```

`venues/{name}.json` is the per-venue definitions file the crawler is generalised against — everything currently hard-coded in `rpc.py`, `enrich.py` and `stats.py` module constants:

```jsonc
{
  "name": "pons",
  "label": "Pons",
  "chainId": 4663,
  "rpcUrl": "https://rpc.mainnet.chain.robinhood.com",
  "factory": "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  "firstIndexedBlock": 55219400,
  "events": {
    "launch":     { "topic0": "0x8d4aad49…a89607", "indexed": ["token","curve","deployer"],
                    "data": ["pairToken","launchConfigId","graduationThreshold"] },
    "graduation": { "topic0": "0x0a44ef75…8c259",  "indexed": ["token"],
                    "data": ["positionId","tokenAmount","pairTokenAmount"] }
  },
  "views": {
    "config": { "selector": "0x3cf28b5a", "target": "factory", "returnWords": 15,
                "fields": { "pairToken": 4, "graduationThreshold": 5, "creatorTaxBps": 8, "phase": 10, "exists": 14 } }
  },
  "threshold": { "semantics": "pairTokenWei", "value": "4200000000000000", "source": "event" },
  "pairClassMap": "data/pair-tokens.json",
  "taxBuckets": [[0,0,"0%"],[1,100,"1%"],[101,300,"2-3%"],[301,500,"4-5%"],[501,1000,"6-10%"]],
  "fastCutoffSeconds": 300,
  "definitionsVersion": "2026-09-06"
}
```

A venue file is a **definition**, so changing one is a `/method` changelog entry, and each venue carries its own `definitionsVersion` and its own fast-cutoff — a second launchpad may need a different descriptive threshold, and forcing 300 s on it would be exactly the fake precision CONSTRAINTS §6 warns about. **Each venue's cutoff must be justified from its own data before publication, and until it is, that venue publishes the raw rate only.**

Refactor shape: `stats.py` module constants become a `Venue` dataclass argument threaded through `build_number(...)`; `crawl.py` takes `--venue pons` and writes under that venue's data root. `pons.json` must reproduce the existing `number.json` **byte-for-byte** — that is the acceptance test for the whole refactor, and it is free because the gate already exists.

Site: a venue column on `/cohorts` and a venue selector on `/`, with Pons as the default and the only venue in the fold until a second one has 24 hours of data. **[R4]** supplies the other factories.

---

## 7. Telegram bot

Webhook only — no polling, no process. `POST /tg/{secret}` on the Worker, where `{secret}` is a 32-byte random path segment set with `setWebhook` and additionally verified against `X-Telegram-Bot-Api-Secret-Token`. Bot token in a Worker secret.

| Command | Response |
|---|---|
| `/number` | The two figures, both with n, the window, and the age — the same text the fold prints, assembled from the same `number.json` |
| `/start`, `/help` | One paragraph: what LEDGE measures, the method link. No feature list, no invitation |
| `/method` | Link to `/method` |
| a bare address (any message) | The lookup text: config, cohort with n, live state, ladder placement — the same objects as `/api/token`, rendered by a **shared** text builder |
| anything else | Silence in groups; in DMs, one line naming the two things it understands |

**Never**, enforced by the copy lint extended over `worker/src` and by the fact that the bot has no template of its own: any future tense about a token, any verdict word, any imperative, any emoji, any percentage without its n, any address echoed back beyond the one the user pasted.

**Abuse limits:** 20 messages/hour/chat and 5,000/day globally, counted in `tg_usage`; over the limit the bot goes silent rather than replying "rate limited" (a reply is itself the resource being abused). Group chats: only `/command@ledgebot` and messages that are exactly an address. Never reply to edited messages. Never store message text — only `(chat_id, hour, count)`.

---

## 8. Folder tree additions

```
ledge/
├── venues/
│   ├── pons.json                    # definitions (see §6) — a change here needs a /method entry
│   └── hood.json                    # [R4]
├── contracts/                       # Foundry
│   ├── foundry.toml
│   ├── src/LedgeOracle.sol
│   ├── test/LedgeOracle.t.sol
│   └── script/Deploy.s.sol  script/publish.sh
├── worker/                          # Cloudflare Worker (TypeScript)
│   ├── wrangler.toml                # cron "* * * * *", d1 binding DB, kv binding NUMBERS
│   ├── schema.sql                   # §2 DDL
│   ├── src/
│   │   ├── index.ts                 # router: /api/*, /t/*, /og/*, /tg/*
│   │   ├── tick.ts                  # scheduled(): the minute indexer
│   │   ├── rpc.ts                   # batch JSON-RPC, 429-as-object, pacing (port of pipeline/rpc.py)
│   │   ├── lookup.ts                # Class B reads + Class A table lookups. NO ARITHMETIC.
│   │   ├── ladder.ts                # rung lookup, 9 lines, vector-tested
│   │   ├── text.ts                  # the one text builder, shared by API, /t, and Telegram
│   │   ├── og.ts                    # satori -> PNG death card
│   │   ├── telegram.ts
│   │   └── schema.ts                # Zod response schemas; every Class A object requires n+window
│   └── tests/                       # vitest + @cloudflare/vitest-pool-workers
├── pipeline/
│   ├── ladder.py                    # LADDER_EDGES + cumulative table (in stats.py's namespace)
│   ├── vectors.py                   # emits tests/vectors/*.json from a frozen number.json fixture
│   └── venues.py                    # loads venues/{name}.json into a Venue dataclass
├── tests/vectors/
│   ├── fixture-number.json          # frozen, never live data
│   ├── lookup.json                  # inputs -> exact expected API objects and rendered strings
│   └── ladder.json
├── site/app/
│   ├── page.tsx                     # landing, leads with 1 in N (was the broadsheet)
│   ├── number/page.tsx              # the broadsheet share card (unchanged content)
│   ├── lookup/page.tsx              # static shell + client fetch
│   └── live/page.tsx                # static shell + client fetch, 15 s
└── .github/workflows/
    ├── crawl.yml                    # + kv-push job, + oracle job (both continue-on-error)
    ├── ci.yml                       # + worker tests, + vector gate, + forge test, + key-name lint
    └── reconcile.yml                # nightly: D1 vs repo divergence check
```

---

## 9. Testing and gates

**What the existing recompute gate covers, unchanged:** every Class A figure, byte-for-byte, including the new `ladder` and `pairTax` cohort. Adding them to `number.json` extends the gate for free — that is the whole reason for putting them there.

**Gate 1 — the vector gate (new, the important one).** `pipeline/vectors.py` reads the frozen `tests/vectors/fixture-number.json` and emits `tests/vectors/lookup.json`: a list of `{ input: { elapsedSeconds, pairClass, taxBucket, phase, curveFilledWei, graduated }, expected: { cohort, placement, text } }` covering the boundaries that matter — elapsed exactly on a ladder edge, elapsed past `max`, `n` at 29 and 30, a null tax bucket, a graduated token, an unindexed token. Python generates it; the Worker's vitest asserts its own `lookup.ts` and `text.ts` produce the identical object and the identical sentence. Committed, diffed in CI. If either side drifts, both jobs fail. This is what makes "the Worker does not reimplement the Number" a fact rather than an intention.

**Gate 2 — the no-arithmetic lint.** `scripts/lint-worker.sh` fails on any of `Math.round`, `toFixed`, ` / `, `percentile`, `reduce(` inside `worker/src/lookup.ts`, `ladder.ts` and `text.ts`. Blunt, and blunt is the point: those three files may read numbers and format strings, nothing else. Formatting helpers that genuinely need division live in a separate file with a reviewer note.

**Gate 3 — the key-name lint.** grep the API schema and `text.ts` for `score|risk|odds|chance|likely|safe|rug|probab|predict|will `. Extend `scripts/lint-copy.sh` to cover `worker/src` and `site/app/{lookup,live,t}` so the NOT-THIS list reaches the new surfaces.

**Gate 4 — response schema.** The same Zod discipline as `site/lib/schema.ts`: a `superRefine` asserting that every Class A object has `launches`, `window` and `crawledAt`, and that `rate === null` whenever `insufficient`. The Worker validates its own response before returning it; a violation is a 500 and a log line, never a shipped number.

**Gate 5 — contracts.** `forge test`: only the writer may publish; a stale `crawledAt` reverts; `graduations > launches` reverts; bps > 10000 reverts; rotation emits and takes effect; ownership transfer; `Reading` occupies one storage slot (`forge inspect LedgeOracle storage-layout` asserted in CI). Plus a `publish.sh` dry-run against a local anvil in CI.

**Gate 6 — OG.** The death card PNG is 1200×630, and its rendered text tree contains the address prefix, the cohort `n`, and `ledge.tools`. Same assertion style as the Phase 1 `og.mjs` test. One extra case: an `insufficient` cohort must render "not enough data (n=…)" in the image, never a percentage — the OG is the highest-leverage place for a naked number to escape.

**Gate 7 — nightly reconciliation** (`reconcile.yml`). Compares D1's 24 h launch count and graduation count against the committed partitions for the same window; a divergence above 0.5% opens an issue. This is the only detector for a silently wrong minute indexer.

**Gate 8 — Playwright smoke**, extended: landing renders the "1 in N" figure with its n; `/lookup` with a mocked API renders the insufficient state without a percentage; `/live` renders 200 rows with no `0x` string anywhere in the DOM.

---

## 10. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The Worker's per-token figures drift from `stats.py` | Medium | **Critical** — this is LEDGE's only asset | Class A/B split; the ladder and `pairTax` ship inside the gated file; vector gate; no-arithmetic lint |
| Two indexers double the RPC load and trip 429s | High | Medium | Batch envelope reused; a 429 skips the tick without advancing the cursor; bounded 5,000-block catch-up; `RPC_URL` fallback variable |
| Curve view function is not what we assume | Medium | Medium | **[R1]** blocks only the fill bar; the rest of the lookup ships without it. Fallback: read `graduationThreshold` from `getLaunchedToken[5]` and the curve's ETH balance |
| Vercel external rewrites unavailable or slow | Low | High | Fallback: `/t/*` served from `t.ledge.tools` (Cloudflare) and cross-linked; the URL is uglier but the feature survives |
| Death card copy reads as a verdict | Medium | **Critical** | Past tense only; one shared `text.ts`; key-name lint; `code-reviewer` with CONSTRAINTS as rubric before any deploy of `/t` |
| Oracle write fails or the key runs dry | Medium | Low | Separate `continue-on-error` job; `crawledAt` stops advancing and readers see it; a funding-threshold check logs before it fails |
| Writer key leaks from Actions | Low | Medium | Key holds gas only and can only call `publish`; owner key offline; rotation is one tx |
| D1 grows past the free tier | Low | Low | 7-day retention caps the table at ~25 MB against 5 GB |
| A second venue's data quality is worse than Pons's | Medium | Medium | Per-venue `definitionsVersion`; a venue publishes the raw rate only until its own fast-cutoff is justified from its own data |
| Telegram bot abused as free RPC | Medium | Low | Per-chat and global caps; silence over refusal messages; the same Cache API path as the web lookup |
| Landing-page copy drifts toward selling | High | High | `lint-copy.sh` covers `site/app`; the NOT-THIS list is a review rubric, and "explains the product" must not become "sells the product" |
| Scope: four phases in one launch | Certain | High | §11 sequences so that every day ends shippable; Phase 4 items are individually droppable |

---

## 11. Sequencing

Parallelisable from day one: **(a)** the Python additions (ladder, `pairTax`, vectors, venue refactor) — no external dependency; **(b)** the Worker skeleton and D1 — depends only on the Phase 1 RPC envelope, which is measured; **(c)** contracts — fully independent; **(d)** landing-page copy and design — independent. Only the curve fill bar (**[R1]**) and cross-venue (**[R4]**) block on research.

| Day | Work | Ships at end of day |
|---|---|---|
| 1 | `pipeline/ladder.py`, `pairTax` cohort, `vectors.py`; regenerate `number.json`; extend Zod + fixtures; `/method` changelog entry for the ladder edges | Gate still green; the live layer's whole data dependency exists |
| 2 | `worker/` skeleton: wrangler, D1 schema, `rpc.ts` port, `tick.ts`, KV push job in `crawl.yml`. Verify one hour of ticks against the repo | An indexer that agrees with Python |
| 3 | `lookup.ts`, `ladder.ts`, `text.ts`, `schema.ts`, `/api/token`, `/api/live`, `/api/health`; vector gate + no-arithmetic lint in CI | The API, gated |
| 4 | Site: `/` becomes the landing page leading with "1 in N"; `/number` keeps the broadsheet; `/lookup` and `/live` shells; Vercel rewrites | **Phase 2 complete and shippable** |
| 5 | `contracts/`: `LedgeOracle.sol`, forge tests, deploy, `publish.sh`, oracle job. Dataset mirror (below) | Phase 3a + 3b |
| 6 | `/t/{address}` HTML + `/og/t/*.png` + gate 6; death-card copy through `code-reviewer` against CONSTRAINTS | Phase 4a |
| 7 | Telegram webhook + limits; `reconcile.yml`; Playwright; full livetest | Phase 4b |
| 8 | Venue refactor: `venues/pons.json` reproducing `number.json` byte-for-byte, then `hood.json` once **[R4]** lands; venue column | Phase 3c |
| 9 | Weekly dispatch (Phase 4c) — a Markdown file in the repo rendered to `/dispatch/{date}` at build, sent by a manual Action step. **One insight, with its n.** No list-building, no capture on the site (CONSTRAINTS §8): subscription is a `mailto:` or nothing | Phase 4c |

**Dataset mirror (day 5), decided here to avoid a fifth matrix:** **GitHub Releases, nightly tarball.** Zero cost, zero new credentials, versioned, checksummed, and it doubles as the Phase 1 §14 escape hatch for partitions older than 90 days. R2 costs money and adds a credential for a problem we do not have; Arweave buys permanence LEDGE cannot yet promise to maintain and is a one-way commitment to whatever definitions were current that day — a poor fit for a project whose changelog exists precisely because definitions move. Revisit Arweave when the dataset has been stable for a quarter.

---

## 12. What the research must confirm

| | Question | Blocks | Fallback if unanswered |
|---|---|---|---|
| **R1** | Curve view function on `0xF6e8…EF04c` for raised/reserve amount, and its units | The curve fill bar only | `graduationThreshold` from `getLaunchedToken[5]`; fill from the curve's ETH balance for `pairToken == 0x0`, and the bar is omitted for other pair tokens |
| **R2** | `CurveBuy`/`CurveSell` topic0s and daily volume | Nothing in this design — deliberately | First-block buyer concentration stays deferred |
| **R3** | Whether the RPC allows batch JSON-RPC from a Cloudflare egress IP, and its CORS headers | The Worker's tick sizing; open CORS on the RPC would let the client read the chain directly and halve the Worker's work | Assume no CORS, all chain reads through the Worker (the design already assumes this) |
| **R4** | Other Robinhood Chain launchpad factories: addresses, topic0s, threshold semantics | Phase 3c only (day 8) | Ship Pons-only; the venue file format is already general |
| **R5** | Gas price and block gas limit on Robinhood Chain | The oracle funding number | Fund with a conservative float; `publish.sh` logs cost per write for the first week |
| **R6** | `ponsfamily.com` launch-URL format for address extraction | Client-side normalisation only | Accept addresses only, with a one-line note |
| **R7** | `satori` font loading inside a Worker (embedded base64 vs KV asset) | Death card OG | Embed the two faces as base64 in the bundle; watch the 1 MB free-tier script limit and drop to one face if needed |

Assumptions asserted without research, to be checked in build: Robinhood Chain `phase` semantics per `PONS_CONTRACTS.md` (0 live, 2 graduated, 1 and 3 unobserved) — the API must render an unobserved phase as `phaseLabel: "unknown phase (n)"` rather than guessing; ~13 launches/minute sustained; Cloudflare Workers cron subrequest limit of 50 on the free tier.
