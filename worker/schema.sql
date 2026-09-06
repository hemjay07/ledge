-- LEDGE live layer (ARCHITECTURE-PHASE2-4.md section 2).
--
-- D1 is canonical for nothing. The Python pipeline and the repo are canonical
-- for the Number. This database answers one question -- "what is true about
-- this token right now" -- and is disposable: wiping it costs at most a
-- re-index of the retention window.

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
-- Message text is never stored: only (chat_id, hour, count).
CREATE TABLE IF NOT EXISTS tg_usage (
  chat_id   TEXT NOT NULL,
  hour_key  INTEGER NOT NULL,                -- unix hour
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, hour_key)
);
