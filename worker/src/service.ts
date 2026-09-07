/* The lookup, assembled once and used by all four surfaces: the API, the
   /t shell, the death card and the Telegram bot. None of them builds a
   response of its own. */

import type { Env } from "./env";
import { RpcClient, RpcUnavailable } from "./rpc";
import { buildTokenBody, readIndex, readLaunchedToken } from "./lookup";
import { curveFill } from "./curve";
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

  const [{ launch, graduation, cursor }, numberFile, pairTokens] = await Promise.all([
    readIndex(env.LEDGE_DB, address),
    loadNumber(env, nowMs),
    loadPairTokens(env, nowMs),
  ]);

  let fill = null;
  try {
    // The launch's own curve, never a constant: from D1 if it is indexed,
    // otherwise straight from the factory view.
    fill = await curveFill(rpc, launch?.curve ?? onChain.curve, onChain.graduationThresholdWei);
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
    numberFile,
    pairTokens,
    fill,
    pairDecimals,
    siteOrigin: env.SITE_ORIGIN,
  });

  const observedMaxSeconds = numberFile?.allTime.ttg.max ?? null;
  const text = lookupText(body, observedMaxSeconds);
  const lastIndexedBlock = cursor?.last_indexed_block ?? null;

  const kind = !numberFile ? "number_unavailable" : launch === null ? "not_indexed" : "ok";
  return { kind, body, text, observedMaxSeconds, lastIndexedBlock };
}
