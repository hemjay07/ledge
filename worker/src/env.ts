/** Bindings and vars declared in wrangler.toml. */
export interface Env {
  LEDGE_DB: D1Database;
  LEDGE_KV: KVNamespace;
  FACTORY_ADDRESS: string;
  CHAIN_ID: string;
  RPC_URL: string;
  RPC_URL_FALLBACK?: string;
  NUMBER_JSON_URL: string;
  SITE_ORIGIN: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_HEADER_SECRET?: string;
}
