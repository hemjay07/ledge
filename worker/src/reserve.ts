/* The board's reserve read (2026-09-12) -- one Multicall3 call replacing the
   per-curve reads board.ts's own header comment explains were never
   affordable: 200 curves at three reads each is 600 subrequests against a
   40-subrequest budget (worker/src/rpc.ts SUBREQUEST_BUDGET). Multicall3 is
   deployed at the canonical address on Robinhood Chain, and its
   aggregate3((address,bool,bytes)[]) takes any number of calls in one
   eth_call -- so the whole board population is read for the same one
   subrequest a single curve used to cost.

   WHY HAND-ENCODED. worker/src/curve.ts and worker/src/pons.ts already
   hand-roll every selector and call this Worker makes; adding an ABI library
   for one more call shape is the wrong trade. aggregate3's calldata has one
   argument, an array of dynamic (address, bool, bytes) tuples, encoded and
   decoded here the same way curve.ts encodes its own calls -- plain hex
   string arithmetic, no Buffer, no dependency.

   allowFailure IS ALWAYS TRUE. A curve that reverts on graduated() or
   realQuoteReserve() must not take the whole batch down with it: the other
   199 curves answered, and their readings are real. A failed sub-call
   decodes to null for that one field, never to zero -- zero is a real
   reading a drained or graduated curve can give, and treating "the call
   failed" and "the curve reported zero" as the same thing would be exactly
   the defect this file exists to fix on the indexed side. */

import type { RpcClient } from "./rpc";
import { SELECTOR_GRADUATED, SELECTOR_REAL_QUOTE_RESERVE } from "./curve";
import { SELECTOR_DECIMALS, ZERO_ADDRESS } from "./decimals";

/** Deployed at the same address on every EVM chain that has it, Robinhood
    Chain included -- confirmed live before this file was written. */
export const MULTICALL3_ADDRESS = "0xca11bde05977b3631167028862be2a173976ca11";
/** keccak256("aggregate3((address,bool,bytes)[])")[:4], computed with
    pipeline/keccak.py, the same way curve.ts's own selectors were. */
export const SELECTOR_AGGREGATE3 = "0x82ad56cb";

/** The board's candidate population is the 500 most recently active curves
    (BOARD_QUERY's LIMIT), which a sort key other than recency then trims to
    200 -- so a row shown under "most buys" can be one of the 500 that is not
    among the 200 most recent. Measured on the first deployed tick
    (2026-09-12): 193 of 200 rows carried a fill under recency, 90 of 200
    under most-buys. The read covers the same 500 the board draws from. */
export const MAX_RESERVE_CURVES = 500;

/** The board's population, mirrored from worker/src/board.ts's BOARD_QUERY:
    one row per token with a token_activity row, joined to that token's
    earliest launch (the same EXISTS/MIN(block) reasoning board.ts carries --
    a token can hold more than one launch row while a reorg is being
    reconciled), most recently active first. Only `curve` is new here; the
    rest of a board row comes from D1 alone and is untouched by this file. */
export const RESERVE_POPULATION_QUERY = `
  SELECT a.token, l.curve, l.pair_token, a.reserve_wei
    FROM token_activity a
    JOIN launch l
      ON l.token = a.token
     AND l.block = (SELECT MIN(l2.block) FROM launch l2 WHERE l2.token = a.token)
   ORDER BY a.last_activity_ts DESC
   LIMIT ${MAX_RESERVE_CURVES}
`;

export interface CurveTarget {
  token: string;
  curve: string;
  /** The launch's own pair token, only present for callers reading it out of
      RESERVE_POPULATION_QUERY (worker/src/tick.ts uses it to find pair
      tokens worth a decimals()/symbol() read; readReserves itself never
      looks at it). Optional so a caller passing bare {token, curve} pairs --
      every existing test included -- is unaffected. */
  pairToken?: string;
}

export interface ReserveReading {
  token: string;
  /** realQuoteReserve(), in the pair token's smallest unit. Null when that
      one sub-call failed -- never 0, which is a real reading. */
  reserveWei: string | null;
  /** graduated(). Null when that one sub-call failed. */
  graduated: boolean | null;
}

const WORD = 64; // hex characters in one 32-byte ABI word

function hexWord(value: bigint): string {
  return value.toString(16).padStart(WORD, "0");
}

function addressWord(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(WORD, "0");
}

/** ABI-encodes a `bytes` value: a length word, then the data right-padded to
    a whole number of words. */
function encodeBytes(dataHex: string): string {
  const byteLength = dataHex.length / 2;
  const paddedChars = Math.ceil(dataHex.length / WORD) * WORD;
  return hexWord(BigInt(byteLength)) + dataHex.padEnd(paddedChars, "0");
}

interface Call3 {
  target: string;
  /** Call selector/calldata, hex without "0x". */
  callData: string;
}

/** Hand-encodes `aggregate3((address,bool,bytes)[])` calldata, allowFailure
    fixed true on every call (see the module comment). */
export function encodeAggregate3(calls: Call3[]): string {
  const n = calls.length;
  // Each element is (address, bool, offset-to-bytes) then its bytes payload;
  // the offset to bytes is always 0x60 (three words) since it immediately
  // follows the fixed head.
  const elements = calls.map(
    (call) => addressWord(call.target) + hexWord(1n) + hexWord(96n) + encodeBytes(call.callData),
  );
  let cursor = n * 32; // the offsets table itself, in bytes
  const offsets: string[] = [];
  for (const element of elements) {
    offsets.push(hexWord(BigInt(cursor)));
    cursor += element.length / 2;
  }
  const arrayData = hexWord(BigInt(n)) + offsets.join("") + elements.join("");
  return SELECTOR_AGGREGATE3 + hexWord(32n) + arrayData;
}

export interface Aggregate3Result {
  success: boolean;
  /** returnData, hex without "0x". */
  data: string;
}

/** Decodes `Result[] (bool success, bytes returnData)[]`. Throws on anything
    that does not fit the shape a well-formed Multicall3 answer has -- the
    caller turns that into "no reading at all", per the module's own rule
    that a guess is worse than silence. */
export function decodeAggregate3(resultHex: string, expectedLength: number): Aggregate3Result[] {
  const hex = resultHex.replace(/^0x/, "");
  if (hex.length < WORD) throw new Error("aggregate3: response shorter than one word");

  const arrayOffset = Number(BigInt("0x" + hex.slice(0, WORD))) * 2;
  if (hex.length < arrayOffset + WORD) throw new Error("aggregate3: truncated before array length");

  const length = Number(BigInt("0x" + hex.slice(arrayOffset, arrayOffset + WORD)));
  if (length !== expectedLength) {
    throw new Error(`aggregate3: expected ${expectedLength} results, got ${length}`);
  }

  const offsetsStart = arrayOffset + WORD;
  const results: Aggregate3Result[] = [];
  for (let i = 0; i < length; i++) {
    const offsetPos = offsetsStart + i * WORD;
    if (hex.length < offsetPos + WORD) throw new Error("aggregate3: truncated offsets table");
    const elementStart = offsetsStart + Number(BigInt("0x" + hex.slice(offsetPos, offsetPos + WORD))) * 2;
    if (hex.length < elementStart + WORD * 2) throw new Error("aggregate3: truncated result header");

    const success = BigInt("0x" + hex.slice(elementStart, elementStart + WORD)) !== 0n;
    const bytesOffset =
      Number(BigInt("0x" + hex.slice(elementStart + WORD, elementStart + WORD * 2))) * 2;
    const lengthPos = elementStart + bytesOffset;
    if (hex.length < lengthPos + WORD) throw new Error("aggregate3: truncated returnData length");

    const dataLength = Number(BigInt("0x" + hex.slice(lengthPos, lengthPos + WORD))) * 2;
    const dataStart = lengthPos + WORD;
    if (hex.length < dataStart + dataLength) throw new Error("aggregate3: truncated returnData");

    results.push({ success, data: hex.slice(dataStart, dataStart + dataLength) });
  }
  return results;
}

function decodeUint(dataHex: string): string | null {
  if (dataHex.length < WORD) return null;
  try {
    return BigInt("0x" + dataHex.slice(0, WORD)).toString();
  } catch {
    return null;
  }
}

function decodeBool(dataHex: string): boolean | null {
  if (dataHex.length < WORD) return null;
  try {
    return BigInt("0x" + dataHex.slice(0, WORD)) !== 0n;
  } catch {
    return null;
  }
}

/* PAIR-TOKEN DECIMALS/SYMBOL (2026-09-12). The board resolves a pair token's
   units from the static registry map alone (worker/src/board.ts, worker/src/
   decimals.ts) and returns null rather than guess for anything outside it --
   correct, but it leaves a real pair token the Python pipeline has not
   enriched yet permanently unreadable on the board. worker/schema.sql's
   `pair_token` table is a read-once cache for exactly those addresses, and
   the two functions below build and decode the calls that fill it, folded
   into the SAME aggregate3 call this file already makes for reserves -- see
   readReservesAndPairTokens. */

/** keccak256("symbol()")[:4]. decimals() reuses decimals.ts's own
    SELECTOR_DECIMALS rather than a second constant for the same selector. */
export const SELECTOR_SYMBOL = "0x95d89b41";

export interface PairTokenReading {
  address: string;
  /** ERC-20 decimals(), a uint8. Null when the call failed or returned
      something outside 0-36 -- outside that range is not a decimals reading,
      whatever the contract sent back. */
  decimals: number | null;
  /** ERC-20 symbol(), decoded as the ABI dynamic `string` most tokens return.
      Null when the call failed, or the return decodes to neither a
      well-formed dynamic string nor valid UTF-8 -- a token that answers with
      a raw bytes32 lands here, deliberately: a mis-decoded symbol is worse
      than none. */
  symbol: string | null;
}

/** Two independent sub-calls per address, decimals() then symbol() -- same
    order decodePairTokenResults expects them back in. */
function encodePairTokenCalls(addresses: string[]): Call3[] {
  const calls: Call3[] = [];
  for (const target of addresses) {
    calls.push({ target, callData: SELECTOR_DECIMALS.replace(/^0x/, "") });
    calls.push({ target, callData: SELECTOR_SYMBOL.replace(/^0x/, "") });
  }
  return calls;
}

function decodeDecimalsValue(dataHex: string): number | null {
  const raw = decodeUint(dataHex);
  if (raw === null) return null;
  let value: number;
  try {
    value = Number(raw);
  } catch {
    return null;
  }
  return Number.isInteger(value) && value >= 0 && value <= 36 ? value : null;
}

/** Decodes the ABI-encoded dynamic `string` layout (offset word, length word,
    UTF-8 bytes) that ERC-20 `symbol()` is specified to return. A token that
    instead answers with a raw bytes32 -- no offset/length structure at all --
    decodes an implausible offset or length here and falls through to null;
    the same is true of a string that offset/length parse but are not valid
    UTF-8. Nothing here special-cases "bytes32" by shape: any input that does
    not survive this decode is treated the same, per the module's "no guess"
    rule. */
function decodeSymbolString(dataHex: string): string | null {
  try {
    if (dataHex.length < WORD) return null;
    const offsetBytes = Number(BigInt("0x" + dataHex.slice(0, WORD))) * 2;
    if (offsetBytes < 0 || dataHex.length < offsetBytes + WORD) return null;
    const length = Number(BigInt("0x" + dataHex.slice(offsetBytes, offsetBytes + WORD)));
    if (!Number.isInteger(length) || length <= 0 || length > 256) return null;
    const strStart = offsetBytes + WORD;
    const strHexLen = length * 2;
    if (dataHex.length < strStart + strHexLen) return null;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = parseInt(dataHex.slice(strStart + i * 2, strStart + i * 2 + 2), 16);
    }
    const symbol = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).trim();
    return symbol.length > 0 ? symbol : null;
  } catch {
    return null;
  }
}

function decodePairTokenResults(
  addresses: string[],
  decoded: Aggregate3Result[],
): PairTokenReading[] {
  return addresses.map((address, i) => {
    const decimalsResult = decoded[i * 2];
    const symbolResult = decoded[i * 2 + 1];
    return {
      address,
      decimals: decimalsResult?.success ? decodeDecimalsValue(decimalsResult.data) : null,
      symbol: symbolResult?.success ? decodeSymbolString(symbolResult.data) : null,
    };
  });
}

/** One eth_call, one subrequest, covering every curve in `targets` (capped at
    MAX_RESERVE_CURVES). `blockNumber` pins the read to the tick's own head
    block rather than "latest", so `reserve_block` names the exact block the
    figure came from.

    Returns [] -- logged, not thrown -- whenever the top-level response is
    missing or does not decode as a well-formed aggregate3 answer. A caller
    reading [] writes nothing, which leaves every row's previous reading (or
    its NULL "never read" state) exactly where it was; that is a correct
    outcome and never a fabricated one. */
export async function readReserves(
  rpc: RpcClient,
  targets: CurveTarget[],
  blockNumber: number,
): Promise<ReserveReading[]> {
  const curves = targets.slice(0, MAX_RESERVE_CURVES);
  if (curves.length === 0) return [];

  const calls: Call3[] = [];
  for (const { curve } of curves) {
    calls.push({ target: curve, callData: SELECTOR_GRADUATED.replace(/^0x/, "") });
    calls.push({ target: curve, callData: SELECTOR_REAL_QUOTE_RESERVE.replace(/^0x/, "") });
  }
  const calldata = encodeAggregate3(calls);
  const blockTag = "0x" + blockNumber.toString(16);

  let raw: unknown;
  try {
    const results = await rpc.callBatch([
      { method: "eth_call", params: [{ to: MULTICALL3_ADDRESS, data: calldata }, blockTag] },
    ]);
    raw = results[0];
  } catch (error) {
    console.error("reserve: multicall eth_call failed", error instanceof Error ? error.message : String(error));
    return [];
  }
  if (typeof raw !== "string") {
    console.error("reserve: multicall gave no result");
    return [];
  }

  let decoded: Aggregate3Result[];
  try {
    decoded = decodeAggregate3(raw, calls.length);
  } catch (error) {
    console.error("reserve: malformed multicall response", error instanceof Error ? error.message : String(error));
    return [];
  }

  return curves.map(({ token }, i) => {
    const graduatedResult = decoded[i * 2];
    const reserveResult = decoded[i * 2 + 1];
    return {
      token,
      graduated: graduatedResult?.success ? decodeBool(graduatedResult.data) : null,
      reserveWei: reserveResult?.success ? decodeUint(reserveResult.data) : null,
    };
  });
}

export interface ReservesAndPairTokens {
  reserves: ReserveReading[];
  pairTokens: PairTokenReading[];
}

/** One eth_call, one subrequest, covering BOTH the curve reserve reads
    readReserves makes on its own and the pair-token decimals()/symbol()
    reads worker/schema.sql's `pair_token` table caches (2026-09-12). The two
    kinds of call are folded into ONE aggregate3 array rather than sent as two
    separate eth_calls, so the whole thing costs exactly the one subrequest
    readReserves alone used to cost -- `pairTokenAddresses` is expected to
    already be filtered down to addresses genuinely worth a call (not the
    zero address, not already a row in `pair_token`; see worker/src/tick.ts).

    Duplicates readReserves' own encode/call/decode plumbing rather than
    calling it, because splitting one combined response into two typed
    results is simpler than threading a second decode pass through a function
    whose contract (and tests) is the single-purpose reserve read alone.

    Returns empty arrays -- logged, not thrown -- under the same conditions
    readReserves does: a caller reading them back writes nothing, leaving
    every row's previous state exactly where it was. */
export async function readReservesAndPairTokens(
  rpc: RpcClient,
  targets: CurveTarget[],
  pairTokenAddresses: string[],
  blockNumber: number,
): Promise<ReservesAndPairTokens> {
  const curves = targets.slice(0, MAX_RESERVE_CURVES);
  const addresses = pairTokenAddresses.filter((a) => a.toLowerCase() !== ZERO_ADDRESS);
  const empty: ReservesAndPairTokens = { reserves: [], pairTokens: [] };
  if (curves.length === 0 && addresses.length === 0) return empty;

  const reserveCalls: Call3[] = [];
  for (const { curve } of curves) {
    reserveCalls.push({ target: curve, callData: SELECTOR_GRADUATED.replace(/^0x/, "") });
    reserveCalls.push({ target: curve, callData: SELECTOR_REAL_QUOTE_RESERVE.replace(/^0x/, "") });
  }
  const pairTokenCalls = encodePairTokenCalls(addresses);
  const calls = [...reserveCalls, ...pairTokenCalls];
  const calldata = encodeAggregate3(calls);
  const blockTag = "0x" + blockNumber.toString(16);

  let raw: unknown;
  try {
    const results = await rpc.callBatch([
      { method: "eth_call", params: [{ to: MULTICALL3_ADDRESS, data: calldata }, blockTag] },
    ]);
    raw = results[0];
  } catch (error) {
    console.error(
      "reserve: multicall eth_call failed",
      error instanceof Error ? error.message : String(error),
    );
    return empty;
  }
  if (typeof raw !== "string") {
    console.error("reserve: multicall gave no result");
    return empty;
  }

  let decoded: Aggregate3Result[];
  try {
    decoded = decodeAggregate3(raw, calls.length);
  } catch (error) {
    console.error(
      "reserve: malformed multicall response",
      error instanceof Error ? error.message : String(error),
    );
    return empty;
  }

  const reserveDecoded = decoded.slice(0, reserveCalls.length);
  const pairTokenDecoded = decoded.slice(reserveCalls.length);

  const reserves = curves.map(({ token }, i) => {
    const graduatedResult = reserveDecoded[i * 2];
    const reserveResult = reserveDecoded[i * 2 + 1];
    return {
      token,
      graduated: graduatedResult?.success ? decodeBool(graduatedResult.data) : null,
      reserveWei: reserveResult?.success ? decodeUint(reserveResult.data) : null,
    };
  });

  return { reserves, pairTokens: decodePairTokenResults(addresses, pairTokenDecoded) };
}
