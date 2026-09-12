/* The lookup, assembled once and used by all four surfaces: the API, the
   /t shell, the death card and the Telegram bot. None of them builds a
   response of its own. */

import type { Env } from "./env";
import { RpcClient, RpcUnavailable } from "./rpc";
import { buildTokenBody, readIndex, readLaunchedToken, type TokenMetaRow } from "./lookup";
import { curveFill, curveFillAndTokenMeta } from "./curve";
import { loadNumber, loadPairTokens } from "./numberFile";
import { resolveDecimals } from "./decimals";
import { lookupText } from "./text";
import type { TokenResponse } from "./schema";

export type LookupOutcome =
  | { kind: "ok" | "not_indexed" | "number_unavailable"; body: Omit<TokenResponse, "text">; text: string; observedMaxSeconds: number | null; lastIndexedBlock: number | null }
  | { kind: "not_a_pons_token" }
  | { kind: "rpc_down" };

export async function lookupToken(
  env: Env,
  address: string,
  nowMs = Date.now(),
): Promise<LookupOutcome> {
  const nowSeconds = Math.floor(nowMs / 1000);
  const factory = env.FACTORY_ADDRESS.toLowerCase();
  const rpc = new RpcClient(env.RPC_URL, undefined, env.RPC_URL_FALLBACK);

  let onChain;
  try {
    onChain = await readLaunchedToken(rpc, factory, address);
  } catch (error) {
    if (error instanceof RpcUnavailable) return { kind: "rpc_down" };
    throw error;
  }
  if (!onChain || !onChain.exists) return { kind: "not_a_pons_token" };

  const [{ launch, graduation, cursor, activity, tokenMeta: cachedTokenMeta }, numberFile, pairTokens] =
    await Promise.all([
      readIndex(env.LEDGE_DB, address),
      loadNumber(env, nowMs),
      loadPairTokens(env, nowMs),
    ]);

  let fill = null;
  let tokenMeta: TokenMetaRow | null = cachedTokenMeta;
  try {
    // The launch's own curve, never a constant: from D1 if it is indexed,
    // otherwise straight from the factory view.
    const curve = launch?.curve ?? onChain.curve;
    if (cachedTokenMeta === null) {
      /* No `token_meta` row yet: read name()/symbol() in the SAME batched
         call the fill already spends, rather than a second eth_call, and
         cache what came back so the next lookup or tick never re-reads it
         (worker/schema.sql's `token_meta` table, "never re-read a token once
         it has a row"). read_block is left NULL: this call is pinned to
         "latest", not a named block, and finding the exact block it resolved
         to would cost a second eth_call this path does not have room for. */
      const combined = await curveFillAndTokenMeta(rpc, curve, onChain.graduationThresholdWei, address);
      fill = combined.fill;
      tokenMeta = { name: combined.name, symbol: combined.symbol };
      try {
        await env.LEDGE_DB.prepare(
          "INSERT OR IGNORE INTO token_meta (address, name, symbol, read_block) VALUES (?, ?, ?, ?)",
        )
          .bind(address.toLowerCase(), combined.name, combined.symbol, null)
          .run();
      } catch {
        // A cache that cannot be written costs one more call next time,
        // nothing more -- the lookup itself already has its answer.
      }
    } else {
      fill = await curveFill(rpc, curve, onChain.graduationThresholdWei);
    }
  } catch {
    fill = null; // an unreadable fill is reported as unavailable, never as zero
  }

  const pairToken = launch?.pair_token ?? onChain.pairToken;
  let pairDecimals: number | null = null;
  try {
    pairDecimals = await resolveDecimals(env, rpc, pairToken, pairTokens);
  } catch {
    pairDecimals = null; // unknown units are said aloud, never assumed
  }

  const body = buildTokenBody({
    address,
    nowSeconds,
    onChain,
    launch,
    graduation,
    cursor,
    activity,
    numberFile,
    pairTokens,
    fill,
    pairDecimals,
    tokenMeta,
    siteOrigin: env.SITE_ORIGIN,
  });

  const observedMaxSeconds = numberFile?.allTime.ttg.max ?? null;
  const text = lookupText(body, observedMaxSeconds);
  const lastIndexedBlock = cursor?.last_indexed_block ?? null;

  const kind = !numberFile ? "number_unavailable" : launch === null ? "not_indexed" : "ok";
  return { kind, body, text, observedMaxSeconds, lastIndexedBlock };
}
