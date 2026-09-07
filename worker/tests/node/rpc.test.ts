import { describe, expect, it, vi } from "vitest";
import { MalformedBatchResponse, RpcClient, USER_AGENT, indexBatchResponse, isRateLimited } from "../../src/rpc";

/* The envelope pipeline/rpc.py proved. Anything here that changes changes the
   shared assumption both indexers rest on. */

describe("the RPC envelope", () => {
  it("declares the User-Agent the endpoint requires", () => {
    // Without it the endpoint answers 403 to every request.
    expect(USER_AGENT).toContain("ledge/1.0");
  });

  it("treats a 429 arriving as an object where an array was requested as a rate limit", () => {
    expect(isRateLimited({ code: 429, message: "slow down" })).toBe(true);
    expect(isRateLimited({ code: 500, message: "boom" })).toBe(false);
    expect(isRateLimited([{ id: 0, result: "0x1" }])).toBe(false);
  });

  it("matches batch responses back to requests by id, never positionally", () => {
    const out = indexBatchResponse(
      [
        { id: 2, result: "c" },
        { id: 0, result: "a" },
        { id: 1, result: "b" },
      ],
      3,
    );
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("refuses a short array rather than shifting every later result", () => {
    expect(() => indexBatchResponse([{ id: 0, result: "a" }], 2)).toThrow(MalformedBatchResponse);
  });

  it("refuses a duplicated id", () => {
    expect(() =>
      indexBatchResponse([{ id: 0, result: "a" }, { id: 0, result: "b" }], 2),
    ).toThrow(MalformedBatchResponse);
  });

  it("chunks a batch at 50 with pacing between chunks", async () => {
    const sizes: number[] = [];
    const client = new RpcClient("http://unused", async (payload) => {
      const batch = payload as Array<{ id: number }>;
      sizes.push(batch.length);
      return batch.map((r) => ({ id: r.id, result: "0x0" }));
    });
    const results = await client.callBatch(
      Array.from({ length: 120 }, () => ({ method: "eth_call", params: [] })),
    );
    expect(sizes).toEqual([50, 50, 20]);
    expect(results).toHaveLength(120);
  }, 20_000);
});


describe("fallback endpoint", () => {
  it("answers from the fallback after the primary gives up on 429", async () => {
    const { RpcClient } = await import("../../src/rpc");
    const primary = async () => ({ code: 429, message: "HTTP 429" });
    const fallback = async (payload: unknown[]) =>
      (payload as { id: number }[]).map((r) => ({ jsonrpc: "2.0", id: r.id, result: "0x10" }));
    const client = new RpcClient("https://primary.invalid", primary, "https://fallback.invalid", fallback);
    vi.useFakeTimers();
    try {
      const pending = client.getHeadBlock();
      await vi.runAllTimersAsync();
      expect(await pending).toBe(16);
    } finally {
      vi.useRealTimers();
    }
    expect(client.rateLimitSeen).toBe(true);
  });

  it("does not consult a fallback for a non-retryable fault", async () => {
    const { RpcClient, RpcUnavailable } = await import("../../src/rpc");
    let fallbackCalls = 0;
    const primary = async () => { throw new RpcUnavailable("rpc: HTTP 403"); };
    const fallback = async () => { fallbackCalls++; return []; };
    const client = new RpcClient("https://primary.invalid", primary, "https://fallback.invalid", fallback);
    await expect(client.getHeadBlock()).rejects.toBeInstanceOf(RpcUnavailable);
    expect(fallbackCalls).toBe(1);
  });
});
