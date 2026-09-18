import { describe, expect, it } from "vitest";
import {
  normaliseLookupInput,
  readLookup,
  splitLookupText,
  stripAddresses,
  UNREADABLE,
} from "../lib/api";
import ok from "./api-fixtures/token-ok.json";
import notIndexed from "./api-fixtures/token-not-indexed.json";
import numberUnavailable from "./api-fixtures/token-number-unavailable.json";
import insufficient from "./api-fixtures/token-insufficient.json";
import stale from "./api-fixtures/token-stale.json";
import notPons from "./api-fixtures/error-not-a-pons-token.json";
import rpcDown from "./api-fixtures/error-rpc-down.json";
import badAddress from "./api-fixtures/error-bad-address.json";

/* Every fixture in tests/api-fixtures was produced by running worker/src's own
   buildTokenBody and lookupText and validating the result against
   worker/src/schema.ts. They are the API's output, not a hand-written guess at
   it. */

const ADDRESS = "0x23fe54b3bf9e1d2816822043c0b02b6a12f98fe2";

describe("what the reader pasted", () => {
  it("takes an address as typed", () => {
    expect(normaliseLookupInput(`  ${ADDRESS}  `)).toBe(ADDRESS);
  });

  it("lowercases a checksummed address, as the Worker does", () => {
    expect(normaliseLookupInput("0x23Fe54B3bF9e1d2816822043c0b02b6a12F98fE2")).toBe(ADDRESS);
  });

  it("takes the address out of a ponsfamily.com launch URL", () => {
    expect(normaliseLookupInput(`https://ponsfamily.com/token/${ADDRESS}`)).toBe(ADDRESS);
    expect(normaliseLookupInput(`https://www.ponsfamily.com/t/${ADDRESS}?ref=x`)).toBe(ADDRESS);
  });

  it("returns nothing for an input holding no address, so the API may object", () => {
    expect(normaliseLookupInput("what is this")).toBeNull();
    expect(normaliseLookupInput("0x1234")).toBeNull();
  });
});

describe("classifying a response", () => {
  it("reads a full success", () => {
    const result = readLookup(ok);
    expect(result.kind).toBe("token");
  });

  it("reads not_indexed as a partial, keeping both the objection and the body", () => {
    const result = readLookup(notIndexed);
    expect(result).toMatchObject({ kind: "partial", error: "not_indexed" });
    if (result.kind !== "partial") throw new Error("unreachable");
    expect(result.message).toBe(notIndexed.message);
    expect(result.body.state.indexed).toBe(false);
    expect(result.body.cohort).not.toBeNull();
  });

  it("reads number_unavailable as a partial with no cohort", () => {
    const result = readLookup(numberUnavailable);
    if (result.kind !== "partial") throw new Error("expected a partial");
    expect(result.body.cohort).toBeNull();
  });

  it("reads not_a_pons_token in the API's own words", () => {
    expect(readLookup(notPons)).toEqual({
      kind: "error",
      error: "not_a_pons_token",
      message: notPons.message,
    });
  });

  it("reads rpc_down in the API's own words", () => {
    expect(readLookup(rpcDown)).toEqual({
      kind: "error",
      error: "rpc_down",
      message: rpcDown.message,
    });
  });

  it("reads bad_address in the API's own words", () => {
    expect(readLookup(badAddress)).toEqual({
      kind: "error",
      error: "bad_address",
      message: badAddress.message,
    });
  });

  it("refuses a body that is not the published contract", () => {
    expect(readLookup({ rate: 0.9 })).toEqual({
      kind: "error",
      error: "unreadable",
      message: UNREADABLE,
    });
  });
});

describe("the sentences, taken back apart", () => {
  function body(fixture: unknown) {
    const result = readLookup(fixture);
    if (result.kind === "error") throw new Error("expected a body");
    return result.body;
  }

  it("puts every line of a full lookup in exactly one slot, and loses none", () => {
    const b = body(ok);
    const lines = splitLookupText(b);
    /* the order text.ts writes since 2026-09-14; blank separator lines are
       not slots and are dropped on both sides */
    const rendered = [
      lines.identity,
      lines.config,
      lines.notice,
      lines.fill,
      ...lines.activity,
      ...lines.cohort,
      lines.placement,
      lines.stamp,
      lines.staleNote,
      lines.methodUrl,
    ].filter((l) => l !== null);
    expect(rendered).toEqual(b.text.split("\n").filter((l) => l.trim() !== ""));
  });

  it("renders the API's sentences verbatim, never a rebuilt one", () => {
    const lines = splitLookupText(body(ok));
    expect(lines.headline).toBeNull(); // the card's line is not in the running text since 2026-09-14
    expect(lines.config).toBe("ETH pair, 2–3% creator tax. Launched 14 minutes ago. Still on the curve.");
    expect(lines.cohort).toHaveLength(2);
    expect(lines.cohort[0]).toContain("Launches like this one:");
    expect(lines.cohort[0]).toContain("of 2,324");
    expect(lines.placement).toBe(
      "76.4% of graduations were done within 10 min (n=535); this launch was not. These figures were measured 303 d ago — older than the 2 h freshness bound.",
    );
    expect(lines.fill).toContain("Curve fill:");
    expect(lines.activity).toHaveLength(3);
    expect(lines.activity[0]).toContain("41 buys, 12 sells");
  });

  it("keeps the notice in its own slot when the launch is not indexed", () => {
    const lines = splitLookupText(body(notIndexed));
    expect(lines.notice).toContain("Launched before 5 September 2026");
    expect(lines.config).toBe("ETH pair, 2–3% creator tax. Still on the curve.");
    expect(lines.placement).toBe(
      "The launch time is not indexed, so this launch is not placed on the table of graduation times.",
    );
  });

  it("says so in one line when no cohort has been published", () => {
    const lines = splitLookupText(body(numberUnavailable));
    expect(lines.cohort).toEqual(["No figures are published for launches like this one."]);
    expect(lines.stamp).toBeNull();
  });

  it("carries the live layer's own staleness when the API sends it", () => {
    expect(splitLookupText(body(stale)).staleNote).toBe(
      "The live index has not completed a pass in over 5 minutes. Nothing below it is being estimated.",
    );
    expect(splitLookupText(body(ok)).staleNote).toBeNull();
  });

  it("prints no rate the sample cannot support", () => {
    const lines = splitLookupText(body(insufficient));
    for (const sentence of [...lines.cohort, lines.placement]) {
      expect(sentence).not.toContain("%");
      expect(sentence).toContain("n=12");
    }
    /* a computed rate on this sheet always carries a decimal; a bucket label
       ("2–3%") never does, so this catches a percentage without catching the
       cohort key the launch was placed in */
    const everything = Object.values(lines).flat().filter(Boolean).join("\n");
    expect(everything).not.toMatch(/\d+\.\d+\s*%/);
  });

  it("survives a truncated block rather than mislabelling a line", () => {
    const b = body(ok);
    const lines = splitLookupText({ ...b, text: b.text.split("\n").slice(0, 3).join("\n") });
    expect(lines.config).not.toBeNull();
    expect(lines.cohort).toEqual([]);
    expect(lines.placement).toBeNull();
    expect(lines.methodUrl).toBeNull();
  });
});

describe("the address defence, applied twice", () => {
  it("strips a 20-byte address out of anything on its way to the DOM", () => {
    expect(stripAddresses(`launched by ${ADDRESS} today`)).toBe("launched by  today");
    expect(stripAddresses(ADDRESS.toUpperCase().replace("0X", "0x"))).toBe("");
  });

  it("leaves a shortened address alone: it is not a subject, it is a citation", () => {
    expect(stripAddresses("0x23fe54b3…f98fe2")).toBe("0x23fe54b3…f98fe2");
  });
});
