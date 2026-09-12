import { describe, expect, it } from "vitest";
import { decodeTokenMetaResults, decodeTokenName, decodeTokenSymbol } from "../../src/tokenMeta";

const WORD = 64;

function word(value: bigint): string {
  return value.toString(16).padStart(WORD, "0");
}

/** ABI-encodes a dynamic `string` the way name()/symbol() are specified to
    return it: an offset word, a length word, then the UTF-8 bytes right
    -padded to a whole word -- an independent encoding of the same layout
    worker/src/tokenMeta.ts decodes, mirroring worker/tests/node/reserve.test.ts's
    own encodeAbiString. */
function encodeAbiString(value: string): string {
  const bytes = Buffer.from(value, "utf-8");
  const hex = bytes.toString("hex");
  const padded = hex.padEnd(Math.ceil(hex.length / WORD) * WORD || WORD, "0");
  return word(32n) + word(BigInt(bytes.length)) + padded;
}

describe("decodeTokenName / decodeTokenSymbol -- the ABI-string decode and its NULL rules", () => {
  it("decodes a normal ABI dynamic string", () => {
    expect(decodeTokenName(encodeAbiString("Pons Coin"))).toBe("Pons Coin");
    expect(decodeTokenSymbol(encodeAbiString("PONS"))).toBe("PONS");
  });

  it("decodes a bytes32-style fixed response as NULL, never as text", () => {
    // A raw bytes32 "MKR" left-aligned, no offset/length structure at all --
    // exactly one word, too short to hold even the offset+length head a
    // dynamic string needs.
    const bytes32 = Buffer.from("MKR").toString("hex").padEnd(WORD, "0");
    expect(decodeTokenName(bytes32)).toBeNull();
    expect(decodeTokenSymbol(bytes32)).toBeNull();
  });

  it("decodes an empty string response as '', a real answer, not a failure", () => {
    expect(decodeTokenName(encodeAbiString(""))).toBe("");
    expect(decodeTokenSymbol(encodeAbiString(""))).toBe("");
  });

  it("strips control characters and caps length -- 64 chars for name, 16 for symbol", () => {
    const longName = "A".repeat(100);
    const decoded = decodeTokenName(encodeAbiString(longName));
    expect(decoded).toHaveLength(64);
    expect(decoded).toBe("A".repeat(64));

    const longSymbol = "B".repeat(30);
    const decodedSymbol = decodeTokenSymbol(encodeAbiString(longSymbol));
    expect(decodedSymbol).toHaveLength(16);
    expect(decodedSymbol).toBe("B".repeat(16));

    const withControlChars = "Po\x00ns\x1FCo\x7Fin";
    expect(decodeTokenName(encodeAbiString(withControlChars))).toBe("PonsCoin");
  });

  it("returns NULL rather than a guess when the decoded bytes are not valid UTF-8", () => {
    // A well-formed offset/length pointing at a lone continuation byte.
    const garbage = word(32n) + word(1n) + "80".padEnd(WORD, "0");
    expect(decodeTokenName(garbage)).toBeNull();
  });

  it("returns NULL for a truncated or malformed response rather than throw", () => {
    expect(decodeTokenName("00")).toBeNull();
    expect(decodeTokenName(word(999_999n))).toBeNull(); // offset points nowhere real
  });
});

describe("decodeTokenMetaResults -- name() then symbol(), per address, allowFailure honoured", () => {
  const ADDR_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const ADDR_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  it("pairs name()/symbol() results with their address, in order", () => {
    const decoded = decodeTokenMetaResults(
      [ADDR_A, ADDR_B],
      [
        { success: true, data: encodeAbiString("Pons Coin") },
        { success: true, data: encodeAbiString("PONS") },
        { success: true, data: encodeAbiString("Second Coin") },
        { success: true, data: encodeAbiString("SEC") },
      ],
    );
    expect(decoded).toEqual([
      { address: ADDR_A, name: "Pons Coin", symbol: "PONS" },
      { address: ADDR_B, name: "Second Coin", symbol: "SEC" },
    ]);
  });

  it("yields NULL, never a guess, for a sub-call that failed", () => {
    const decoded = decodeTokenMetaResults(
      [ADDR_A],
      [
        { success: false, data: "" },
        { success: true, data: encodeAbiString("PONS") },
      ],
    );
    expect(decoded).toEqual([{ address: ADDR_A, name: null, symbol: "PONS" }]);
  });
});
