/** Bindings and vars declared in wrangler.toml. */
export interface Env {
  LEDGE_DB: D1Database;
  LEDGE_KV: KVNamespace;
  FACTORY_ADDRESS: string;
  CHAIN_ID: string;
  RPC_URL: string;
  RPC_URL_FALLBACK?: string;
  /** Shared key for the box's RPC relay (ops/rpc-proxy.mjs), sent as
      X-Ledge-Key when RPC_URL points at it. A secret, never a var. */
  RPC_PROXY_KEY?: string;
  NUMBER_JSON_URL: string;
  SITE_ORIGIN: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_HEADER_SECRET?: string;
  /** Where the graveyard's own bot post is sent. Absent means the tick finds
      new entries and records nothing posted -- it never falls back to
      replying into an inbound chat, which would send a stranger's DM a
      message they did not ask for. */
  TELEGRAM_GRAVEYARD_CHAT_ID?: string;
}
