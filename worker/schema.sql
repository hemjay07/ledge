-- LEDGE live layer (ARCHITECTURE-PHASE2-4.md section 2).
--
-- D1 is canonical for nothing. The Python pipeline and the repo are canonical
-- for the Number. This database answers one question -- "what is true about
-- this token right now" -- and is disposable: wiping it costs at most a
-- re-index of the retention window.
--
-- MIGRATION NOTE (B6). `launch` and `graduation` were keyed on `token`. That
-- is the wrong claim: it says a token can be launched once and graduate once,
-- for ever. ARCHITECTURE.md section 5 is binding on both indexers -- "Dedupe
-- is on (txHash, logIndex) only -- never on token address, because a token can
-- in principle appear twice and because a reorg replay produces identical
-- keys" -- and under a reorg the token key was not merely redundant, it was
-- load-bearing in the wrong direction: INSERT OR IGNORE kept the row the chain
-- had just discarded, so /api/token served `graduated: true` for a graduation
-- that never happened and a re-mined launch kept its old block and timestamp.
--
-- The key is now the log's own identity, `(tx_hash, log_index)`, with `token`
-- indexed and NOT unique, and the tick deletes rows in the re-read range that
-- the fresh logs no longer contain. D1 has not been deployed, so this DDL is
-- replaced in place rather than migrated. Were it already live, the migration
-- would be: create the table anew under a temporary name, copy every row into
-- it, drop the old table, rename -- SQLite cannot alter a primary key -- and
-- then let one tick's overlap re-read reconcile the range it covers. Wiping
-- the database and letting the indexer refill the retention window is also a
-- correct migration here, and a cheaper one, because D1 is canonical for
-- nothing.

-- One row per TokenLaunched seen by the minute indexer, keyed on the log.
CREATE TABLE IF NOT EXISTS launch (
  token                TEXT NOT NULL,        -- lowercase 0x address, indexed, NOT unique
  curve                TEXT NOT NULL,
  pair_token           TEXT NOT NULL,
  pair_class           TEXT NOT NULL,        -- eth | stable | stock | other
  creator_tax_bps      INTEGER,              -- NULL when enrichment failed
  -- graduationThreshold, word 5 of the 15-word getLaunchedToken tuple
  -- (REPOSITION.md B1). Free: the same factory-view call that reads
  -- creator_tax_bps already returns this word, so it is stored alongside it
  -- rather than fetched again. TEXT, not INTEGER: a uint256 does not fit a
  -- SQLite INTEGER (worker/src/activity.ts carries the same reasoning for
  -- the quote sums). NULL exactly when creator_tax_bps is NULL -- the
  -- enrichment call that would have supplied both did not answer.
  graduation_threshold TEXT,
  block                INTEGER NOT NULL,
  ts              INTEGER NOT NULL,          -- block header timestamp, seconds
  tx_hash         TEXT NOT NULL,
  log_index       INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS launch_token_idx ON launch (token);
-- The curve index (REPOSITION.md "What has to be built"). Curves are deployed
-- per launch, so a CurveBuy/CurveSell log names its curve and nothing else,
-- and the token it belongs to is whatever launch deployed that curve. That
-- mapping is already here, in `launch.curve`, recorded free at launch time
-- from the TokenLaunched topics -- it wanted only an index to be usable as a
-- lookup. A second table holding the same pair would need its own retention
-- rule and could fall out of step with this one; an index cannot.
CREATE INDEX IF NOT EXISTS launch_curve_idx ON launch (curve);
CREATE INDEX IF NOT EXISTS launch_block_idx ON launch (block DESC);
CREATE INDEX IF NOT EXISTS launch_ts_idx    ON launch (ts DESC);

-- One row per PoolGraduated. token is NOT a foreign key: a graduation can
-- arrive for a launch outside the retention window, and it must still be
-- recorded rather than silently dropped.
CREATE TABLE IF NOT EXISTS graduation (
  token             TEXT NOT NULL,           -- indexed, NOT unique
  block             INTEGER NOT NULL,
  ts                INTEGER NOT NULL,
  pair_token_amount TEXT NOT NULL,           -- raw uint256 as decimal string
  tx_hash           TEXT NOT NULL,
  log_index         INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS graduation_token_idx ON graduation (token);
CREATE INDEX IF NOT EXISTS graduation_block_idx ON graduation (block DESC);
-- Retention deletes a launch only when no graduation still references it
-- (W2), which is a lookup by token on every eviction pass.
CREATE INDEX IF NOT EXISTS graduation_ts_idx    ON graduation (ts DESC);

-- Per-token curve activity, folded. Never the events themselves: CurveBuy and
-- CurveSell run at ~564 a minute (~812,000 a day) across every live curve,
-- which as rows would not fit the plan, while only ~121 distinct curves see
-- any activity in a five-minute window -- so this table is bounded by the
-- number of live curves and not by the number of trades.
--
-- Class B throughout: counts and block-header timestamps about one token,
-- with no denominator because there is no population. No rate is computed
-- from them here or anywhere else in the Worker.
--
-- The quote sums are TEXT because a uint256 does not fit a SQLite INTEGER
-- (2^63 wei is 9.2 ETH, and a curve sees more than that over its life); they
-- are added as BigInt in worker/src/activity.ts.
--
-- first_block_buyers is the coordination reading: distinct addresses that
-- bought in the launch's own block, which costs gas and snipe tax to fake.
-- It needs no (token, buyer) table -- see the note at the top of
-- worker/src/activity.ts for why a block is never split across ticks.
--
-- reserve_wei / reserve_block hold the curve's OWN realQuoteReserve(), read
-- straight off the curve rather than netted from indexed CurveBuy/CurveSell
-- logs (worker/src/board.ts carried the indexed figure alone until
-- 2026-09-12, and it was wrong by orders of magnitude on wash-traded curves
-- because it never sees fee or creator tax leaving quote_in before the
-- curve's reserve does). reserve_block is the block that reading was taken
-- at, so a reader can see its age against the tick that wrote it. NULL in
-- either column means this token has never been read this way -- not zero,
-- which is a real, distinct reading a drained or graduated curve can give.
-- Filled by worker/src/reserve.ts, one Multicall3 aggregate3() call a tick
-- covering the whole board population, never a per-curve RPC call.
CREATE TABLE IF NOT EXISTS token_activity (
  token              TEXT PRIMARY KEY,       -- lowercase 0x address
  from_block         INTEGER NOT NULL,       -- the launch block: where these counts open
  buys               INTEGER NOT NULL DEFAULT 0,
  sells              INTEGER NOT NULL DEFAULT 0,
  quote_in           TEXT NOT NULL DEFAULT '0',
  quote_out          TEXT NOT NULL DEFAULT '0',
  first_buy_ts       INTEGER,                -- NULL until a buy is seen
  last_activity_ts   INTEGER NOT NULL,       -- block header, never a wall clock
  first_block_buyers INTEGER,                -- NULL when the launch block was never read
  reserve_wei        TEXT,                   -- realQuoteReserve() from the curve, NULL = never read
  reserve_block      INTEGER                 -- the block reserve_wei was read at, NULL = never read
);
-- Retention prunes on the row's own last event, exactly as the other tables do.
CREATE INDEX IF NOT EXISTS token_activity_ts_idx ON token_activity (last_activity_ts DESC);

-- MIGRATION (2026-09-12). worker/schema.sql has, until now, been edited in
-- place and replaced wholesale on every change (see the B6 migration note
-- above) because D1 had not been deployed yet. It now holds live data, so
-- the two columns above are also stated as an explicit migration: run this
-- by hand against the deployed database (this repo runs no migration
-- tooling and no `wrangler d1 execute` from an agent -- a human runs this).
-- Both are nullable and additive; no existing row's other columns change and
-- every existing row reads reserve_wei/reserve_block as NULL ("never read")
-- until the next tick's reserve pass writes them.
--
--   ALTER TABLE token_activity ADD COLUMN reserve_wei TEXT;
--   ALTER TABLE token_activity ADD COLUMN reserve_block INTEGER;

-- Curve logs LEDGE could not attribute: the curve belongs to a launch older
-- than the indexed record, or to one that has been evicted. Counted rather
-- than dropped, so the size of what the index cannot see is itself readable
-- (on /api/health). A single row, like the cursor.
CREATE TABLE IF NOT EXISTS activity_unattributed (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  logs         INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER
);

-- The graveyard: launches already announced as having taken zero buys past
-- the age threshold (worker/src/graveyard.ts). Keyed on the token alone -- a
-- launch enters the graveyard once, the first time it is observed there, and
-- is never posted a second time even though it stays in the SELECT that
-- finds candidates for as long as its activity row survives retention.
CREATE TABLE IF NOT EXISTS graveyard_posted (
  token      TEXT PRIMARY KEY,
  posted_at  INTEGER NOT NULL
);

-- Single-row cursor. Mirrors data/state.json in spirit, never in authority.
-- `skipped_from`/`skipped_to` record a range the indexer jumped rather than
-- indexed, which happens when it falls further behind than catching up could
-- ever close (tick.ts MAX_RECOVERABLE_GAP). Recorded rather than passed over
-- in silence: the repo's own record covers the range, and a live layer that
-- quietly has a hole in it is worse than one that says where the hole is.
CREATE TABLE IF NOT EXISTS cursor (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  last_indexed_block    INTEGER NOT NULL,
  last_tick_at          INTEGER NOT NULL,
  last_success_at       INTEGER NOT NULL,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  last_error            TEXT,
  skipped_from          INTEGER,
  skipped_to            INTEGER
);

-- Telegram abuse counters. Bucketed by hour so eviction is a range delete.
-- Message text is never stored: only (chat_id, hour, count).
CREATE TABLE IF NOT EXISTS tg_usage (
  chat_id   TEXT NOT NULL,
  hour_key  INTEGER NOT NULL,                -- unix hour
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, hour_key)
);

-- Pair-token decimals/symbol, read once per address and cached for ever
-- (2026-09-12). worker/src/board.ts's pairUnits() resolved units ONLY from
-- the static registry map sourced from data/pair-tokens.json/KV, so a real
-- pair token outside that registry -- any tokenized-stock pair the Python
-- pipeline has not enriched yet -- got pairDecimals: null and the board
-- printed the raw uint256. This table is that gap closed on the live side:
-- worker/src/reserve.ts reads decimals()/symbol() for every pair token among
-- the tick's reserve targets that is not the zero address (ETH is defined as
-- 18/"ETH" by the factory and is never called for) and is not already a row
-- here, in the SAME Multicall3 aggregate3() call the reserve read already
-- makes -- one subrequest total, never a second eth_call.
--
-- A row existing means the read was ATTEMPTED, not that it succeeded:
-- decimals/symbol are independently nullable because aggregate3's
-- allowFailure lets one sub-call fail without blanking the other, and a
-- symbol that decodes as a raw bytes32 or invalid UTF-8 (rather than the
-- ABI-encoded dynamic string most ERC-20s return) is stored as NULL rather
-- than guessed at. board.ts's pairUnits() therefore checks this table FIRST:
-- a row here is used exactly as read (decimals: NULL stays NULL, never
-- falling back to the registry map's guess) and only a genuine table MISS
-- falls back to the registry, then to null. read_block records the tick's
-- head block the read was taken at, for parity with reserve_block.
CREATE TABLE IF NOT EXISTS pair_token (
  address     TEXT PRIMARY KEY,     -- lowercase 0x address
  decimals    INTEGER,              -- NULL when decimals() failed or was implausible
  symbol      TEXT,                 -- NULL when symbol() failed or did not decode as a string
  read_block  INTEGER
);

-- MIGRATION (2026-09-12). Additive and nullable, same posture as the
-- reserve_wei/reserve_block migration above: run this by hand against the
-- deployed database (no `wrangler d1 execute` from an agent -- a human runs
-- this). No existing table is touched.
--
--   CREATE TABLE IF NOT EXISTS pair_token (
--     address     TEXT PRIMARY KEY,
--     decimals    INTEGER,
--     symbol      TEXT,
--     read_block  INTEGER
--   );
