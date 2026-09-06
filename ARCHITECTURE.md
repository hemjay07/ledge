# LEDGE — Architecture (Phase 1)

Binding inputs: `CONSTRAINTS.md`, `METHOD.md`, `SPEC.md`, `PONS_CONTRACTS.md`. This document decides only what those delegate. Where a decision changes a definition, it says so and requires a `/method` changelog entry.

---

## 0. Constraints summary

| | |
|---|---|
| Timeline | 6–7 working days, solo. Architecture time budget spent here; no further design rounds. |
| Team | One developer plus implementation agents. Zero abstraction layers "for the team". |
| Stack | Python 3.12 stdlib pipeline (no web3, no requests); Next.js App Router static export, TypeScript, Tailwind v4. |
| Deployment | GitHub Actions (public repo, unlimited minutes) + Vercel free tier. No always-on process. No secrets required. |
| Scale | ~19,000 launches/day (~800/hour), ~640 graduations/day. Site is static; traffic cost is Vercel's problem. |
| Non-negotiable | Block-header timestamps. Every number carries `n`. CI recompute diff must be byte-for-byte. |

---

## 1. RPC capability — measured, not assumed

Measured against `https://rpc.mainnet.chain.robinhood.com` on 2026-09-06:

| Probe | Result |
|---|---|
| Batch JSON-RPC array | **Accepted.** Returns a JSON array of responses. |
| `eth_getBlockByNumber` × 150 in one batch | OK |
| `eth_getBlockByNumber` × 200 in one batch | `{"code":429,"message":"Too Many Requests"}` (single object, not an array) |
| `eth_getBlockByNumber` × 100 every 1.0 s | OK twice, then 429 on the third — a rolling sub-request budget, not a per-batch cap |
| `eth_call` × 100 in one batch | 429 |
| `eth_call` × 50 every 2.0 s, six consecutive | **All OK, zero errors** |

**Derived operating envelope: batch size 50, one batch per 2.0 seconds (≈25 sub-requests/s), for both `eth_getBlockByNumber` and `eth_call`.** `eth_getLogs` keeps `crawl0.py`'s proven single-request-per-0.9 s pacing (0 errors over 1,400 requests / 700 windows) because log windows are heavy and few.

A 429 arrives as a **single object where an array was requested**. The RPC client must detect this shape and treat it as a retryable rate-limit, not as a parse error.

---

## 2. Decision: block timestamps

~800 event-bearing blocks per hourly run. The 20-hour backfill contains 23,552 launches across 23,055 **distinct** blocks — essentially one block per launch, so timestamp cost tracks launch count 1:1.

| Criterion | A: batch `eth_getBlockByNumber` | B: sequential calls | C: Blockscout `/api/v2/blocks/{n}` | D: interpolate between anchors |
|---|---|---|---|---|
| Accuracy | Exact (header) | Exact | Exact | Bounded error, not exact |
| Per hourly run | 16 batches × 2.0 s ≈ **32 s** | 800 × 0.9 s ≈ 12 min | ~800 HTTP requests, unknown limits | ~5 s |
| Per 20 h backfill | 461 batches ≈ **15.4 min** | ~6 h | unknown | ~1 min |
| Complexity | Low (one helper) | Low | Medium (second provider, second failure mode) | High (anchor policy, error bound, `/method` entry) |
| METHOD compliance | Yes | Yes | Yes | **Requires a definition change** |
| Risk | Rolling 429 budget → backoff | Run exceeds cron interval | Second dependency, unproven | Wrong ts near a sequencer pause |

**Recommendation: A.** It is exact, it satisfies METHOD §Source without amendment, and it costs 32 seconds an hour. Interpolation buys ~27 seconds and costs a definitional change — a straightforwardly bad trade. **Runner-up: C**, only as a fallback provider if the RPC starts rejecting batches.

**Per-run network budget (hourly):**

| Stage | Requests | Time |
|---|---|---|
| `eth_getLogs`, 2 topics × ~39 windows (35,600 blocks/h at ~0.101 s/block + 3,000-block reorg overlap) | 78 @ 0.9 s | ~70 s |
| Block timestamps, ~800 distinct blocks | 16 batches @ 2.0 s | ~32 s |
| `getLaunchedToken`, ~800 launches | 16 batches @ 2.0 s | ~32 s |
| `symbol()` for unseen pair tokens (0–2/h) | ~1 | ~2 s |
| **Total** | | **~2.5 min; budget 20 min with backoff** |

**Backfill (20 h):** 1,400 log requests ≈ 21 min + 461 timestamp batches ≈ 15.4 min + 471 enrichment batches ≈ 15.7 min ≈ **52 min**; workflow timeout 180 min.

---

## 3. Decision: `getLaunchedToken` enrichment

Selector `0x3cf28b5a` (`getLaunchedToken(address)`), called on the factory, returns a 15-word static tuple. Fields used: `[4] pairToken`, `[8] creatorTaxBps`, `[10] phase`. Verified live: word[8]=300, word[10]=0, word[14]=1 for a fresh launch.

- **Batching:** 50 calls per batch, 2.0 s pacing — the measured-sustainable rate. Enrich only launches new in this run.
- **Failure handling:** three retries with backoff (2 s, 4 s, 8 s) at the batch level; then **per-item retry once**; then give up on that token. A failed item is written with `"creatorTaxBps": null`. Per CONSTRAINTS §3, the launch **still counts in every rate** — only the tax cohort excludes it, and `number.json` reports `cohortsExcluded.tax` so the exclusion is visible.
- **Zero-tolerance logging:** the run prints `enrichmentFailures=N`; N > 0 does not fail the run, but N > 5% of new launches fails it (a systemic RPC problem, not noise).
- **Pair class:** `pairToken` from the event is authoritative. If unseen, one `symbol()` `eth_call` appends `{symbol, class: "other"}` to `data/pair-tokens.json`; a human reclassifies it in a later commit. `pairToken == 0x0` is class `eth` without a call.

---

## 4. Incremental crawl design

`pipeline/crawl.py` is a single-shot, all-or-nothing run.

1. Read `data/state.json`. Start at `max(firstIndexedBlock, lastIndexedBlock - REORG_WINDOW + 1)`; `REORG_WINDOW = 3000` blocks (~5 minutes of chain, 3 extra windows, ~6 extra requests).
2. Fetch head via `eth_blockNumber`. Scan to head in 1,000-block windows, two `eth_getLogs` per window (one per topic0), 0.9 s pacing, `crawl0.py` retry/backoff.
3. **Accumulate everything in memory.** An hour is ~800 records; a 20-hour backfill is ~24,000 — both trivial.
4. Fetch block timestamps for **every** scanned record, before the dedupe. A record's UTC-day partition is decided by its **block timestamp**, never by the run's wall clock, so the set of partitions the dedupe must consult is derived from the timestamps of the records about to be written (each record's day, ± one day) — *not* from `now`. Keying that day set off `now` is wrong: after an outage the reorg re-scan reaches blocks days older than the run, whose partitions would then go unread and every record in them be appended a second time.
5. Load the `(txHash, logIndex)` key set from those partitions (plain and `.gz`) and drop any accumulated record whose key is already present. **Dedupe is on `(txHash, logIndex)` only** — never on token address, because a token can in principle appear twice and because a reorg replay produces identical keys. Then enrich the surviving new launches.
6. Decide `orphan` for each new graduation against **every launch token LEDGE has ever recorded** — the existing partitions plus this run's new launches — not against this run's new launches alone. In steady state most graduations belong to launches from earlier runs, and the narrower comparison marks them all orphan. `state.counts.orphanGraduations` is re-derived the same way, so it always agrees with `number.json`.
7. **Commit point.** Every output is computed into memory first: the appended partition payloads, the merged/rotated `.gz` archives, `data/pair-tokens.json`, `data/number.json` (from the staged in-memory record set, not by re-reading disk) and `data/state.json`. Only after the last of those returns successfully does the run write anything, and it then writes each payload to a sibling `.tmp` and `os.replace`s it into place, in the order partitions → rotations → pair-tokens → `number.json` → `state.json`. A failure at any earlier point — an RPC error, a missing block header, a stats bug — exits non-zero having written **nothing**: the data directory is byte-for-byte unchanged, `state.json` still points at the old `lastIndexedBlock`, no `.tmp` file survives, and the next run re-scans the same range.
8. If no new records and `lastIndexedBlock` is unchanged, exit 0 with no file writes so the Action makes no commit (SPEC acceptance: two consecutive empty runs produce no commit). If `lastIndexedBlock` advanced but there were no events, `state.json` still changes and a commit is made — that is correct, it advances the resume point.

Records are appended in block order and never rewritten, so each hourly commit is a small tail diff rather than an 8 MB rewrite.

### `data/state.json`

```json
{
  "version": 1,
  "firstIndexedBlock": 55219400,
  "lastIndexedBlock": 55919382,
  "reorgWindow": 3000,
  "lastRunAt": "2026-09-06T12:45:03Z",
  "lastSuccessAt": "2026-09-06T12:45:03Z",
  "consecutiveFailures": 0,
  "lastError": null,
  "counts": {
    "launches": 23552,
    "graduations": 559,
    "orphanGraduations": 24,
    "enrichmentFailures": 0
  }
}
```

---

## 5. Data layout and repo growth

### Record schemas (JSONL, one object per line, keys in the order below)

`data/launches/YYYY-MM-DD.jsonl` — fields per METHOD §Reproducibility plus the dedupe key:

```json
{"token":"0x23fe54b3bf9e1d2816822043c0b02b6a12f98fe2","curve":"0xf6e86610771ee7838cabe2f9c376265ca25ef04c","deployer":"0x3102c27b522664e643441bf86492bf652c2251ca","pairToken":"0x0000000000000000000000000000000000000000","pairClass":"eth","creatorTaxBps":300,"block":55918435,"ts":1757160067,"txHash":"0x…","logIndex":3}
```

`data/graduations/YYYY-MM-DD.jsonl`:

```json
{"token":"0xc1fe816024c51b6dc493b2f7edd7e7f05ed1be4a","block":55919124,"ts":1757160142,"pairTokenAmount":"8090000094","orphan":false,"txHash":"0x…","logIndex":1}
```

`pairTokenAmount` is the **raw uint256 as a decimal string**. The backfill's float conversion (`8.090000094e-09`) is lossy and unfit for a reproducible dataset; nothing on the site renders it in Phase 1. `orphan` is a snapshot; recompute re-derives orphan status from the full launch set.

`pairClass` in the launch record is a **snapshot for human readers**. `recompute.py` resolves pair class from `data/pair-tokens.json` by `pairToken` address, so reclassifying a symbol changes `number.json` without touching a single JSONL byte. CI does not assert consistency between the two.

### Growth

A launch line is ~430 bytes. At 19,000/day that is **~8.2 MB/day** plain; graduations add ~130 KB/day.

**Policy:** the current UTC day's partition stays plain text (append-only, tiny diffs). At the start of each run, any partition older than today is rewritten as `YYYY-MM-DD.jsonl.gz` and the plain file deleted — one 2.9 MB git blob written once and never re-diffed. Gzip must be deterministic: `gzip.GzipFile(filename="", mtime=0, compresslevel=9)`, so re-running the rotation is a no-op. Rotation **merges, never overwrites**: after an outage crossing midnight a day can hold both `D.jsonl.gz` and a fresh `D.jsonl`, and replacing the archive with the fragment would silently drop every earlier record of that day. The archive and the plain file are concatenated in that order, deduped on `(txHash, logIndex)`, and rewritten as one deterministic `.gz`. Loaders accept both extensions. Net growth **≈ 3 MB/day, ~1 GB/year** — acceptable for Phase 1; the v1.1 escape hatch is moving partitions older than 90 days to GitHub Releases with a checksum manifest.

The site build reads **only `data/number.json`** (~40 KB). Raw partitions are never bundled, imported, or copied into `site/public`.

---

## 6. Stats engine — `pipeline/stats.py`

Pure functions. No I/O, no network, no clock reads except where `now` is an explicit argument.

```python
# Input records (dicts as parsed from JSONL, pairClass already re-resolved)
Launch    = TypedDict("Launch", {"token": str, "deployer": str, "pairToken": str,
                                 "pairClass": str, "creatorTaxBps": int | None,
                                 "block": int, "ts": int})
Graduation = TypedDict("Graduation", {"token": str, "block": int, "ts": int})

MIN_N = 30
FAST_CUTOFF = 300  # seconds

def window(launches: list[Launch], graduations: list[Graduation],
           since: int | None, until: int) -> Window: ...
    # Window = {"launches": list[Launch], "grads_by_token": dict[str, Graduation],
    #           "since": int | None, "until": int, "orphans": int}
    # Selection: launch.ts in the HALF-OPEN interval [since, until) -- a launch at
    # exactly `until` belongs to the next window, so adjacent windows partition the
    # timeline. A graduation is included iff its token has a launch IN THIS WINDOW;
    # graduation ts may fall outside it. since=None => all-time.

def rate(w: Window) -> dict:            # {"launches", "graduations", "rate": float|None, "insufficient": bool}
def rate_excluding_fast(w: Window, cutoff: int = FAST_CUTOFF) -> dict
                                        # + {"oneIn": int|None}
def ttg_percentiles(w: Window) -> dict  # {"p10","p25","p50","p75","p90","p95","max","n"} ints|None
def fast_shares(w: Window) -> dict      # {"under300Share", "under60Share", "n", "insufficient"}
def cohort(w: Window, key: str) -> list[dict]
                                        # key in {"pairClass","taxBucket","hourUtc","dayUtc"}
def cohort_excluded(w: Window, key: str) -> int
def deployers(w: Window) -> dict
def canonical_dumps(obj) -> str         # in pipeline/canonical.py
def build_number(launches, graduations, state, crawled_at: str) -> dict
```

### Binding computation rules

- **`n` is the bucket's launch count** (the denominator). `n < 30` → `rate: null`, `insufficient: true`. Applied uniformly, including the top-line figures — and to every published proportion, not only rates: `fastShares.under300Share`/`under60Share` (n = matched graduations) and `deployers.launched2plusShare` (n = distinct deployers) / `from10plusShare` (n = launches) are `null` with `insufficient: true` below 30, never `0.0`. A `0.0` share reads as a measured finding; an absent one must not.
- **`rate = round(graduations / launches, 6)`**. `graduations` = launches in the window that have a matching graduation record at any time.
- **`oneIn = int(Decimal(1 / rate).quantize(0, ROUND_HALF_UP))`** — explicit half-up, never Python's banker's rounding. `null` when `graduations == 0` or `insufficient`. Check against the backfill: 174/23552 = 0.007388 → 135.4 → **135**, matching the recorded "0.74% (1 in 135)".
- **Percentiles: nearest-rank.** Sort time-to-graduation ascending; `idx = ceil(p/100 * n) - 1`, clamped to `[0, n-1]`. Integer seconds. If matched graduations < 30, every percentile is `null` and `ttg.insufficient = true`.
- **Tax buckets** (`creatorTaxBps`): `0`, `1–100`, `101–300`, `301–500`, `501–1000` → labels `"0%"`, `"1%"`, `"2-3%"`, `"4-5%"`, `"6-10%"`. `creatorTaxBps is None` → excluded from the cohort and counted in `cohortsExcluded.tax`.
- **Hour/day** buckets from `datetime.fromtimestamp(ts, UTC)`. All 24 / all 7 rows are always emitted, even at n=0, so the renderer never has to reason about missing buckets.
- **Day-of-week gating** (METHOD): the `day` cohort renders only if **every** row has `insufficient == false`. This is derivable from the array; no extra schema field.
- **24 h lower bound**: `h24.lowerBound: true` is always set. Copy renders "lower bound — launches near the end of the window may still graduate".
- **Orphan graduations** (24 in the backfill) are counted in `orphans` and excluded from every numerator.

---

## 7. `data/number.json` — versioned schema

`schemaVersion` gates the TypeScript loader; `definitionsVersion` is the `/method` changelog date.

```json
{
  "schemaVersion": 2,
  "definitionsVersion": "2026-09-06",
  "crawledAt": "2026-09-06T12:45:03Z",
  "staleAfterSeconds": 7200,
  "stale": false,
  "headBlock": 55919382,
  "firstIndexedBlock": 55219400,
  "factory": "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  "chainId": 4663,
  "h24": {
    "since": 1757073903,
    "until": 1757160303,
    "lowerBound": true,
    "launches": 23552,
    "graduations": 535,
    "rate": 0.022716,
    "insufficient": false,
    "orphans": 24,
    "excludingFast": {
      "cutoffSeconds": 300,
      "graduations": 174,
      "rate": 0.007388,
      "oneIn": 135,
      "insufficient": false
    },
    "fastShares": { "under300Share": 0.674766, "under60Share": 0.437383, "n": 535, "insufficient": false },
    "ttg": {
      "n": 535, "insufficient": false,
      "p10": 12, "p25": 72, "p50": 96, "p75": 540,
      "p90": 3000, "p95": 6600, "max": 18000
    },
    "cohorts": {
      "pair": [
        { "bucket": "eth",   "launches": 11962, "graduations": 196, "rate": 0.016385, "insufficient": false },
        { "bucket": "stable","launches": 0,     "graduations": 0,   "rate": null,     "insufficient": true },
        { "bucket": "stock", "launches": 0,     "graduations": 0,   "rate": null,     "insufficient": true },
        { "bucket": "other", "launches": 11590, "graduations": 339, "rate": 0.029249, "insufficient": false }
      ],
      "tax":  [ { "bucket": "0%", "launches": 0, "graduations": 0, "rate": null, "insufficient": true } ],
      "hour": [ { "bucket": "00", "launches": 0, "graduations": 0, "rate": null, "insufficient": true } ],
      "day":  [ { "bucket": "Mon","launches": 0, "graduations": 0, "rate": null, "insufficient": true } ]
    },
    "cohortsExcluded": { "pair": 0, "tax": 0, "hour": 0, "day": 0 },
    "deployers": {
      "distinct": 15258,
      "launched2plusShare": 0.118363,
      "from10plusShare": 0.213154,
      "insufficient": false,
      "histogram": [ { "bucket": "1", "deployers": 13452 }, { "bucket": "2-4", "deployers": 0 },
                     { "bucket": "5-9", "deployers": 0 }, { "bucket": "10-49", "deployers": 0 },
                     { "bucket": "50+", "deployers": 0 } ]
    }
  },
  "allTime": { "...identical shape, since: null, lowerBound: false..." }
}
```

Cohort arrays above are abbreviated with a single illustrative row; the real file always emits every bucket. Numeric values shown are drawn from the 20-hour backfill where the recorded figures exist (23,552 launches, 535 graduations, 361 under 300 s, 234 under 60 s, 24 orphans, 15,258 deployers, 1,806 with 2+, 5,020 launches from deployers with 10+) and are placeholders where they do not — the implementation must derive all of them.

### `stale`

`number.json` is static, so `stale` cannot track wall-clock time. Binding rules:

- `stale` in the file is `true` **only** when the generating run knows it is behind — `consecutiveFailures > 0`, `lastRunAt` later than `lastSuccessAt`, or no successful run yet. It is not a wall-clock measure: a successful run publishes `stale: false` no matter how old the data later becomes. In the normal path it is `false`.
- **Wall-clock staleness is computed in the browser** from `crawledAt` (§10). A consumer of `/number.json` computes it the same way; `staleAfterSeconds` is published so the threshold is not folklore.
- **Crawl-failed collapses into stale by design**: a failed run commits nothing, `crawledAt` ages, and the banner appears with "Last successful measurement {crawledAt}" — which is exactly the copy SPEC §9 specifies.

---

## 8. Reproducibility gate

`pipeline/recompute.py`:

```
usage: recompute.py [--data-dir data] [--out data/number.json] [--check]
```

No network imports; the module asserts at import time that `urllib.request` is never called (the RPC client lives in `pipeline/rpc.py` and `recompute.py` does not import it). It reads `state.json` for `headBlock`/`firstIndexedBlock`/`crawledAt` and every partition (plain and `.gz`), re-resolves `pairClass` from `pair-tokens.json`, and writes canonical JSON. `--check` diffs against the committed file and exits 1 on any difference, printing a unified diff.

### Canonical serialization — `pipeline/canonical.py`

```python
def canonical_dumps(obj) -> str:
    return json.dumps(obj, sort_keys=True, indent=2,
                      ensure_ascii=False, separators=(",", ": "),
                      allow_nan=False) + "\n"
```

Determinism rules, all binding:

1. **Every float is produced by `round(x, 6)` before serialization.** No float reaches the serializer unrounded.
2. Python 3.12 is pinned in Actions and CI. CPython's `repr` of a double is shortest-round-trip and stable across patch versions, so `round(x, 6)` plus `repr` is byte-stable.
3. `-0.0` is normalized to `0.0`; `NaN`/`Infinity` are impossible (`allow_nan=False` turns a bug into a crash).
4. Integers stay integers — never `1.0` where `1` is meant.
5. `sort_keys=True` makes key order independent of construction order. Array order is fixed by the spec (hour `00`–`23`, day `Mon`–`Sun`, pair `eth, stable, stock, other`, tax ascending, histogram ascending).
6. Timestamps are `strftime("%Y-%m-%dT%H:%M:%SZ")` — no microseconds, no offset form.
7. The file ends with exactly one newline; `.gitattributes` marks `data/**` as `-text` so line endings cannot drift.

---

## 9. GitHub Actions

Vercel rebuild decision:

| | Vercel Git integration | Deploy hook from the Action |
|---|---|---|
| Secrets | none | `VERCEL_DEPLOY_HOOK` |
| Coupling | build follows the commit that contains the data | Action can fire before the commit lands |
| Failure mode | Vercel's "Ignored Build Step" may skip data-only commits (root dir is `site/`) | hook fires even when nothing changed |
| Auditability | deploy ↔ commit is 1:1 | needs correlation |

**Recommendation: Vercel Git integration on `main`, with the project's Ignored Build Step explicitly cleared** so commits touching only `data/` still deploy. The deploy hook is the documented fallback if skipping is observed in practice. **`[skip ci]` is never used**: it would suppress the recompute-diff gate (which is exactly the run we want on a data commit) while not affecting Vercel at all.

```yaml
# .github/workflows/crawl.yml
name: crawl
on:
  schedule: [{ cron: "7 * * * *" }]
  workflow_dispatch:
concurrency: { group: ledge-crawl, cancel-in-progress: false }
permissions: { contents: write }
jobs:
  crawl:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: python pipeline/crawl.py
        env: { RPC_URL: "${{ vars.RPC_URL }}" }
      - run: python pipeline/recompute.py --check
      - name: commit
        run: |
          git config user.name  "ledge-bot"
          git config user.email "ledge-bot@users.noreply.github.com"
          git add data
          git diff --cached --quiet && { echo "no data change"; exit 0; }
          git commit -m "data: crawl $(date -u +%Y-%m-%dT%H:%MZ)"
          for i in 1 2 3; do git pull --rebase --autostash && git push && exit 0; sleep 5; done
          exit 1
```

`backfill.yml` is identical except `on: workflow_dispatch` with an `hours` input (default `20`), `timeout-minutes: 180`, and `python pipeline/crawl.py --backfill-hours ${{ inputs.hours }}`.

```yaml
# .github/workflows/ci.yml
name: ci
on: { push: { branches: [main] }, pull_request: {} }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm, cache-dependency-path: site/package-lock.json }
      - run: pip install pytest && pytest pipeline/tests -q
      - run: python pipeline/recompute.py --check     # byte-for-byte gate
      - run: bash scripts/lint-copy.sh
      - run: npm ci --prefix site
      - run: npm run test --prefix site               # vitest
      - run: npm run build --prefix site              # next build + export
```

---

## 10. Site

- **Static export.** `next.config.ts`: `output: 'export'`, `images: { unoptimized: true }`, `trailingSlash: false`. Vercel project root `site/`.
- **Importing the data.** `site/lib/number.ts` does `import data from "../../data/number.json"` — a build-time literal, no fetch, no `generateStaticParams` gymnastics. A Zod schema validates it at module load and the build fails on a `schemaVersion` mismatch or a missing `n`.
- **`/number.json`.** A `prebuild` script copies `data/number.json` to `site/public/number.json`. Byte-for-byte identity with the committed file is asserted by a Vitest test (SPEC §8). `vercel.json`:
  ```json
  { "headers": [ { "source": "/number.json",
                   "headers": [ { "key": "Cache-Control", "value": "public, max-age=300" },
                                { "key": "Access-Control-Allow-Origin", "value": "*" } ] } ] }
  ```
- **OG image.** `next/og`'s `ImageResponse` under `output: 'export'` is **not verified** on this stack, and an unverified build-breaking dependency is not acceptable on a 6-day timeline. **Decision: generate the PNG in a prebuild step.** `site/scripts/og.mjs` reads `data/number.json`, renders with `satori` + `@resvg/resvg-js` to `site/public/og/number.png` (1200×630), and the page sets `metadata.openGraph.images = ["/og/number.png"]` plus `twitter.card = "summary_large_image"`. This is deterministic, unit-testable (assert 1200×630 and that the rate string and `ledge.tools` appear in the rendered text tree), regenerates on every data commit, and has no runtime. If a 20-minute spike shows `opengraph-image.tsx` exporting cleanly, switching to it is a contained change — but the prebuild script is what gets built.
- **`<Stat>` contract.** A discriminated union makes an omitted denominator a type error and an `insufficient` stat with a value unrepresentable:

  ```ts
  type StatBase = {
    label: string;
    n: number;                       // required, no default — the denominator
    window: "24h" | "allTime";
    updatedAt: string;               // ISO, from crawledAt
    format: "percent" | "oneIn" | "duration" | "count";
    lowerBound?: boolean;
  };
  export type StatProps =
    | (StatBase & { insufficient: true;  value: null })
    | (StatBase & { insufficient: false; value: number });
  ```
  `insufficient` renders `not enough data (n={n})` — never a percentage. Every stat renders its own denominator line and an `aria-label` that includes it.
- **Freshness is client-side.** Static export bakes the HTML, so relative age must be computed in the browser. `<Age crawledAt={...} staleAfterSeconds={...} />` is a client component: it renders the absolute UTC timestamp on the server pass, then swaps to `updated N min ago` in `useEffect` (no hydration mismatch), refreshing on a 60 s interval. It sets a `data-stale` attribute on `<html>` when `now - crawledAt > staleAfterSeconds`; `<StaleBanner>` and the only colour on the site key off that attribute in CSS. The OG PNG carries the age **as of generation**, which is honest because the PNG is regenerated with every data commit.
- **State matrix.**

  | State | Driven by | Computed |
  |---|---|---|
  | fresh | `now - crawledAt < staleAfterSeconds` | client |
  | stale | `now - crawledAt >= staleAfterSeconds` | client |
  | crawl-failed | no new commit → `crawledAt` ages | client (identical to stale; copy names `crawledAt` as the last successful measurement) |
  | insufficient | `row.insufficient === true` (per figure, per cohort row) | build |

---

## 11. Copy lint — `scripts/lint-copy.sh`

`grep -rniE` over `site/app site/components site/lib README.md` (excluding `METHOD.md`, which quotes the definitions it defines), exit 1 on any hit:

```
trade smarter|know before you ape|data.driven insight|\balpha\b|\bedge\b|\bsignals?\b
we believe|our mission|in today's|fast.moving
DYOR|not financial advice|risk warning
\bpro\b|premium|coming soon|waitlist|subscribe
connect wallet
gradient|glow|purple|violet
should (buy|sell|avoid|wait)|you should
[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]
```

`\bedge\b` cannot match `LEDGE` (word boundary). The emoji class also guards the token description and README. A `# lint-copy:allow` trailing comment on a line is the only escape hatch, and using it requires a reviewer note.

---

## 12. Folder tree

```
ledge/
├── SPEC.md  CONSTRAINTS.md  METHOD.md  PROGRESS.md  ARCHITECTURE.md  README.md
├── .gitattributes                  # data/** -text
├── vercel.json                     # Cache-Control for /number.json
├── pipeline/
│   ├── rpc.py                      # batch JSON-RPC client, 429-as-object detection, backoff, pacing
│   ├── crawl.py                    # windows, resume, dedupe, all-or-nothing commit, gz rotation
│   ├── enrich.py                   # getLaunchedToken batches, symbol(), pair-tokens.json upkeep
│   ├── timestamps.py               # batched eth_getBlockByNumber, block -> ts cache
│   ├── stats.py                    # pure functions (§6)
│   ├── canonical.py                # canonical_dumps (§8)
│   ├── recompute.py                # jsonl -> number.json, --check, no network
│   ├── keccak.py                   # existing
│   └── tests/                      # pytest; fixtures derived from backfill-20h-2026-09-06.json
├── data/
│   ├── state.json  pair-tokens.json  number.json
│   ├── launches/YYYY-MM-DD.jsonl[.gz]
│   └── graduations/YYYY-MM-DD.jsonl[.gz]
├── site/
│   ├── next.config.ts  vitest.config.ts  package.json
│   ├── scripts/og.mjs              # satori + resvg -> public/og/number.png
│   ├── scripts/copy-json.mjs       # data/number.json -> public/number.json
│   ├── app/ (layout.tsx, page.tsx, cohorts/page.tsx, method/page.tsx, number/page.tsx)
│   ├── components/ (Stat.tsx, DistributionBar.tsx, Cohort.tsx, StaleBanner.tsx, Age.tsx)
│   ├── lib/number.ts               # typed loader + Zod schema + formatters
│   └── tests/
├── scripts/lint-copy.sh
└── .github/workflows/ (crawl.yml, backfill.yml, ci.yml)
```

**Responsibilities.** `rpc.py` owns every network call and every retry — nothing else imports `urllib`. `crawl.py` orchestrates and owns the commit point. `stats.py` is pure and is the only place a definition lives in code. `recompute.py` is the reproducibility oracle; it must never import `rpc.py`. `lib/number.ts` is the only place the site touches raw JSON.

---

## 13. First-run / backfill plan

`backfill-20h-2026-09-06.json` has **block numbers only** — no timestamps, no `txHash`/`logIndex`, launches keyed by token (so the dedupe key is unrecoverable), and `pairTokenAmount` already lossily converted to float. It cannot seed a METHOD-compliant dataset.

**Recommendation: re-crawl.** Run `backfill.yml` with `hours: 20` from the current head. Cost ≈ 52 minutes of network time, once. The existing JSON is retained for two purposes only, both offline: (1) pytest fixtures for `stats.py`, with synthetic timestamps derived as `block × 0.101 s` **clearly marked as fixture-only**; (2) an independent sanity check that the re-crawl recovers the same launch and graduation counts (23,552 / 559, 535 matched, 24 orphans) over the same block span (55,219,400 → 55,919,338).

Order of implementation: `rpc.py` + `timestamps.py` (prove the envelope) → `stats.py` + tests against fixtures → `recompute.py` + canonical JSON → `crawl.py` + `enrich.py` → `backfill.yml` run → `crawl.yml` → site.

---

## 14. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| RPC rolling 429 budget tightens; hourly run cannot finish | Medium | High | Measured envelope (50 @ 2.0 s) is ~4× below the observed ceiling; exponential backoff; `RPC_URL` repo variable for a fallback provider; a failed run commits nothing and the next run resumes |
| Batch support withdrawn | Low | High | `rpc.py` exposes `call_batch()` with a `MAX_BATCH=1` degraded mode; timestamps then cost ~12 min/run, still inside a 20 min timeout |
| Repo growth (~3 MB/day gzipped) | Certain | Medium | Daily gz rotation from day 1; v1.1 moves partitions >90 days to Releases |
| `recompute.py` slows as all-time grows | Medium | Medium | Currently ~1 s/day of data; at ~90 days it approaches 2 min. v1.1 adds a verified all-time checkpoint. Track it in CI wall-time |
| `next/og` under `output: 'export'` breaks the build | Medium | High | Avoided entirely — PNG is generated in a prebuild script |
| Vercel skips data-only commits (root dir `site/`) | Medium | High | Ignored Build Step explicitly cleared; post-deploy check that `/number.json` `crawledAt` matches the latest commit; deploy hook as fallback |
| Two workflow runs push concurrently | Low | Medium | `concurrency` group on crawl; `git pull --rebase` retry loop |
| A launch's enrichment fails and silently drops it from the headline rate | Low | High | `creatorTaxBps: null` still counts in the rate; only the tax cohort excludes it; `cohortsExcluded.tax` is published and rendered |
| Float drift breaks the byte-for-byte diff | Low | High | `round(x, 6)` before serialization, pinned Python 3.12, `allow_nan=False`, `.gitattributes -text` |
| Unclassified pair token distorts the pair cohort | Medium | Low | Everything unknown lands in `other`; class is re-resolved at recompute time so a reclassification commit fixes history without touching raw data |
| A definition changes and old numbers look wrong | Low | Medium | `definitionsVersion` + `schemaVersion` in the file; dated `/method` changelog entry required by CONSTRAINTS §9 |
