/* Pons V2 on Robinhood Chain (chain 4663). Every constant here is verified in
   PONS_CONTRACTS.md and matches pipeline/rpc.py exactly; the two indexers must
   decode the same bytes the same way or the nightly reconciliation is
   meaningless. */

export const TOPIC_TOKEN_LAUNCHED =
  "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
export const TOPIC_POOL_GRADUATED =
  "0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259";

/* The two curve events, verified in RESEARCH-PHASE2-3.md section A3.

   CurveBuy(address,address,uint256,uint256,uint256,uint256)
     topics [1]=buyer  [2]=recipient
     data   [0]=quoteIn [1]=tokensOut [2]=fee [3]=tax
   CurveSell(address,address,uint256,uint256,uint256,uint256)
     topics [1]=seller [2]=recipient
     data   [0]=tokensIn [1]=quoteOut [2]=fee [3]=tax

   Both are emitted by the launch's OWN curve, and every launch deploys one:
   there is no shared curve, so these are read by topic0 with no address
   filter and the emitting curve is taken from each log's own `address`
   field. */
export const TOPIC_CURVE_BUY =
  "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455";
export const TOPIC_CURVE_SELL =
  "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df";

/** getLaunchedToken(address) -- keccak256 prefix, verified against
    pipeline/keccak.py. Returns a 15-word static tuple. */
export const SELECTOR_GET_LAUNCHED_TOKEN = "0x3cf28b5a";

/** Word offsets inside that tuple (PONS_CONTRACTS.md, "Decoded layouts"). */
export const LAUNCHED_TOKEN_WORDS = 15;
export const FIELD_TOKEN = 0;
export const FIELD_CURVE = 1;
export const FIELD_PAIR_TOKEN = 4;
export const FIELD_GRADUATION_THRESHOLD = 5;
export const FIELD_CREATOR_TAX_BPS = 8;
export const FIELD_PHASE = 10;
export const FIELD_EXISTS = 14;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface TokenLaunchedLog {
  token: string;
  curve: string;
  deployer: string;
  pairToken: string;
  launchConfigId: number;
  graduationThreshold: string;
  block: number;
  txHash: string;
  logIndex: number;
}

export interface PoolGraduatedLog {
  token: string;
  positionId: string;
  tokenAmount: string;
  pairTokenAmount: string;
  block: number;
  txHash: string;
  logIndex: number;
}

export interface RawLog {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  /** The contract that emitted the log. Optional because a factory log is
      already filtered by address and never needs to read it; a curve log has
      nothing else to say which launch it belongs to. */
  address?: string;
}

export type TradeSide = "buy" | "sell";

/** One CurveBuy or CurveSell, decoded. `quoteIn` and `quoteOut` are decimal
    strings: a uint256 does not fit a 64-bit integer, and the side that does
    not apply is "0" rather than absent, so the two sums add the same way. */
export interface CurveTradeLog {
  curve: string;
  side: TradeSide;
  trader: string;
  quoteIn: string;
  quoteOut: string;
  block: number;
  txHash: string;
  logIndex: number;
}

export function decodeCurveTrade(log: RawLog, side: TradeSide): CurveTradeLog {
  if (!log.address) throw new Error("a curve log with no address names no curve");
  if (log.topics.length < 2) throw new Error("a curve trade log carries too few topics");
  const quote = wordToBigInt(dataWord(log.data, side === "buy" ? 0 : 1)).toString();
  return {
    curve: log.address.toLowerCase(),
    side,
    trader: wordToAddress(log.topics[1] as string),
    quoteIn: side === "buy" ? quote : "0",
    quoteOut: side === "sell" ? quote : "0",
    block: Number(BigInt(log.blockNumber)),
    txHash: log.transactionHash,
    logIndex: Number(BigInt(log.logIndex)),
  };
}

function topicToAddress(topic: string): string {
  return ("0x" + topic.slice(-40)).toLowerCase();
}

/** Word `index` of an ABI-encoded return or data blob, as 64 hex chars. */
export function dataWord(data: string, index: number): string {
  const start = 2 + index * 64;
  return data.slice(start, start + 64);
}

export function wordToBigInt(word: string): bigint {
  return BigInt("0x" + word);
}

export function wordToAddress(word: string): string {
  return ("0x" + word.slice(-40)).toLowerCase();
}

export function decodeTokenLaunched(log: RawLog): TokenLaunchedLog {
  const t = log.topics;
  if (t.length < 4) throw new Error("TokenLaunched log carries too few topics");
  return {
    token: topicToAddress(t[1] as string),
    curve: topicToAddress(t[2] as string),
    deployer: topicToAddress(t[3] as string),
    pairToken: wordToAddress(dataWord(log.data, 0)),
    launchConfigId: Number(wordToBigInt(dataWord(log.data, 1))),
    graduationThreshold: wordToBigInt(dataWord(log.data, 2)).toString(),
    block: Number(BigInt(log.blockNumber)),
    txHash: log.transactionHash,
    logIndex: Number(BigInt(log.logIndex)),
  };
}

export function decodePoolGraduated(log: RawLog): PoolGraduatedLog {
  const t = log.topics;
  if (t.length < 2) throw new Error("PoolGraduated log carries too few topics");
  return {
    token: topicToAddress(t[1] as string),
    positionId: wordToBigInt(dataWord(log.data, 0)).toString(),
    tokenAmount: wordToBigInt(dataWord(log.data, 1)).toString(),
    pairTokenAmount: wordToBigInt(dataWord(log.data, 2)).toString(),
    block: Number(BigInt(log.blockNumber)),
    txHash: log.transactionHash,
    logIndex: Number(BigInt(log.logIndex)),
  };
}

export interface LaunchedToken {
  exists: boolean;
  /** This launch's OWN bonding curve. Every launch deploys one; there is no
      shared curve (RESEARCH-PHASE2-3.md section 0). */
  curve: string;
  pairToken: string;
  graduationThresholdWei: string;
  /** Null when the reading failed. A tax that was not read is not a tax of
      zero, and the two must not print the same. */
  creatorTaxBps: number | null;
  phase: number;
}

/** Decode the 15-word getLaunchedToken tuple. Returns null when the return
    data is short -- a token the factory has never seen answers with zeros or
    nothing at all, and neither is an "exists". */
export function decodeLaunchedToken(returnData: string | null | undefined): LaunchedToken | null {
  if (!returnData || returnData === "0x") return null;
  const words = (returnData.length - 2) / 64;
  if (words < LAUNCHED_TOKEN_WORDS) return null;
  const exists = wordToBigInt(dataWord(returnData, FIELD_EXISTS)) === 1n;
  return {
    exists,
    curve: wordToAddress(dataWord(returnData, FIELD_CURVE)),
    pairToken: wordToAddress(dataWord(returnData, FIELD_PAIR_TOKEN)),
    graduationThresholdWei: wordToBigInt(dataWord(returnData, FIELD_GRADUATION_THRESHOLD)).toString(),
    creatorTaxBps: Number(wordToBigInt(dataWord(returnData, FIELD_CREATOR_TAX_BPS))),
    phase: Number(wordToBigInt(dataWord(returnData, FIELD_PHASE))),
  };
}

/** Left-pad an address into a 32-byte calldata word. */
export function encodeAddressCall(selector: string, address: string): string {
  return selector + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/** Phase semantics are verified for 0 and 2 only. 1 and 3 have never been
    observed, so they are named as unknown rather than guessed at. */
export function phaseLabel(phase: number | null): string {
  if (phase === 0) return "on the bonding curve";
  if (phase === 2) return "graduated";
  if (phase === null) return "phase not read";
  return `unknown phase (${phase})`;
}
