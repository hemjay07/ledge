import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FILL_GRADUATED,
  FILL_OVER_THRESHOLD,
  FILL_UNAVAILABLE,
  SELECTOR_GRADUATED,
  SELECTOR_GRADUATION_THRESHOLD,
  SELECTOR_REAL_QUOTE_RESERVE,
  curveFill,
} from "../../src/curve";
import { RpcClient, MAX_BATCH } from "../../src/rpc";
import { WORKER_ROOT, makeBody, ON_CHAIN, LAUNCH, fixtureNumber } from "./helpers";

/** The frozen file with every pairTax cell pushed under the gate. */
function fixtureNumberInsufficient() {
  const file = fixtureNumber();
  for (const w of [file.h24, file.allTime]) {
    w.ttg = { ...w.ttg, n: 12, insufficient: true };
    w.cohorts.pairTax = w.cohorts.pairTax!.map((r) => ({
      ...r,
      launches: 12,
      graduations: 0,
      rate: null,
      insufficient: true,
      excludingFast: { ...r.excludingFast, graduations: 0, rate: null, oneIn: null, insufficient: true },
    }));
  }
  return file;
}
import { lookupText } from "../../src/text";
import { collectText, cardTree } from "../../src/card";
import { tokenResponseSchema } from "../../src/schema";

/* Research item R1, as three real curves read from chain 4663 on 2026-09-06
   and recorded in RESEARCH-PHASE2-3.md A2. The wei below are exactly what
   eth_call returned; nothing here is synthetic. */

interface CurveCase {
  why: string;
  token: string;
  curve: string;
  graduated: boolean;
  realQuoteReserve: string;
  graduationThreshold: string;
  expected: { filledWei: string; thresholdWei: string; share: number };
}

const CURVES = JSON.parse(
  readFileSync(join(WORKER_ROOT, "tests", "fixtures", "curves.json"), "utf8"),
) as Record<string, CurveCase>;

function word(value: bigint): string {
  return "0x" + value.toString(16).padStart(64, "0");
}

/** The curve, answering the three views as the chain answered them. Records
    what was asked so the batching and the call order can be asserted. */
function fakeCurve(
  answers: Partial<Record<string, string | null>>,
  seen: { batches: number; selectors: string[]; targets: string[] } = {
    batches: 0,
    selectors: [],
    targets: [],
  },
) {
  const client = new RpcClient("http://unused", async (payload) => {
    const batch = payload as Array<{ id: number; method: string; params: any[] }>;
    seen.batches += 1;
    return batch.map((request) => {
      const data: string = request.params[0].data;
      seen.selectors.push(data);
      seen.targets.push(String(request.params[0].to).toLowerCase());
      return { id: request.id, result: answers[data] ?? null };
    });
  });
  return { client, seen };
}

function answersFor(c: CurveCase): Record<string, string> {
  return {
    [SELECTOR_GRADUATED]: word(c.graduated ? 1n : 0n),
    [SELECTOR_REAL_QUOTE_RESERVE]: word(BigInt(c.realQuoteReserve)),
    [SELECTOR_GRADUATION_THRESHOLD]: word(BigInt(c.graduationThreshold)),
  };
}

describe("the three curves the research decoded", () => {
  for (const [name, c] of Object.entries(CURVES).filter(([k]) => !k.startsWith("_"))) {
    describe(`${name} — ${c.why}`, () => {
      it("reads the fill the chain reported", async () => {
        const { client } = fakeCurve(answersFor(c));
        const fill = await curveFill(client, c.curve, c.graduationThreshold);
        expect(fill).not.toBeNull();
        expect(fill!.filledWei).toBe(c.expected.filledWei);
        expect(fill!.thresholdWei).toBe(c.expected.thresholdWei);
        expect(fill!.share).toBe(c.expected.share);
      });

      it("asks that token's own curve, not a shared address", async () => {
        const { client, seen } = fakeCurve(answersFor(c));
        await curveFill(client, c.curve, c.graduationThreshold);
        expect(new Set(seen.targets)).toEqual(new Set([c.curve.toLowerCase()]));
      });

      it("takes one round trip for all three reads", async () => {
        const { client, seen } = fakeCurve(answersFor(c));
        await curveFill(client, c.curve, c.graduationThreshold);
        expect(seen.batches).toBe(1);
        expect(seen.selectors).toHaveLength(3);
        expect(seen.selectors).toContain(SELECTOR_GRADUATED);
        expect(seen.selectors).toContain(SELECTOR_REAL_QUOTE_RESERVE);
        expect(seen.selectors).toContain(SELECTOR_GRADUATION_THRESHOLD);
        expect(seen.selectors.length).toBeLessThanOrEqual(MAX_BATCH);
      });
    });
  }

  it("pins a graduated curve to a full bar and says where the figure came from", async () => {
    const c = CURVES["graduated"]!;
    const { client } = fakeCurve(answersFor(c));
    const fill = (await curveFill(client, c.curve, c.graduationThreshold))!;
    // the drained curve reports 0; the naive ratio would render 0%, not 100%
    expect(c.realQuoteReserve).toBe("0");
    expect(fill.share).toBe(1);
    expect(fill.note).toBe(FILL_GRADUATED);
  });

  it("keeps a real zero distinguishable from a missing reading", async () => {
    const c = CURVES["dead"]!;
    const { client } = fakeCurve(answersFor(c));
    const fill = (await curveFill(client, c.curve, c.graduationThreshold))!;
    expect(fill.share).toBe(0);
    expect(fill.filledWei).toBe("1"); // one wei survived the fees
    expect(fill.note).toBeNull();
  });

  it("reads the quote side, which is not the token side", async () => {
    const c = CURVES["live"]!;
    const { client } = fakeCurve(answersFor(c));
    const fill = (await curveFill(client, c.curve, c.graduationThreshold))!;
    expect(fill.share).toBe(0.534524);
    // the same curve's token side reads 73.92% at the same instant
    expect(fill.share).not.toBeCloseTo((c as any).tokenSideShareForContrast, 2);
  });
});

describe("the threshold", () => {
  it("is never assumed to be 4.2 ETH", async () => {
    const c = CURVES["dead"]!;
    const { client } = fakeCurve(answersFor(c));
    const fill = (await curveFill(client, c.curve, "4200000000000000000"))!;
    // the curve's own answer wins over anything handed in
    expect(fill.thresholdWei).toBe("8090000000");
  });

  it("falls back to the value the launch event carried when the curve is mute", async () => {
    const { client } = fakeCurve({
      [SELECTOR_GRADUATED]: word(0n),
      [SELECTOR_REAL_QUOTE_RESERVE]: word(1_000_000n),
      [SELECTOR_GRADUATION_THRESHOLD]: null,
    });
    const fill = (await curveFill(client, "0xcurve", "8090000000"))!;
    expect(fill.thresholdWei).toBe("8090000000");
    expect(fill.share).toBe(0.000124);
  });

  it("reports no fill at all rather than dividing by a threshold it does not have", async () => {
    const { client } = fakeCurve({
      [SELECTOR_GRADUATED]: word(0n),
      [SELECTOR_REAL_QUOTE_RESERVE]: word(1n),
      [SELECTOR_GRADUATION_THRESHOLD]: word(0n),
    });
    expect(await curveFill(client, "0xcurve", "0")).toBeNull();
  });

  it("reports no fill for an address that is not a curve", async () => {
    const { client } = fakeCurve({});
    expect(await curveFill(client, "0xnotacurve", "4200000000000000000")).toBeNull();
  });
});

describe("how a fill reaches a reader", () => {
  const c = CURVES["live"]!;
  const fill = {
    filledWei: c.expected.filledWei,
    thresholdWei: c.expected.thresholdWei,
    share: c.expected.share,
    note: null,
  };

  /* USDG carries six decimals, so 8090000000 is 8,090 USDG. The map supplies
     the ticker; decimals.ts supplies the exponent. */
  const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
  const USDG_MAP = { [USDG]: { class: "stable", symbol: "USDG" } };

  it("keeps every card line inside the plate", () => {
    // IBM Plex Mono advances at 0.6 em; the plate is 1200 wide with 64 padding
    for (const t of cardTree(makeBody({ fill }), null).texts) {
      expect(t.text.length * t.size * 0.6, t.text).toBeLessThanOrEqual(1200 - 64 * 2);
    }
  });

  it("prints both quantities in the pair token's own units", () => {
    const text = lookupText(makeBody({ fill }), null);
    // 2245000707691451167 wei is 2.245 ETH, and 4200000000000000000 is 4.2 ETH
    expect(text).toContain("Curve fill: 2.245 ETH of 4.2 ETH (53.5% of the threshold).");
    expect(text).not.toContain("2245000707691451167");
    expect(text).not.toContain("smallest unit");
  });

  it("never lets the share travel without both quantities beside it", () => {
    const body = makeBody({ fill });
    const line = lookupText(body, null)
      .split("\n")
      .find((l) => l.startsWith("Curve fill"))!;
    expect(line).toBe("Curve fill: 2.245 ETH of 4.2 ETH (53.5% of the threshold).");
    expect(body.state.curveFilledShare).toBe(0.534524);
  });

  /* The one case where the share is dropped, and it is about where the line
     sits rather than about the share: three lines under a cohort figure the
     sample cannot support, a percentage invites the misreading the suppression
     exists to prevent. The quantities stay -- they are observations about one
     curve and nothing about them is under-sampled. */
  it("drops the share clause when the cohort's own percentage is suppressed", () => {
    const text = lookupText(makeBody({ fill, numberFile: fixtureNumberInsufficient() }), null);
    expect(text).toContain("not enough data (n=12)");
    expect(text).toContain("Curve fill: 2.245 ETH of 4.2 ETH.");
    expect(text).not.toContain("of the threshold");
    expect(text).not.toMatch(/\d+\.\d+\s*%/);
  });

  it("drops it on the card for the same reason", () => {
    const card = collectText(
      cardTree(makeBody({ fill, numberFile: fixtureNumberInsufficient() }), null),
    );
    expect(card).toContain("Curve fill: 2.245 ETH of 4.2 ETH");
    expect(card).not.toMatch(/\d+\.\d+\s*%/);
  });

  it("keeps the share when the cohort has one of its own to print", () => {
    const card = collectText(cardTree(makeBody({ fill }), null));
    expect(card).toContain("Curve fill: 2.245 ETH of 4.2 ETH (53.5%)");
  });

  /* The share is a Class B ratio and does not go through the sample gate, so
     it must not be suppressed by anything except the placement rule above. */
  it("keeps the share when the cohort is absent but the fill is not", () => {
    const line = lookupText(makeBody({ fill, numberFile: null }), null)
      .split("\n")
      .find((l) => l.startsWith("Curve fill"))!;
    // no cohort at all is still a suppressed cohort: nothing to sit beneath
    expect(line).toBe("Curve fill: 2.245 ETH of 4.2 ETH.");
  });

  it("uses the pair token's decimals, not ETH's", () => {
    const g = CURVES["graduated"]!;
    const text = lookupText(
      makeBody({
        pairDecimals: 6,
        pairTokens: USDG_MAP,
        onChain: { ...ON_CHAIN, pairToken: USDG },
        launch: { ...LAUNCH, pair_token: USDG, pair_class: "stable" },
        fill: {
          filledWei: g.expected.filledWei,
          thresholdWei: g.expected.thresholdWei,
          share: 1,
          note: null,
        },
      }),
      null,
    );
    // 8090000000 at six decimals is 8,090 USDG, not 8.09e-9 ETH.
    // The share clause is absent because this configuration's cohort cell
    // holds n=29 and its own percentage is suppressed — the rule above,
    // firing on a case that was not written to exercise it.
    expect(text).toContain("Curve fill: 8090 USDG of 8090 USDG.");
    expect(text).toContain("not enough data (n=29)");
  });

  it("prints the raw integer and says the units are unknown rather than assuming 18", () => {
    const text = lookupText(makeBody({ fill, pairDecimals: null }), null);
    expect(text).toContain(`Curve fill: ${c.expected.filledWei} of ${c.expected.thresholdWei}`);
    expect(text).toContain("its decimals are not known");
  });

  it("does not round a curve that holds something down to nothing", () => {
    const text = lookupText(
      makeBody({
        pairDecimals: 6,
        fill: { filledWei: "1", thresholdWei: "8090000000", share: 0, note: null },
      }),
      null,
    );
    // one unit of an 8,090-unit threshold: the quantity is shown exactly, and
    // the share says "<0.1%" rather than the "0.0%" six places would give
    // one unit against an 8,090-unit threshold: the quantity is printed
    // exactly, and the share reads "<0.1%" rather than the "0.0%" that six
    // places would give -- a curve holding something must not read as empty
    expect(text).toContain("Curve fill: 0.000001 ETH of 8090 ETH (<0.1% of the threshold).");
    expect(text).not.toContain("Curve fill: 0 ETH");
    expect(text).not.toContain("(0.0% of the threshold)");
  });

  it("carries the graduated note onto the page and the card", () => {
    const g = CURVES["graduated"]!;
    const body = makeBody({
      pairDecimals: 6,
      pairTokens: USDG_MAP,
      fill: {
        filledWei: g.expected.filledWei,
        thresholdWei: g.expected.thresholdWei,
        share: 1,
        note: FILL_GRADUATED,
      },
    });
    expect(lookupText(body, null)).toContain("emptied at graduation");
    // the card carries the short form, which must still say when it filled
    const card = collectText(cardTree(body, null));
    expect(card).toContain("filled to the threshold at graduation");
    // in USDG's own units, not as a raw integer and not at ETH's exponent
    expect(card).toContain("8090");
    expect(card).not.toContain("8090000000");
  });

  it("still says 'fill not available' when the curve could not be read", () => {
    const body = makeBody({ fill: null });
    expect(body.state.fillNote).toBe(FILL_UNAVAILABLE);
    expect(body.state.curveFilledShare).toBeNull();
    expect(collectText(cardTree(body, null))).toContain(FILL_UNAVAILABLE);
  });

  it("refuses a response whose absent fill does not say why", () => {
    const body = makeBody({ fill: null }) as any;
    body.state.fillNote = null;
    expect(tokenResponseSchema.safeParse({ ...body, text: "x" }).success).toBe(false);
  });
});

/* B2 — a per-item RPC error in the fill batch.

   The three reads travel in one batch, and a JSON-RPC batch can fail one item
   and answer the other two. `indexBatchResponse` hands back `undefined` for
   the failed item, which decoded to null, which for a GRADUATED token read as
   "not graduated, holding zero" -- because the curve really does hold zero
   once it has been drained. The sentence then said "0.0% of the threshold"
   about a token that filled all the way. A share the reads do not support is
   not a small error in a number; it is the opposite of what happened. */
describe("a read that did not come back", () => {
  const c = CURVES["graduated"]!;

  /* The endpoint answering the batch, with one item carrying an `error`
     rather than a `result` -- which is what a per-item RPC failure looks
     like on the wire, and what indexBatchResponse turns into `undefined`.
     It is not the same as a curve that answered nothing decodable: that one
     still has its documented fallback, tested above. */
  function faultyCurve(missing: string) {
    const answers = answersFor(c);
    const client = new RpcClient("http://unused", async (payload) => {
      const batch = payload as Array<{ id: number; method: string; params: any[] }>;
      return batch.map((request) => {
        const data: string = request.params[0].data;
        return data === missing
          ? { id: request.id, error: { code: -32000, message: "execution reverted" } }
          : { id: request.id, result: answers[data] ?? null };
      });
    });
    return { client };
  }

  it("never renders a drained graduated curve as nothing", async () => {
    const { client } = faultyCurve((SELECTOR_GRADUATED));
    const fill = (await curveFill(client, c.curve, c.graduationThreshold))!;
    expect(fill.share).toBeNull();
    expect(fill.note).toBeTruthy();

    const body = makeBody({ fill, pairDecimals: 6 });
    expect(body.state.curveFilledShare).toBeNull();
    const text = lookupText(body, null);
    expect(text).not.toContain("0.0% of the threshold");
    expect(text).not.toMatch(/\d+(\.\d+)?%\s+of the threshold/);
  });

  for (const [selector, words] of [
    [SELECTOR_GRADUATED, "whether it had graduated"],
    [SELECTOR_REAL_QUOTE_RESERVE, "the quote it has raised"],
    [SELECTOR_GRADUATION_THRESHOLD, "the threshold it is measured against"],
  ] as const) {
    it(`says in words which read failed: ${words}`, async () => {
      const { client } = faultyCurve((selector));
      const fill = (await curveFill(client, c.curve, c.graduationThreshold))!;
      expect(fill.share).toBeNull();
      expect(fill.note).toContain(words);
      expect(fill.note).not.toMatch(/\d/); // a note, never a number
    });
  }

  it("carries the reason onto the page and the card, and no figure with it", async () => {
    const { client } = faultyCurve((SELECTOR_REAL_QUOTE_RESERVE));
    const fill = (await curveFill(client, c.curve, c.graduationThreshold))!;
    const body = makeBody({ fill, pairDecimals: 6 });
    expect(lookupText(body, null)).toContain("the quote it has raised");
    expect(collectText(cardTree(body, null))).toContain("the quote it has raised");
    expect(tokenResponseSchema.safeParse({ ...body, text: "x" }).success).toBe(true);
  });

  it("still reports nothing at all for an address that answers none of the three", async () => {
    const { client } = fakeCurve({});
    expect(await curveFill(client, "0xnotacurve", "4200000000000000000")).toBeNull();
  });
});

/* B2 — a reserve above the threshold.

   It is a real reading: the curve is read between the buy that crossed the
   threshold and the graduation that empties it. A bare "104.8%" of a
   threshold reads as a broken instrument, so the reading carries a word
   saying what it is. */
describe("a reserve above the threshold", () => {
  async function overFilled() {
    const { client } = fakeCurve({
      [SELECTOR_GRADUATED]: word(0n),
      [SELECTOR_REAL_QUOTE_RESERVE]: word(4_400_000_000_000_000_000n),
      [SELECTOR_GRADUATION_THRESHOLD]: word(4_200_000_000_000_000_000n),
    });
    return (await curveFill(client, "0xcurve", "4200000000000000000"))!;
  }

  it("keeps the share and adds the word", async () => {
    const fill = await overFilled();
    expect(fill.share).toBeGreaterThan(1);
    expect(fill.note).toBe(FILL_OVER_THRESHOLD);
  });

  it("never prints the percentage bare, on the page or on the card", async () => {
    const fill = await overFilled();
    const body = makeBody({ fill });
    const line = lookupText(body, null)
      .split("\n")
      .find((l) => l.startsWith("Curve fill"))!;
    expect(line).toContain("104.8%");
    expect(line).toContain("above the threshold");

    const card = collectText(cardTree(body, null));
    expect(card).toContain("104.8%");
    expect(card).toContain("above the threshold");
  });
});
