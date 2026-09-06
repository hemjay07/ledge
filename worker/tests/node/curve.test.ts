import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FILL_GRADUATED,
  FILL_UNAVAILABLE,
  SELECTOR_GRADUATED,
  SELECTOR_GRADUATION_THRESHOLD,
  SELECTOR_REAL_QUOTE_RESERVE,
  curveFill,
} from "../../src/curve";
import { RpcClient, MAX_BATCH } from "../../src/rpc";
import { WORKER_ROOT, makeBody } from "./helpers";
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

  it("keeps every card line inside the plate", () => {
    // IBM Plex Mono advances at 0.6 em; the plate is 1200 wide with 64 padding
    for (const t of cardTree(makeBody({ fill }), null).texts) {
      expect(t.text.length * t.size * 0.6, t.text).toBeLessThanOrEqual(1200 - 64 * 2);
    }
  });

  it("prints both figures, never the percentage alone", () => {
    const body = makeBody({ fill });
    const text = lookupText(body, null);
    expect(text).toContain(`Curve fill: ${c.expected.filledWei} of ${c.expected.thresholdWei}`);
    expect(text).not.toMatch(/Curve fill: 53\.45%/);
  });

  it("carries the graduated note onto the page and the card", () => {
    const g = CURVES["graduated"]!;
    const body = makeBody({
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
    expect(card).toContain(g.expected.thresholdWei);
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
