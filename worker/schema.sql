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
  token           TEXT NOT NULL,             -- lowercase 0x address, indexed, NOT unique
  curve           TEXT NOT NULL,
  pair_token      TEXT NOT NULL,
  pair_class      TEXT NOT NULL,             -- eth | stable | stock | other
  creator_tax_bps INTEGER,                   -- NULL when enrichment failed
  block           INTEGER NOT NULL,
  ts              INTEGER NOT NULL,          -- block header timestamp, seconds
  tx_hash         TEXT NOT NULL,
  log_index       INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS launch_token_idx ON launch (token);
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
-- Message text is never stored: only (chat_id, hour, count).
CREATE TABLE IF NOT EXISTS tg_usage (
  chat_id   TEXT NOT NULL,
  hour_key  INTEGER NOT NULL,                -- unix hour
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, hour_key)
);
