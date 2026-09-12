/* ERC-20 name()/symbol() for the launched TOKEN itself (2026-09-12).

   Distinct from worker/src/reserve.ts's `pair_token` cache: `pair_token`
   caches decimals()/symbol() for the PAIR a curve trades against (ETH, USDG,
   ...). This module -- and worker/schema.sql's `token_meta` table it feeds --
   is about the token a board or graveyard row is itself about, which until
   now showed only its raw address.

   Selectors, the ABI-string decode and the trim/NULL rules live here once so
   the tick's population read (worker/src/reserve.ts, worker/src/tick.ts) and
   the single-token live read on a lookup miss (worker/src/curve.ts,
   worker/src/service.ts) write the same shape into `token_meta`, rather than
   each re-deriving its own rules. */

export const SELECTOR_NAME = "0x06fdde03";
export const SELECTOR_SYMBOL_TOKEN = "0x95d89b41";

const WORD = 64; // hex characters in one 32-byte ABI word
const NAME_MAX_CHARS = 64;
const SYMBOL_MAX_CHARS = 16;
/** A length claim past this is not a name or a symbol either -- refusing to
    loop over it is the same "no guess" posture reserve.ts's own 256-byte cap
    on a pair token's symbol() carries, just wider: a display name runs
    longer than a ticker. */
const MAX_DECODE_LENGTH = 4096;

export interface TokenMetaReading {
  address: string;
  /** ERC-20 name(), decoded as the ABI dynamic `string` most tokens return,
      trimmed to 64 characters with control characters (0x00-0x1F, 0x7F)
      stripped. Null when the call failed, the return was a raw bytes32
      rather than a dynamic string, or the bytes were not valid UTF-8. */
  name: string | null;
  /** Same rule, 16 characters, for ERC-20 symbol(). */
  symbol: string | null;
}

/** Strips 0x00-0x1F and 0x7F. No other sanitization -- HTML-escaping is
    html.ts's job at render time, not this module's. */
function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1F\x7F]/g, "");
}

/** Decodes the ABI dynamic `string` layout (offset word, length word, UTF-8
    bytes) name()/symbol() are specified to return. Null whenever:
      - the raw return is one word (32 bytes) or shorter -- too short to hold
        even the offset+length head a dynamic string needs, which is exactly
        the shape a raw bytes32 answer has, so it is never attempted as text;
      - the offset/length do not describe data the return actually holds, or
        claim an implausible length;
      - the decoded bytes are not valid UTF-8.
    A zero-length string decodes to "" -- a real answer, not a failure. */
function decodeAbiString(dataHex: string): string | null {
  if (dataHex.length <= WORD) return null;
  try {
    const offsetBytes = Number(BigInt("0x" + dataHex.slice(0, WORD))) * 2;
    if (offsetBytes < 0 || dataHex.length < offsetBytes + WORD) return null;
    const length = Number(BigInt("0x" + dataHex.slice(offsetBytes, offsetBytes + WORD)));
    if (!Number.isInteger(length) || length < 0 || length > MAX_DECODE_LENGTH) return null;
    const strStart = offsetBytes + WORD;
    const strHexLen = length * 2;
    if (dataHex.length < strStart + strHexLen) return null;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = parseInt(dataHex.slice(strStart + i * 2, strStart + i * 2 + 2), 16);
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeField(dataHex: string, maxChars: number): string | null {
  const decoded = decodeAbiString(dataHex);
  if (decoded === null) return null;
  return stripControlChars(decoded).slice(0, maxChars);
}

export function decodeTokenName(dataHex: string): string | null {
  return decodeField(dataHex, NAME_MAX_CHARS);
}

export function decodeTokenSymbol(dataHex: string): string | null {
  return decodeField(dataHex, SYMBOL_MAX_CHARS);
}

/** name() then symbol(), same order decodeTokenMetaResults expects them back
    in -- mirrors reserve.ts's own encodePairTokenCalls. */
export function encodeTokenMetaCalls(
  addresses: string[],
): Array<{ target: string; callData: string }> {
  const calls: Array<{ target: string; callData: string }> = [];
  for (const target of addresses) {
    calls.push({ target, callData: SELECTOR_NAME.replace(/^0x/, "") });
    calls.push({ target, callData: SELECTOR_SYMBOL_TOKEN.replace(/^0x/, "") });
  }
  return calls;
}

/** `decoded` is any `{success, data}[]` pair sequence -- an
    Aggregate3Result[] slice or a callBatch result mapped to the same shape --
    kept structural rather than importing reserve.ts's own type, so this
    module has no dependency on it. */
export function decodeTokenMetaResults(
  addresses: string[],
  decoded: Array<{ success: boolean; data: string }>,
): TokenMetaReading[] {
  return addresses.map((address, i) => {
    const nameResult = decoded[i * 2];
    const symbolResult = decoded[i * 2 + 1];
    return {
      address,
      name: nameResult?.success ? decodeTokenName(nameResult.data) : null,
      symbol: symbolResult?.success ? decodeTokenSymbol(symbolResult.data) : null,
    };
  });
}
