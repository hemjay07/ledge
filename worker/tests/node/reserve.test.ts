import { describe, expect, it } from "vitest";
import {
  MAX_RESERVE_CURVES,
  MULTICALL3_ADDRESS,
  SELECTOR_AGGREGATE3,
  decodeAggregate3,
  encodeAggregate3,
  readReserves,
  readReservesAndPairTokens,
  type Aggregate3Result,
} from "../../src/reserve";
import { SELECTOR_GRADUATED, SELECTOR_REAL_QUOTE_RESERVE } from "../../src/curve";
import { ZERO_ADDRESS } from "../../src/decimals";
import { RpcClient } from "../../src/rpc";

const WORD = 64;

function word(value: bigint): string {
  return value.toString(16).padStart(WORD, "0");
}

/** Hand-builds a Multicall3 `Result[] (bool success, bytes returnData)[]`
    response the same way worker/src/reserve.ts's own encoder builds its
    request -- a second, independent encoding so the decoder is checked
    against something it did not itself produce. */
function encodeResults(items: Array<{ success: boolean; data: string }>): string {
  const n = items.length;
  const elements = items.map((item) => {
    const dataBytes = item.data.length / 2;
    const paddedChars = Math.ceil(item.data.length / WORD) * WORD;
    const bytesEncoded = word(BigInt(dataBytes)) + item.data.padEnd(paddedChars, "0");
    return word(item.success ? 1n : 0n) + word(64n) + bytesEncoded;
  });
  let cursor = n * 32;
  const offsets: string[] = [];
  for (const element of elements) {
    offsets.push(word(BigInt(cursor)));
    cursor += element.length / 2;
  }
  const arrayData = word(BigInt(n)) + offsets.join("") + elements.join("");
  return "0x" + word(32n) + arrayData;
}

function fakeMulticall(resultHex: string | null, seen: { targets: string[]; datas: string[] } = { targets: [], datas: [] }) {
  const client = new RpcClient("http://unused", async (payload) => {
    const batch = payload as Array<{ id: number; params: any[] }>;
    return batch.map((request) => {
      seen.targets.push(String(request.params[0].to).toLowerCase());
      seen.datas.push(request.params[0].data);
      return { id: request.id, result: resultHex };
    });
  });
  return { client, seen };
}

describe("encodeAggregate3 / decodeAggregate3 round trip", () => {
  it("decodes what it encoded, target and calldata intact", () => {
    const calls = [
      { target: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", callData: SELECTOR_GRADUATED.slice(2) },
      { target: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", callData: SELECTOR_REAL_QUOTE_RESERVE.slice(2) },
    ];
    const calldata = encodeAggregate3(calls);
    expect(calldata.startsWith(SELECTOR_AGGREGATE3)).toBe(true);

    // A response answering both calls, decoded back with our own decoder.
    const resultHex = encodeResults([
      { success: true, data: word(0n) },
      { success: true, data: word(123n) },
    ]);
    const decoded = decodeAggregate3(resultHex, 2);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toEqual<Aggregate3Result>({ success: true, data: word(0n) });
    expect(decoded[1]).toEqual<Aggregate3Result>({ success: true, data: word(123n) });
  });

  it("throws rather than guess when the result count does not match", () => {
    const resultHex = encodeResults([{ success: true, data: word(1n) }]);
    expect(() => decodeAggregate3(resultHex, 2)).toThrow();
  });

  it("throws on a response too short to hold even the length word", () => {
    expect(() => decodeAggregate3("0x00", 1)).toThrow();
  });
});

describe("readReserves — three curves, one success, one failure, one graduated-drained", () => {
  const CURVE_OK = "0x1111111111111111111111111111111111111a";
  const CURVE_FAILED = "0x2222222222222222222222222222222222222b";
  const CURVE_DRAINED = "0x3333333333333333333333333333333333333c";

  const targets = [
    { token: "0xtoken-ok", curve: CURVE_OK },
    { token: "0xtoken-failed", curve: CURVE_FAILED },
    { token: "0xtoken-drained", curve: CURVE_DRAINED },
  ];

  /* Order matches readReserves' own call order: graduated() then
     realQuoteReserve(), per curve, in the order `targets` lists them. */
  function response(): string {
    return encodeResults([
      // CURVE_OK: not graduated, holds 2.245 ETH.
      { success: true, data: word(0n) },
      { success: true, data: word(2_245_000_000_000_000_000n) },
      // CURVE_FAILED: graduated() answers, realQuoteReserve() reverts.
      { success: true, data: word(0n) },
      { success: false, data: "" },
      // CURVE_DRAINED: graduated, reserve reads exactly 0 -- a real reading,
      // never confused with "the call failed".
      { success: true, data: word(1n) },
      { success: true, data: word(0n) },
    ]);
  }

  it("reads a real reserve for the curve that answered cleanly", async () => {
    const { client } = fakeMulticall(response());
    const readings = await readReserves(client, targets, 56_172_580);
    const ok = readings.find((r) => r.token === "0xtoken-ok");
    expect(ok).toEqual({ token: "0xtoken-ok", reserveWei: "2245000000000000000", graduated: false });
  });

  it("yields null, never 0, for the sub-call that failed", async () => {
    const { client } = fakeMulticall(response());
    const readings = await readReserves(client, targets, 56_172_580);
    const failed = readings.find((r) => r.token === "0xtoken-failed");
    expect(failed).toEqual({ token: "0xtoken-failed", reserveWei: null, graduated: false });
  });

  it("reports a graduated, drained curve's real reserve of 0 -- not null, not hidden", async () => {
    const { client } = fakeMulticall(response());
    const readings = await readReserves(client, targets, 56_172_580);
    const drained = readings.find((r) => r.token === "0xtoken-drained");
    expect(drained).toEqual({ token: "0xtoken-drained", reserveWei: "0", graduated: true });
  });

  it("makes exactly one eth_call, to the Multicall3 address, pinned to the given block", async () => {
    const seen = { targets: [] as string[], datas: [] as string[] };
    const { client } = fakeMulticall(response(), seen);
    await readReserves(client, targets, 56_172_580);
    expect(client.subrequests).toBe(1);
    expect(seen.targets).toEqual([MULTICALL3_ADDRESS]);
  });

  it("returns [] rather than a guess when the multicall gives no result", async () => {
    const { client } = fakeMulticall(null);
    const readings = await readReserves(client, targets, 56_172_580);
    expect(readings).toEqual([]);
  });

  it("returns [] rather than a guess when the response is malformed", async () => {
    const { client } = fakeMulticall("0xnotarealresponse");
    const readings = await readReserves(client, targets, 56_172_580);
    expect(readings).toEqual([]);
  });

  it("returns [] for an empty target list without making a call", async () => {
    const seen = { targets: [] as string[], datas: [] as string[] };
    const { client } = fakeMulticall(response(), seen);
    const readings = await readReserves(client, [], 56_172_580);
    expect(readings).toEqual([]);
    expect(client.subrequests).toBe(0);
  });

  it("caps the multicall input at MAX_RESERVE_CURVES", async () => {
    const many = Array.from({ length: MAX_RESERVE_CURVES + 50 }, (_, i) => ({
      token: `0xtoken-${i}`,
      curve: CURVE_OK,
    }));
    const seen = { targets: [] as string[], datas: [] as string[] };
    const items: Array<{ success: boolean; data: string }> = [];
    for (let i = 0; i < MAX_RESERVE_CURVES; i++) {
      items.push({ success: true, data: word(0n) }, { success: true, data: word(1n) });
    }
    const { client } = fakeMulticall(encodeResults(items), seen);
    const readings = await readReserves(client, many, 1);
    expect(readings).toHaveLength(MAX_RESERVE_CURVES);
  });
});

/* Pair-token decimals()/symbol() reads (2026-09-12): worker/schema.sql's
   `pair_token` read-once cache, filled from the SAME aggregate3 call the
   reserve read already makes -- readReservesAndPairTokens folds both kinds
   of call into one array rather than issuing a second eth_call. */
describe("readReservesAndPairTokens — pair-token decimals/symbol", () => {
  const CURVE_OK = "0x1111111111111111111111111111111111111a";
  const PAIR_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const PAIR_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const targets = [{ token: "0xtoken-a", curve: CURVE_OK }];

  /** ABI-encodes a dynamic `string` the way `symbol()` is specified to
      return it: an offset word, a length word, then the UTF-8 bytes
      right-padded to a whole word. */
  function encodeAbiString(value: string): string {
    const bytes = Buffer.from(value, "utf-8");
    const hex = bytes.toString("hex");
    const padded = hex.padEnd(Math.ceil(hex.length / WORD) * WORD, "0");
    return word(32n) + word(BigInt(bytes.length)) + padded;
  }

  it("decodes decimals() and a well-formed ABI string symbol()", async () => {
    const resultHex = encodeResults([
      // reserve pair: graduated() / realQuoteReserve()
      { success: true, data: word(0n) },
      { success: true, data: word(0n) },
      // PAIR_A: decimals() / symbol()
      { success: true, data: word(6n) },
      { success: true, data: encodeAbiString("USDG") },
    ]);
    const { client } = fakeMulticall(resultHex);
    const { pairTokens } = await readReservesAndPairTokens(client, targets, [PAIR_A], [], 1);
    expect(pairTokens).toEqual([{ address: PAIR_A, decimals: 6, symbol: "USDG" }]);
  });

  it("stores symbol as NULL when the return is a raw bytes32, not a dynamic string", async () => {
    // A raw bytes32 "MKR" left-aligned, no offset/length structure at all --
    // read as an offset it is either absurdly large or points past the data,
    // so the ABI-string decode must fail rather than mis-decode it.
    const bytes32Symbol = Buffer.from("MKR").toString("hex").padEnd(WORD, "0");
    const resultHex = encodeResults([
      { success: true, data: word(0n) },
      { success: true, data: word(0n) },
      { success: true, data: word(18n) },
      { success: true, data: bytes32Symbol },
    ]);
    const { client } = fakeMulticall(resultHex);
    const { pairTokens } = await readReservesAndPairTokens(client, targets, [PAIR_A], [], 1);
    expect(pairTokens).toEqual([{ address: PAIR_A, decimals: 18, symbol: null }]);
  });

  it("stores symbol as NULL when the decoded bytes are not valid UTF-8", async () => {
    // A well-formed offset/length pointing at bytes that are not valid UTF-8
    // (a lone continuation byte) must still fail closed to null.
    const garbage = word(32n) + word(1n) + "80".padEnd(WORD, "0");
    const resultHex = encodeResults([
      { success: true, data: word(0n) },
      { success: true, data: word(0n) },
      { success: true, data: word(18n) },
      { success: true, data: garbage },
    ]);
    const { client } = fakeMulticall(resultHex);
    const { pairTokens } = await readReservesAndPairTokens(client, targets, [PAIR_A], [], 1);
    expect(pairTokens).toEqual([{ address: PAIR_A, decimals: 18, symbol: null }]);
  });

  it("keeps decimals when only symbol() failed, and vice versa", () => {
    return (async () => {
      const resultHex = encodeResults([
        { success: true, data: word(0n) },
        { success: true, data: word(0n) },
        { success: true, data: word(6n) }, // decimals() answers
        { success: false, data: "" }, // symbol() reverts
      ]);
      const { client } = fakeMulticall(resultHex);
      const { pairTokens } = await readReservesAndPairTokens(client, targets, [PAIR_A], [], 1);
      expect(pairTokens).toEqual([{ address: PAIR_A, decimals: 6, symbol: null }]);
    })();
  });

  it("stores decimals as NULL, never a guess, when decimals() itself reverts", async () => {
    const resultHex = encodeResults([
      { success: true, data: word(0n) },
      { success: true, data: word(0n) },
      { success: false, data: "" }, // decimals() reverts
      { success: true, data: encodeAbiString("XYZ") },
    ]);
    const { client } = fakeMulticall(resultHex);
    const { pairTokens } = await readReservesAndPairTokens(client, targets, [PAIR_A], [], 1);
    expect(pairTokens).toEqual([{ address: PAIR_A, decimals: null, symbol: "XYZ" }]);
  });

  it("rejects an implausible decimals() value (outside 0-36) rather than store it", async () => {
    const resultHex = encodeResults([
      { success: true, data: word(0n) },
      { success: true, data: word(0n) },
      { success: true, data: word(255n) },
      { success: true, data: encodeAbiString("XYZ") },
    ]);
    const { client } = fakeMulticall(resultHex);
    const { pairTokens } = await readReservesAndPairTokens(client, targets, [PAIR_A], [], 1);
    expect(pairTokens).toEqual([{ address: PAIR_A, decimals: null, symbol: "XYZ" }]);
  });

  it("reads reserves and pair tokens for two addresses in one aggregate3 call, one subrequest", async () => {
    const seen = { targets: [] as string[], datas: [] as string[] };
    const resultHex = encodeResults([
      { success: true, data: word(0n) },
      { success: true, data: word(2_245_000_000_000_000_000n) },
      { success: true, data: word(6n) },
      { success: true, data: encodeAbiString("USDG") },
      { success: true, data: word(18n) },
      { success: true, data: encodeAbiString("STOCKX") },
    ]);
    const { client } = fakeMulticall(resultHex, seen);
    const { reserves, pairTokens } = await readReservesAndPairTokens(
      client,
      targets,
      [PAIR_A, PAIR_B],
      [],
      56_172_580,
    );
    expect(reserves).toEqual([{ token: "0xtoken-a", graduated: false, reserveWei: "2245000000000000000" }]);
    expect(pairTokens).toEqual([
      { address: PAIR_A, decimals: 6, symbol: "USDG" },
      { address: PAIR_B, decimals: 18, symbol: "STOCKX" },
    ]);
    expect(client.subrequests).toBe(1);
    expect(seen.targets).toEqual([MULTICALL3_ADDRESS]);
  });

  it("never calls the zero address, even if it is passed in", async () => {
    const seen = { targets: [] as string[], datas: [] as string[] };
    const resultHex = encodeResults([
      { success: true, data: word(0n) },
      { success: true, data: word(0n) },
    ]);
    const { client } = fakeMulticall(resultHex, seen);
    const { pairTokens } = await readReservesAndPairTokens(client, targets, [ZERO_ADDRESS], [], 1);
    expect(pairTokens).toEqual([]);
  });

  it("returns empty arrays rather than a guess when the multicall response is malformed", async () => {
    const { client } = fakeMulticall("0xnotarealresponse");
    const result = await readReservesAndPairTokens(client, targets, [PAIR_A], [], 1);
    expect(result).toEqual({ reserves: [], pairTokens: [], tokenMeta: [] });
  });

  it("makes no call at all when there is nothing to read", async () => {
    const seen = { targets: [] as string[], datas: [] as string[] };
    const { client } = fakeMulticall(null, seen);
    const result = await readReservesAndPairTokens(client, [], [], [], 1);
    expect(result).toEqual({ reserves: [], pairTokens: [], tokenMeta: [] });
    expect(client.subrequests).toBe(0);
  });

  /* Token-meta (name()/symbol() of the launched TOKEN, not the pair) reads
     (2026-09-12), folded into the same aggregate3 array as the reserve and
     pair-token calls above -- worker/schema.sql's `token_meta` cache. */
  describe("token name()/symbol() reads", () => {
    const TOKEN_META_A = "0xdddddddddddddddddddddddddddddddddddddddd";

    it("decodes name() and symbol() for a token with no cached row yet", async () => {
      const resultHex = encodeResults([
        { success: true, data: word(0n) },
        { success: true, data: word(0n) },
        { success: true, data: encodeAbiString("Pons Coin") },
        { success: true, data: encodeAbiString("PONS") },
      ]);
      const { client } = fakeMulticall(resultHex);
      const { tokenMeta } = await readReservesAndPairTokens(client, targets, [], [TOKEN_META_A], 1);
      expect(tokenMeta).toEqual([{ address: TOKEN_META_A, name: "Pons Coin", symbol: "PONS" }]);
    });

    it("stores name/symbol as NULL when the return is a raw bytes32, not a dynamic string", async () => {
      const bytes32Name = Buffer.from("MKR").toString("hex").padEnd(WORD, "0");
      const resultHex = encodeResults([
        { success: true, data: word(0n) },
        { success: true, data: word(0n) },
        { success: true, data: bytes32Name },
        { success: true, data: bytes32Name },
      ]);
      const { client } = fakeMulticall(resultHex);
      const { tokenMeta } = await readReservesAndPairTokens(client, targets, [], [TOKEN_META_A], 1);
      expect(tokenMeta).toEqual([{ address: TOKEN_META_A, name: null, symbol: null }]);
    });

    it("decodes an empty string as '', not NULL -- a real answer, not a failure", async () => {
      const resultHex = encodeResults([
        { success: true, data: word(0n) },
        { success: true, data: word(0n) },
        { success: true, data: encodeAbiString("") },
        { success: true, data: encodeAbiString("") },
      ]);
      const { client } = fakeMulticall(resultHex);
      const { tokenMeta } = await readReservesAndPairTokens(client, targets, [], [TOKEN_META_A], 1);
      expect(tokenMeta).toEqual([{ address: TOKEN_META_A, name: "", symbol: "" }]);
    });

    it("makes exactly one eth_call covering reserves, pair tokens and token meta together", async () => {
      const seen = { targets: [] as string[], datas: [] as string[] };
      const resultHex = encodeResults([
        { success: true, data: word(0n) },
        { success: true, data: word(2_245_000_000_000_000_000n) },
        { success: true, data: word(6n) },
        { success: true, data: encodeAbiString("USDG") },
        { success: true, data: encodeAbiString("Pons Coin") },
        { success: true, data: encodeAbiString("PONS") },
      ]);
      const { client } = fakeMulticall(resultHex, seen);
      const { reserves, pairTokens, tokenMeta } = await readReservesAndPairTokens(
        client,
        targets,
        [PAIR_A],
        [TOKEN_META_A],
        56_172_580,
      );
      expect(reserves).toEqual([{ token: "0xtoken-a", graduated: false, reserveWei: "2245000000000000000" }]);
      expect(pairTokens).toEqual([{ address: PAIR_A, decimals: 6, symbol: "USDG" }]);
      expect(tokenMeta).toEqual([{ address: TOKEN_META_A, name: "Pons Coin", symbol: "PONS" }]);
      expect(client.subrequests).toBe(1);
      expect(seen.targets).toEqual([MULTICALL3_ADDRESS]);
    });
  });
});
