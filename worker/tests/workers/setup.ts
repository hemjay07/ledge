import { env } from "cloudflare:test";
import numberFixture from "../fixtures/number.json";
import pairTokens from "../fixtures/pair-tokens.json";
import { KV_NUMBER, KV_PAIR_TOKENS, resetNumberCache } from "../../src/numberFile";
// The DDL that ships, read verbatim -- not a paraphrase that could drift.
import SCHEMA_SQL from "../../schema.sql?raw";

/* schema.sql is applied verbatim so the tests run against the DDL that ships,
   not a paraphrase of it. */
export async function applySchema(): Promise<void> {
  const statements = SCHEMA_SQL.split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await env.LEDGE_DB.prepare(statement).run();
  }
}

export async function reset(): Promise<void> {
  await applySchema();
  await env.LEDGE_DB.batch([
    env.LEDGE_DB.prepare("DELETE FROM launch"),
    env.LEDGE_DB.prepare("DELETE FROM graduation"),
    env.LEDGE_DB.prepare("DELETE FROM cursor"),
    env.LEDGE_DB.prepare("DELETE FROM token_activity"),
    env.LEDGE_DB.prepare("DELETE FROM activity_unattributed"),
    env.LEDGE_DB.prepare("DELETE FROM tg_usage"),
    env.LEDGE_DB.prepare("DELETE FROM graveyard_posted"),
  ]);
  await env.LEDGE_KV.put(KV_NUMBER, JSON.stringify(numberFixture));
  await env.LEDGE_KV.put(KV_PAIR_TOKENS, JSON.stringify(pairTokens));
  resetNumberCache();
}

export async function seedCursor(block: number, nowSeconds: number): Promise<void> {
  await env.LEDGE_DB.prepare(
    `INSERT OR REPLACE INTO cursor (id, last_indexed_block, last_tick_at, last_success_at, consecutive_failures, last_error)
     VALUES (1, ?, ?, ?, 0, NULL)`,
  )
    .bind(block, nowSeconds, nowSeconds)
    .run();
}
