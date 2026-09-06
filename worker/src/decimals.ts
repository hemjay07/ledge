/* How many decimal places a pair token carries.

   A quantity of a token is only readable in that token's own units: 8090000000
   is 8,090 USDG, and 4200000000000000000 is 4.2 ETH, and neither is legible as
   the integer. Converting between them is a unit conversion on one observed
   quantity — not a rate, not a share, not a statistic — so it is allowed, and
   it happens in format.ts alongside the other formatting rules.

   What is NOT allowed is guessing the exponent. A wrong `decimals` moves a
   figure by orders of magnitude, so this resolves it in a fixed order and
   returns null rather than assuming 18:

     1. the zero address is ETH at 18, by the factory's own definition
     2. `decimals` in data/pair-tokens.json, if the pipeline ever writes it
     3. a value already read and cached in KV
     4. one `decimals()` call, cached in KV without expiry — the number of
        decimals a deployed ERC-20 reports does not change
     5. null, and the caller then prints the raw integer and says the units
        are not known

   Pons pairs against 55 tokens today, so step 4 runs at most 55 times ever. */

import type { Env } from "./env";
import type { RpcClient } from "./rpc";
import type { PairTokenEntry } from "./buckets";

export const SELECTOR_DECIMALS = "0x313ce567";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ETH_DECIMALS = 18;

export function kvDecimalsKey(address: string): string {
  return `token-decimals:${address.toLowerCase()}`;
}

/** ERC-20 `decimals` is a uint8. Anything outside 0-36 is not a decimals
    reading, whatever the contract returned. */
function plausible(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 36;
}

export async function resolveDecimals(
  env: Env,
  rpc: RpcClient,
  pairToken: string,
  pairTokens: Record<string, PairTokenEntry> | null,
): Promise<number | null> {
  const address = pairToken.toLowerCase();
  if (address === ZERO_ADDRESS) return ETH_DECIMALS;

  const fromMap = (pairTokens?.[address] as { decimals?: number } | undefined)?.decimals;
  if (typeof fromMap === "number" && plausible(fromMap)) return fromMap;

  try {
    const cached = await env.LEDGE_KV.get(kvDecimalsKey(address), "text");
    if (cached !== null) {
      const value = Number(cached);
      if (plausible(value)) return value;
    }
  } catch {
    // KV unavailable: fall through to the chain, and print the raw integer
    // if that fails too.
  }

  let value: number;
  try {
    const returned = await rpc.ethCall(address, SELECTOR_DECIMALS);
    if (typeof returned !== "string" || returned.length < 66) return null;
    value = Number(BigInt(returned.slice(0, 66)));
  } catch {
    return null;
  }
  if (!plausible(value)) return null;

  try {
    await env.LEDGE_KV.put(kvDecimalsKey(address), String(value));
  } catch {
    // A cache that cannot be written costs one call next time, nothing more.
  }
  return value;
}

/** The pair token's ticker, from the repo's own map (enrich.py read it from
    the contract). Null when the map has never seen this token, and the
    sentence then names the amount without a symbol rather than inventing one. */
export function pairSymbolOf(
  pairToken: string,
  pairTokens: Record<string, PairTokenEntry> | null,
): string | null {
  const address = pairToken.toLowerCase();
  if (address === ZERO_ADDRESS) return "ETH";
  return pairTokens?.[address]?.symbol ?? null;
}
