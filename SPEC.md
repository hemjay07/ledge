# PROJECT SPEC: LEDGE — Phase 1

**Generated:** 2026-09-06
**Type:** Static web app + scheduled data pipeline
**Build Time Estimate:** 6–7 working days (see PROGRESS.md plan)

Read with `CONSTRAINTS.md` (binding) and `METHOD.md` (binding definitions). `PONS_CONTRACTS.md` holds contract details and ABIs.

---

## 1. PROBLEM STATEMENT

**What problem does this solve?**
Pons (ponsfamily.com) launches ~19,000 tokens a day on Robinhood Chain. Nobody publishes what fraction graduate, how fast, or how much of that is pre-arranged. Every existing tool (GMGN, DexScreener, PonsScan) shows one token at a time. Numbers quoted in group chats are guesses.

**Who is this for?**
1. The person in a group chat who has to say "no" — the admin, the mod, the friend everyone DMs "is this one different?". They need one link that ends the argument without making them the villain.
2. Traders holding a Pons bag mid-launch deciding whether to keep waiting.
3. Launchers choosing pair token and creator tax before deploying.

**Why does this matter?**
Credibility is the product. A measured, denominated, hourly number that never lies becomes the citation ("the Pons Number is 2.3%"). The LEDGE token on Pons is patronage for that public instrument.

**Examples/Inspiration:**
Fear & Greed Index (one number, one page), Shiller PE (the citation, not the app), Etherscan gas tracker (distribution as presets), DefiLlama (embedded everywhere), Levels.fyi (neutral party), chit.tools-style free utility + patronage token.

---

## 2. SOLUTION OVERVIEW

**What does this do?**
Measures every Pons launch from the factory contract hourly and publishes the graduation rate, the rate excluding sub-5-minute graduations, the time-to-graduation distribution, and cohort rates — each with its sample size and timestamp — on a static site with a shareable card and a public JSON.

**What doesn't this do?** (out of scope for Phase 1)
Live per-token view, graduation clock, "machine that refuses" config lookup, on-chain oracle, cross-venue numbers, Telegram bot, weekly dispatch, death card, per-deployer pages, any ML, any always-on server, any social account.

**User flow:**
1. Visitor lands on `/` (from a pasted `/number` unfurl, a group chat, or X).
2. Sees the Pons Number (24h) and the excluding-fast figure side by side, both with n and "updated N min ago".
3. Scrolls: time-to-graduation bar; pair / tax / hour / deployer cohorts, each with n.
4. Optionally opens `/method` to see definitions and the recompute command, or `/cohorts` for the full tables.
5. Copies `ledge.tools/number` and pastes it; the unfurl carries the current figures and the URL.

---

## 3. TECHNICAL DECISIONS

### Tech stack
- **Data pipeline:** Python 3.12, stdlib `urllib` + `json` (no web3 dependency; reuse `crawl0.py` window/backoff logic and `keccak.py`). Runs on GitHub Actions hourly cron.
- **Storage:** the repo. `data/launches/*.jsonl`, `data/graduations/*.jsonl`, `data/number.json`, committed back by the Action. Files partitioned by day to keep diffs small.
- **Site:** Next.js (App Router) static export, TypeScript, Tailwind v4. Reads `data/number.json` at build time. Rebuilt on every data commit.
- **OG card:** generated at build with `@vercel/og`/satori into `/number/opengraph-image` (1200×630) with the URL rendered in the pixels.
- **JSON endpoint:** `/number.json` static file copied from `data/number.json` at build, served with `Cache-Control: public, max-age=300`.
- **Deployment:** Vercel (free), domain `ledge.tools`. Repo `hemjay07/ledge`, public.
- **Tests:** Python `pytest` for stats engine and crawler parsing; Vitest for the `<Stat>` component and JSON shape; Playwright smoke for pages.
- **CI gate:** `scripts/recompute.py` output must equal committed `number.json`; site build must succeed; NOT-THIS lint (grep for banned phrases) must pass.

### Why these choices
Zero always-on cost is a Phase 1 rule. GitHub Actions + repo-as-database gives hourly updates, a public dataset, and a full audit trail for free. Next.js static export fits the available UI agents and Vercel's free tier. Python stays because the crawler is already proven at 0 errors over 700 windows.

---

## 4. DATA & LOGIC

### Inputs (pipeline)
- Factory logs (`TokenLaunched`, `PoolGraduated`) from `lastIndexedBlock+1` to `head`, in ≤1,000-block windows, 0.9s pacing, retry/backoff on `Too Many Requests` and timeouts.
- `getLaunchedToken(token)` for each new launch → `creatorTaxBps`, `pairToken` confirm.
- Block timestamps for every block that carries a relevant event (batched).
- `symbol()` for any unseen pair token → appended to `data/pair-tokens.json` with a class (`eth`/`stable`/`stock`/`other`), initially `other` until classified in the repo.

### Core logic (stats engine, pure functions, no network)
- `window(launches, graduations, since, until)`
- `rate(window)` → `{ launches, graduations, rate }`
- `rate_excluding_fast(window, cutoff=300)` → `{ launches, graduations, rate, one_in }`
- `ttg_percentiles(window)` → p10/p25/p50/p75/p90/p95/max in seconds
- `cohort(window, key)` for `pairClass`, `taxBucket`, `hourUtc`, `dayUtc` → list of `{ bucket, launches, graduations, rate | null, insufficient: bool }`
- `deployers(window)` → `{ distinct, launched_2plus_share, launches_from_10plus_share, histogram }`
- `freshness(crawledAt, now)` → `{ age_seconds, stale }`
- All rates are `null` when n < 30; the renderer must handle `null`.

### Outputs
`data/number.json`:
```json
{
  "crawledAt": "2026-09-06T12:45:00Z",
  "headBlock": 0,
  "firstIndexedBlock": 0,
  "definitionsVersion": "2026-09-06",
  "h24": { "launches": 0, "graduations": 0, "rate": 0.0,
           "excludingFast": { "graduations": 0, "rate": 0.0, "oneIn": 0 },
           "ttg": { "p10": 0, "p25": 0, "p50": 0, "p75": 0, "p90": 0, "p95": 0, "max": 0 },
           "cohorts": { "pair": [], "tax": [], "hour": [], "day": [] },
           "deployers": { "distinct": 0, "launched2plusShare": 0.0, "from10plusShare": 0.0, "histogram": [] } },
  "allTime": { "...same shape..." }
}
```
Every cohort row: `{ "bucket": "stable", "launches": 0, "graduations": 0, "rate": null, "insufficient": true }`.

---

## 5. UI/UX DESIGN

### Pages
- `/` — the fold: Pons Number (24h) large; beside/below it the excluding-fast figure with "1 in N"; under both, one line: "of {launches} launches in the last 24 hours · updated {age} ago". Then: time-to-graduation bar with ticks at p50/p75/p90/p95 and the copy "9 in 10 graduations happened within {p90}". Then cohort blocks (pair, tax, hour, deployers) each with n. Then all-time figures, smaller. Footer: factory address, GitHub repo, `/method`, `/number.json`.
- `/cohorts` — full tables including day-of-week and the deployer histogram.
- `/method` — rendered from `METHOD.md`, plus the recompute command and the definitions changelog.
- `/number` — the card page: the two figures, n, age, and the URL; OG image at `/number/opengraph-image`. Meta tags for X and Telegram unfurl.
- `/number.json` — static JSON.

### States (per `state-design`)
- fresh (< 2h) · stale (≥ 2h: banner at top, age in red, card shows age) · insufficient (any cohort with n < 30) · crawl-failed (last run errored: same as stale, with "last successful run {time}").

### Layout / style
Instrument, not dashboard. Single column, ~65ch measure, one display face for the big figures and a body face; tabular numerals everywhere. Near-monochrome; the only colour is the stale state. Light and dark both designed. No cards-for-everything; hierarchy through type and rules. Mobile first — the fold must read at 390px width, and the `/number` OG card must be legible at Telegram thumbnail size.

### Design decisions still to be made in Step 3 (`/frontend-design` → `/design-forge` → `/logo-forge`)
Typeface pair, exact palette, the mark (shared by site and token), favicon.

### Accessibility
WCAG AA contrast, semantic headings, every figure has an accessible name including its denominator, `prefers-reduced-motion` respected (there is almost no motion).

---

## 6. FILE STRUCTURE

```
ledge/
├── SPEC.md  CONSTRAINTS.md  METHOD.md  PROGRESS.md  README.md
├── pipeline/
│   ├── crawl.py          # incremental crawler (windows, backoff, resume from data/state.json)
│   ├── enrich.py         # getLaunchedToken + block timestamps + pair symbol
│   ├── stats.py          # pure functions (see §4)
│   ├── recompute.py      # raw jsonl -> number.json, no network
│   ├── keccak.py
│   └── tests/            # pytest, fixtures from backfill-20h-2026-09-06.json
├── data/
│   ├── state.json        # lastIndexedBlock, lastRun, lastSuccess
│   ├── pair-tokens.json  # address -> {symbol, class}
│   ├── launches/YYYY-MM-DD.jsonl
│   ├── graduations/YYYY-MM-DD.jsonl
│   └── number.json
├── site/                 # Next.js static export
│   ├── app/  (page.tsx, cohorts/, method/, number/ + opengraph-image.tsx)
│   ├── components/Stat.tsx  DistributionBar.tsx  Cohort.tsx  StaleBanner.tsx
│   ├── lib/number.ts     # typed loader + formatters ("1 in 135", "9.0 min")
│   └── tests/
├── scripts/lint-copy.sh  # NOT-THIS grep
└── .github/workflows/
    ├── crawl.yml         # hourly: crawl -> enrich -> recompute -> commit
    ├── backfill.yml      # manual: N hours back
    └── ci.yml            # tests + recompute diff + copy lint + build
```

---

## 7. FEATURES & BEHAVIOR

### Must have (v1)
- [ ] Hourly incremental crawl with resume, zero-error tolerance logging, commit-back
- [ ] Block-timestamp accuracy (no block-count conversion)
- [ ] Creator tax + pair class enrichment
- [ ] `number.json` with 24h and all-time, all cohorts, all with n
- [ ] `/` fold per §5, distribution bar, cohorts, footer provenance
- [ ] `/method`, `/cohorts`, `/number` + OG image, `/number.json`
- [ ] Stale/insufficient/crawl-failed states
- [ ] CI recompute diff gate + copy lint
- [ ] Public repo with README that names the dataset and the recompute command
- [ ] Token assets: mark, 1024×1024 token image, name/ticker `LEDGE`, description for the Pons form

### Should have (v1.1)
- Embeddable badge (`/badge.svg`) for other tools
- Day-of-week cohort once 7 days of data exist
- RSS of the hourly number

### Won't have
See §2.

### Edge cases
| Scenario | Behaviour |
|---|---|
| Zero graduations in 24h | Rate renders 0.00% with n; excluding-fast renders "0 of n"; "1 in N" hidden |
| Cohort n < 30 | "not enough data (n=12)"; never a percentage |
| RPC rate limit mid-run | Backoff; if run cannot complete, no commit; state unchanged; next run resumes; site shows stale after 2h |
| Graduation for unknown token | Kept in raw file with `orphan: true`; excluded from all rates |
| Pair token with unknown symbol | Class `other`; appears in cohort as "other (unclassified)" |
| Reorg / duplicate event | Dedupe on `(txHash, logIndex)` |
| Definition change | New `definitionsVersion`, changelog entry, old number kept in history |
| Repo growth | Daily partitions; if a day file > 5 MB, gzip older partitions (later) |

---

## 8. ACCEPTANCE CRITERIA

### Functional
- Running `recompute.py` on the 20h backfill fixture yields: launches 23,552; graduations 535; fast (<300s) 361; rates equal to fixture values to 4 dp; p50/p75/p90 within the expected seconds once real timestamps are used.
- A cohort with n = 29 renders "not enough data"; n = 30 renders a rate.
- `crawledAt` 2h01m old → stale banner present; 1h59m → absent.
- `/number.json` validates against the schema in §4 and equals `data/number.json` byte-for-byte.
- `/number/opengraph-image` returns 1200×630 PNG containing the current rate text and "ledge.tools".
- Telegram and X unfurl previews render the card (manual check).
- `scripts/lint-copy.sh` fails on any NOT-THIS phrase.
- Two consecutive crawl runs with no new blocks produce no commit.

### Quality
- [ ] Lighthouse ≥ 95 performance/accessibility on `/` mobile
- [ ] No console errors
- [ ] Fold readable at 390px
- [ ] Light and dark verified
- [ ] Every rendered number traceable to a `number.json` field with n

---

## 9. CONTENT & COPY

- **Title:** LEDGE
- **Fold:** `{rate}%` — "of {n} Pons launches in the last 24 hours graduated" · `{rateExFast}%` — "excluding launches that graduated inside 5 minutes · 1 in {oneIn}" · "updated {age} ago"
- **Distribution:** "9 in 10 graduations happened within {p90}. Median {p50}."
- **Fast-graduation note (one line, near the fold):** "{fastShare}% of graduations completed inside 5 minutes; {sub60Share}% inside 60 seconds."
- **Cohort headers:** "By pair token", "By creator tax", "By hour (UTC)", "Deployers"
- **Insufficient:** "not enough data (n={n})"
- **Stale banner:** "This number is {age} old. Last successful measurement {time}."
- **Footer:** "Measured from PonsV2LaunchFactory {addr} · Data and code: github.com/hemjay07/ledge · Method · number.json"
- **Method page disclaimer (once):** "These are counts of past launches. They describe the population, not any token. LEDGE does not score, rank, or predict individual tokens."
- **Token description (Pons form, ≤ 200 chars):** "The Pons Number. Real graduation odds measured from every Pons launch, hourly, with the pre-arranged share stripped out. Free at ledge.tools."

---

## 10. DEPLOYMENT

- **Platform:** Vercel, project `ledge`, root `site/`, static export
- **Domain:** ledge.tools (user registers; DNS to Vercel)
- **Repo:** github.com/hemjay07/ledge (public), account `hemjay07`
- **Secrets:** none required. Actions uses `GITHUB_TOKEN` to commit. Optional `RPC_URL` variable for a fallback RPC.
- **Post-deploy checks:** live URL, `/number.json` reachable, OG unfurl in Telegram, first hourly run committed and redeployed, stale banner absent.

---

## 11. BUILD EXECUTION CHECKLIST

- [ ] Step 1 — architect: `ARCHITECTURE.md` from this spec (decisions: batch RPC for timestamps, partition strategy, build trigger, schema)
- [ ] Step 2 — stats engine + crawler, TDD against the backfill fixture; Actions workflows
- [ ] Step 3 — design: `/frontend-design` → `/design-forge` → `/logo-forge` → `/state-design`
- [ ] Step 4 — site build via `ui-frontend-craftsman`; `code-reviewer` with CONSTRAINTS.md as rubric
- [ ] Step 5 — `/hackathon-debug`, `/hackathon-livetest` V2, `/hackathon-interrogate` QUICK, `/ui-revamp`
- [ ] Step 6 — repo public, domain, Vercel, first hourly run, `/hackathon-verify` preflight
- [ ] Step 7 — launch kit: token image, form copy, first card post, pitch to friend

**This spec is complete for Phase 1. Design choices in §5 are delegated to Step 3; everything else is decided.**

---

## 12. NOTES & CONSIDERATIONS

**Known risks → mitigations**
- Wrong number gets pasted → CI recompute diff; stale banner; n on everything; definitions changelog.
- Looks like every other crypto tool → CONSTRAINTS design posture; copy lint; interrogate persona "the degen who closes tabs".
- Nobody shares it → `/number` unfurl is a first-class deliverable with its own acceptance test.
- RPC throttling grows with adoption of the chain → windows + backoff proven; fallback RPC variable; run may take up to 40 min and still be hourly.
- Repo bloat from ~19k lines/day → daily partitions now; gzip/rotate in v1.1.
- Goodhart on the 5-minute cutoff → descriptive only; Phase 2 adds first-block buyer concentration.

**Dependencies:** Robinhood Chain public RPC; GitHub Actions free minutes (hourly ~15–40 min runs ≈ 360–960 min/month, within the 2,000-minute free tier for public repos — public repos are unlimited); Vercel free tier.

**Future (Phase 2+):** live view + graduation clock, config → cohort lookup ("machine that refuses"), on-chain oracle, open dataset mirror, cross-venue numbers, Telegram bot, death card.

**Success metrics:** the `/number` URL appearing in posts we didn't write; hourly runs with zero failed commits for 30 days; recompute diff never fails in production.

## VERSION HISTORY
- 2026-09-06: initial spec from interview
