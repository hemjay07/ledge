# The per-token first-buy line on /t/{address} — brief, 2026-09-14

MOAT.md §3: the one thing that turns the first-buy finding into a product.
A launcher pastes their address and reads, on their own token's page, when
its first outside buy landed and how launches like it fared. Read first:
design/FIRSTBUY-BRIEF.md (the definitions; they are binding here),
METHOD.md's 2026-09-13 first-buy entry, CONSTRAINTS.md, worker/src/
activity.ts, tick.ts (resolveCurves, the token_activity INSERT), lookup.ts
(buildTokenBody, outcomesFor, ttgBucketOf), text.ts (activitySentences),
html.ts (buyersCard, outcomesCard), schema.ts, site/lib/api-schema.ts (the
parity test), worker/schema.sql (the MIGRATION note at token_activity).

## Definitions (unchanged from the record; the Worker observes, never computes a statistic)

For a launch the index holds:
- **launch-tx buy**: a `CurveBuy` on the launch's curve whose `txHash`
  equals the launch's own `tx_hash` (worker/schema.sql `launch.tx_hash`).
- **first outside buy**: the earliest `CurveBuy` on that curve, by
  (block, logIndex), whose `txHash` differs from the launch's.
- **delay**: `ts(first outside buy block) − ts(launch block)`, whole
  seconds from block headers; **same block** is a block fact and is stated
  as such (delay is then 0 but the sentence says "in the launch block").

The Worker records these as observations about one token (Class B). The
shares it prints beside them come from `number.json`'s `firstBuy` block
(Class A, pipeline/stats.py), for the token's own creator-tax band — never
computed here. `scripts/lint-worker.sh` must stay clean.

## Data (worker/schema.sql, migration by hand — a human runs it)

Three nullable, additive columns on `token_activity`:

    ALTER TABLE token_activity ADD COLUMN launch_tx_buy INTEGER;          -- 1 seen, 0 not seen while the launch block was read, NULL launch block never read
    ALTER TABLE token_activity ADD COLUMN first_outside_buy_block INTEGER; -- NULL until seen
    ALTER TABLE token_activity ADD COLUMN first_outside_buy_ts INTEGER;    -- block header of that block

Add them to the CREATE TABLE and to the MIGRATION comment in the style of
the 2026-09-12 note. Do not run `wrangler d1 execute`.

## Tick (activity.ts, tick.ts)

- `resolveCurves` also returns `launchTxOf: Map<token, tx_hash>` (from the
  launch rows it already reads).
- `group()` keeps, per token, the earliest buy whose txHash ≠ launch tx
  (block, logIndex) and whether any buy shares the launch tx. Trades carry
  `txHash` and `logIndex` already (pons.ts CurveTradeLog).
- `activityBlocks` adds the first-outside-buy block to the header batch
  only when the existing row has none.
- `planActivity` sets `launch_tx_buy` when the launch block was read this
  pass (the same condition as `first_block_buyers`), `first_outside_buy_*`
  once and never again (like `first_buy_ts`). Existing rows without the
  columns read as null and are filled by later passes.
- The `INSERT OR REPLACE` lists the three columns; `SELECT *` already
  carries them back.

## Response (lookup.ts, schema.ts, site/lib/api-schema.ts)

`activity` gains:

    launchTxBuy: boolean | null,
    firstOutsideBuy: { block, at (ISO), delaySeconds, inLaunchBlock: boolean } | null

and a top-level optional `firstBuy` beside `outcomes`:

    firstBuy: { cohort: { bucket: taxBucket, n, within1sShare, within5sShare, noneShare, insufficient } } | null

built by a new `firstBuyFor(numberFile, taxBucket)` in lookup.ts that only
looks the row up (pattern: `outcomesFor`); null when the file has no
`firstBuy` block or the band is unknown. Keep the two schema files in
parity (the parity test will tell you).

## Words (text.ts, html.ts)

- `activitySentences` gains one line, past tense, no verdict:
  "First outside buy: in the launch block." / "First outside buy: 0.4 s
  after the launch block." / "No outside buy recorded." and, when
  `launchTxBuy` is known, "The launch transaction carried its own opening
  buy." / "...carried no opening buy."
- A new card on the /t page, after `buyersCard`: kicker "First outside
  buy", the figure (the delay, or "in the launch block", or "none
  recorded"), and a note from the cohort row: "Of N launches with a
  {taxLabel} creator tax, X% took their first outside buy within 1 s and
  Y% within 5 s; Z% none within an hour." Through `rateText`, so below
  n = 30 it prints "not enough data (n=…)" and nothing else. Shape and
  classes as `outcomesCard`.
- Nothing predicts, scores or names a buyer.

## Tests (red first; show both runs)

- activity.test.ts: launch-tx buy detected by txHash equality; first
  outside buy is the earliest by (block, logIndex) and excludes the launch
  tx; set once; header block requested only when unknown; null when the
  launch block was never read.
- lookup.test.ts: `firstBuyFor` returns the band's row; null without the
  block; `firstOutsideBuy.inLaunchBlock` true when block == from_block.
- text.test.ts / html.test.ts: the sentences and the card, including the
  n<30 case and the no-buy case; no banned word (lint.test.ts covers).
- schema parity, vectors, `npm run typecheck`, `npm test` (both halves),
  `scripts/lint-worker.sh`, `scripts/lint-copy.sh` clean.

## Out of scope

Deploying (owner), the migration (owner), the site's static pages, the
pipeline.
