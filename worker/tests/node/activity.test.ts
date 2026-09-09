import { describe, expect, it } from "vitest";
import {
  TOPIC_CURVE_BUY,
  TOPIC_CURVE_SELL,
  decodeCurveTrade,
  type CurveTradeLog,
  type RawLog,
} from "../../src/pons";
import { activityBlocks, planActivity, type ActivityRow } from "../../src/activity";

/* The curve index (REPOSITION.md "What has to be built").

   Curves are deployed per launch, so a curve log carries no token: the log's
   own `address` is the curve, and the token is whatever launch deployed it.
   Everything here is that attribution and the per-token counters it feeds.
   Nothing here is a statistic -- these are counts of events about one token,
   with no denominator, and no rate is computed from them anywhere. */

const CURVE_A = "0xef1e0f0110998bd3a293db10b98d4ec57db1c73f";
const CURVE_B = "0xd2414346044d5b597a14f2dd48175cdf0efd642a";
const TOKEN_A = "0x00000000000000000000000000000000000000aa";
const BUYER_1 = "0x2a4d34cd09a36f59ae3bedc0880cd5da929321d7";
const BUYER_2 = "0x000000000000000000000000000000000000b002";

function pad(value: string): string {
  return value.replace(/^0x/, "").padStart(64, "0");
}
function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function buyLog(options: {
  curve: string;
  buyer: string;
  quoteIn: bigint;
  block: number;
  logIndex?: number;
  txHash?: string;
}): RawLog {
  return {
    address: options.curve,
    topics: [TOPIC_CURVE_BUY, "0x" + pad(options.buyer), "0x" + pad(options.buyer)],
    data: "0x" + word(options.quoteIn) + word(1n) + word(0n) + word(0n),
    blockNumber: "0x" + options.block.toString(16),
    transactionHash: options.txHash ?? `0xbuy${options.block}${options.logIndex ?? 0}`,
    logIndex: "0x" + (options.logIndex ?? 0).toString(16),
  };
}

function sellLog(options: {
  curve: string;
  seller: string;
  quoteOut: bigint;
  block: number;
  logIndex?: number;
}): RawLog {
  return {
    address: options.curve,
    topics: [TOPIC_CURVE_SELL, "0x" + pad(options.seller), "0x" + pad(options.seller)],
    data: "0x" + word(7n) + word(options.quoteOut) + word(0n) + word(0n),
    blockNumber: "0x" + options.block.toString(16),
    transactionHash: `0xsell${options.block}${options.logIndex ?? 0}`,
    logIndex: "0x" + (options.logIndex ?? 0).toString(16),
  };
}

const buy = (o: Parameters<typeof buyLog>[0]) => decodeCurveTrade(buyLog(o), "buy");
const sell = (o: Parameters<typeof sellLog>[0]) => decodeCurveTrade(sellLog(o), "sell");

function plan(options: {
  trades: CurveTradeLog[];
  curveToToken?: Map<string, string>;
  launchBlockOf?: Map<string, number>;
  newLaunches?: Map<string, number>;
  existing?: Map<string, ActivityRow>;
  timestamps?: Map<number, number>;
}) {
  const timestamps = options.timestamps ?? new Map<number, number>();
  if (timestamps.size === 0) {
    for (const trade of options.trades) timestamps.set(trade.block, 1_700_000_000 + trade.block);
    for (const block of options.newLaunches?.values() ?? []) {
      timestamps.set(block, 1_700_000_000 + block);
    }
  }
  return planActivity({
    trades: options.trades,
    curveToToken: options.curveToToken ?? new Map([[CURVE_A, TOKEN_A]]),
    launchBlockOf: options.launchBlockOf ?? new Map([[TOKEN_A, 100]]),
    newLaunches: options.newLaunches ?? new Map(),
    existing: options.existing ?? new Map(),
    timestamps,
  });
}

describe("decoding a curve trade", () => {
  /* The real log recorded in RESEARCH-PHASE2-3.md section A3, decoded to the
     figures that document states: quoteIn 726398102277541632, fee exactly 1%
     of it. The curve is the log's own address, never a filter. */
  it("reads a CurveBuy the way the research recorded it", () => {
    const log: RawLog = {
      address: "0xef1e0f0110998bd3a293db10b98d4ec57db1c73f",
      topics: [
        TOPIC_CURVE_BUY,
        "0x0000000000000000000000002a4d34cd09a36f59ae3bedc0880cd5da929321d7",
        "0x0000000000000000000000002a4d34cd09a36f59ae3bedc0880cd5da929321d7",
      ],
      data:
        "0x" +
        word(726_398_102_277_541_632n) +
        word(17_102_047_298_487_729_643_729_400n) +
        word(7_263_981_022_775_416n) +
        word(0n),
      blockNumber: "0x359b33f",
      transactionHash: "0x0a2be9bb",
      logIndex: "0x8",
    };
    const trade = decodeCurveTrade(log, "buy");
    expect(trade.curve).toBe("0xef1e0f0110998bd3a293db10b98d4ec57db1c73f");
    expect(trade.trader).toBe("0x2a4d34cd09a36f59ae3bedc0880cd5da929321d7");
    expect(trade.quoteIn).toBe("726398102277541632");
    expect(trade.quoteOut).toBe("0");
    expect(trade.side).toBe("buy");
    expect(trade.block).toBe(56_210_239);
  });

  it("reads quoteOut out of the second data word of a CurveSell", () => {
    const trade = decodeCurveTrade(
      sellLog({ curve: CURVE_B, seller: BUYER_1, quoteOut: 500n, block: 10 }),
      "sell",
    );
    expect(trade.quoteOut).toBe("500");
    expect(trade.quoteIn).toBe("0");
    expect(trade.curve).toBe(CURVE_B);
  });

  it("names the two topic0s the chain actually emits", () => {
    expect(TOPIC_CURVE_BUY).toBe(
      "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455",
    );
    expect(TOPIC_CURVE_SELL).toBe(
      "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df",
    );
  });
});

describe("attributing a curve log to its token", () => {
  it("counts buys and sells and sums the quote on both sides", () => {
    const { rows } = plan({
      trades: [
        buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: 300n, block: 101 }),
        buy({ curve: CURVE_A, buyer: BUYER_2, quoteIn: 200n, block: 102, logIndex: 1 }),
        sell({ curve: CURVE_A, seller: BUYER_1, quoteOut: 120n, block: 103 }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      token: TOKEN_A,
      buys: 2,
      sells: 1,
      quote_in: "500",
      quote_out: "120",
    });
  });

  /* uint256 does not fit a SQLite INTEGER: 2^63 wei is 9.2 ETH and a curve
     sees far more than that over its life. The sums are decimal strings and
     the addition is BigInt. */
  it("sums past what a 64-bit integer holds", () => {
    const big = 9_000_000_000_000_000_000n;
    const { rows } = plan({
      trades: [
        buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: big, block: 101 }),
        buy({ curve: CURVE_A, buyer: BUYER_2, quoteIn: big, block: 102, logIndex: 1 }),
      ],
    });
    expect(rows[0]?.quote_in).toBe((big + big).toString());
  });

  it("carries the block-header timestamps of the first buy and the last event", () => {
    const { rows } = plan({
      trades: [
        buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: 1n, block: 101 }),
        sell({ curve: CURVE_A, seller: BUYER_1, quoteOut: 1n, block: 140 }),
      ],
    });
    expect(rows[0]?.first_buy_ts).toBe(1_700_000_000 + 101);
    expect(rows[0]?.last_activity_ts).toBe(1_700_000_000 + 140);
  });

  it("adds to the counts a previous pass already wrote", () => {
    const existing = new Map<string, ActivityRow>([
      [
        TOKEN_A,
        {
          token: TOKEN_A,
          from_block: 100,
          buys: 4,
          sells: 1,
          quote_in: "40",
          quote_out: "5",
          first_buy_ts: 1_700_000_050,
          last_activity_ts: 1_700_000_060,
          first_block_buyers: 2,
        },
      ],
    ]);
    const { rows } = plan({
      trades: [buy({ curve: CURVE_A, buyer: BUYER_2, quoteIn: 10n, block: 200 })],
      existing,
    });
    expect(rows[0]).toMatchObject({
      buys: 5,
      sells: 1,
      quote_in: "50",
      first_buy_ts: 1_700_000_050, // the earlier pass's first buy stands
      first_block_buyers: 2,
    });
    expect(rows[0]?.last_activity_ts).toBe(1_700_000_000 + 200);
  });

  it("starts the window at the launch block, not at the first trade", () => {
    const { rows } = plan({
      trades: [buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: 1n, block: 190 })],
    });
    expect(rows[0]?.from_block).toBe(100);
  });
});

/* A curve log whose token we do not hold is not guessed at and not dropped:
   it is counted, so the number of readings LEDGE could not attribute is
   itself observable. */
describe("a curve log LEDGE cannot attribute", () => {
  it("counts it as unattributed rather than dropping it", () => {
    const { rows, unattributed } = plan({
      trades: [
        buy({ curve: CURVE_B, buyer: BUYER_1, quoteIn: 5n, block: 101 }),
        buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: 5n, block: 101, logIndex: 1 }),
      ],
    });
    expect(unattributed).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token).toBe(TOKEN_A);
  });

  it("never invents a token for it", () => {
    const { rows, unattributed } = plan({
      trades: [buy({ curve: CURVE_B, buyer: BUYER_1, quoteIn: 5n, block: 101 })],
      curveToToken: new Map(),
    });
    expect(rows).toEqual([]);
    expect(unattributed).toBe(1);
  });
});

/* The coordination reading ARCHITECTURE.md wanted: how many distinct
   addresses bought in the launch's OWN block. It costs money to fake --
   every one of those buyers paid gas and the snipe tax -- unlike an elapsed
   time, which costs nothing. */
describe("distinct buyers in the launch's first block", () => {
  it("counts each address once however many times it bought", () => {
    const { rows } = plan({
      trades: [
        buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: 1n, block: 100 }),
        buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: 1n, block: 100, logIndex: 1 }),
        buy({ curve: CURVE_A, buyer: BUYER_2, quoteIn: 1n, block: 100, logIndex: 2 }),
        buy({ curve: CURVE_A, buyer: BUYER_2, quoteIn: 1n, block: 101, logIndex: 0 }),
      ],
      newLaunches: new Map([[TOKEN_A, 100]]),
    });
    expect(rows[0]?.first_block_buyers).toBe(2);
    expect(rows[0]?.buys).toBe(4);
  });

  it("records nobody as nobody, which is the finding, not a gap", () => {
    const { rows } = plan({
      trades: [buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: 1n, block: 140 })],
      newLaunches: new Map([[TOKEN_A, 100]]),
    });
    expect(rows[0]?.first_block_buyers).toBe(0);
  });

  it("seeds a row for a launch that saw no trade at all", () => {
    const { rows } = plan({ trades: [], newLaunches: new Map([[TOKEN_A, 100]]) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      token: TOKEN_A,
      buys: 0,
      sells: 0,
      first_block_buyers: 0,
      first_buy_ts: null,
      from_block: 100,
    });
  });

  it("leaves the count unknown when the launch block was never read", () => {
    const { rows } = plan({
      trades: [buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: 1n, block: 900 })],
      launchBlockOf: new Map([[TOKEN_A, 100]]),
    });
    // no newLaunches: this pass did not read block 100, so nothing is claimed
    expect(rows[0]?.first_block_buyers).toBeNull();
  });
});

/* Only the blocks whose header the counters actually need are asked for. A
   header per curve log would be ~560 requests a minute against a budget of
   50 subrequests a tick. */
describe("the headers the counters ask for", () => {
  it("asks for the last block of a token's activity and its first buy", () => {
    const blocks = activityBlocks(
      [
        buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: 1n, block: 101 }),
        buy({ curve: CURVE_A, buyer: BUYER_2, quoteIn: 1n, block: 102, logIndex: 1 }),
        sell({ curve: CURVE_A, seller: BUYER_1, quoteOut: 1n, block: 103 }),
      ],
      new Map([[CURVE_A, TOKEN_A]]),
      new Map(),
    );
    expect([...blocks].sort((a, b) => a - b)).toEqual([101, 103]);
  });

  it("does not ask again for a first buy it already holds", () => {
    const existing = new Map<string, ActivityRow>([
      [
        TOKEN_A,
        {
          token: TOKEN_A,
          from_block: 100,
          buys: 1,
          sells: 0,
          quote_in: "1",
          quote_out: "0",
          first_buy_ts: 1_700_000_050,
          last_activity_ts: 1_700_000_050,
          first_block_buyers: 1,
        },
      ],
    ]);
    const blocks = activityBlocks(
      [buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: 1n, block: 300 })],
      new Map([[CURVE_A, TOKEN_A]]),
      existing,
    );
    expect(blocks).toEqual([300]);
  });

  it("asks for nothing when nothing could be attributed", () => {
    expect(
      activityBlocks(
        [buy({ curve: CURVE_B, buyer: BUYER_1, quoteIn: 1n, block: 101 })],
        new Map(),
        new Map(),
      ),
    ).toEqual([]);
  });
});

/* The whole point of aggregating: ~812,000 curve events a day cannot be
   stored as rows, but the counters they fold into can be replayed from the
   same logs and must agree. */
describe("a replay of the same logs", () => {
  it("reaches the same counters however the logs are split across passes", () => {
    const trades = [
      buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: 11n, block: 100 }),
      buy({ curve: CURVE_A, buyer: BUYER_2, quoteIn: 22n, block: 100, logIndex: 1 }),
      sell({ curve: CURVE_A, seller: BUYER_1, quoteOut: 3n, block: 101 }),
      buy({ curve: CURVE_A, buyer: BUYER_1, quoteIn: 44n, block: 140, logIndex: 2 }),
      sell({ curve: CURVE_A, seller: BUYER_2, quoteOut: 5n, block: 141 }),
    ];
    const wholeInOnePass = plan({ trades, newLaunches: new Map([[TOKEN_A, 100]]) }).rows[0];

    let carried = new Map<string, ActivityRow>();
    for (const slice of [trades.slice(0, 2), trades.slice(2, 4), trades.slice(4)]) {
      const { rows } = plan({
        trades: slice,
        existing: carried,
        newLaunches: carried.size === 0 ? new Map([[TOKEN_A, 100]]) : new Map(),
      });
      carried = new Map(rows.map((row) => [row.token, row]));
    }
    expect(carried.get(TOKEN_A)).toEqual(wholeInOnePass);
  });
});
