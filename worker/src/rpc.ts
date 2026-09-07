/* Batch JSON-RPC, a port of pipeline/rpc.py's proven envelope.

   The four things that are not negotiable, each learned the hard way and each
   restated here because the Worker shares an RPC with the hourly Python:

     1. `User-Agent: ledge/1.0` is REQUIRED. Without it the endpoint answers
        403 to every request.
     2. Batches are at most 50 requests, with 2.0 s between batches.
     3. A 429 arrives as a single object where an array was requested. That is
        a transport fault, never data, and it is retried -- or, in the tick,
        skipped so the next minute covers a wider window.
     4. Batch responses are matched back to requests by `id`, never
        positionally. A short or reordered array would shift every later
        result onto the wrong block.

   eth_getLogs windows stay at 1,000 blocks: the public endpoint rate-limits
   anything wider (PONS_CONTRACTS.md, crawl proof). */

export const MAX_BATCH = 50;
export const BATCH_PACING_MS = 2000;
export const LOG_WINDOW_BLOCKS = 1000;
export const USER_AGENT = "ledge/1.0 (+https://ledge.tools)";
const RETRYABLE_HTTP = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 8000;
const TIMEOUT_MS = 20_000;

export class RpcUnavailable extends Error {
  readonly rateLimited: boolean;
  constructor(message: string, rateLimited = false) {
    super(message);
    this.name = "RpcUnavailable";
    this.rateLimited = rateLimited;
  }
}

export class MalformedBatchResponse extends Error {}

export interface RpcRequest {
  method: string;
  params: unknown[];
}

interface TransportFault {
  code: number;
  message: string;
}

/** Injectable so tests never touch the network. */
export type Transport = (payload: unknown[]) => Promise<unknown>;

function isFault(response: unknown): response is TransportFault {
  return (
    typeof response === "object" &&
    response !== null &&
    !Array.isArray(response) &&
    typeof (response as TransportFault).code === "number" &&
    RETRYABLE_HTTP.has((response as TransportFault).code)
  );
}

export function isRateLimited(response: unknown): boolean {
  return isFault(response) && response.code === 429;
}

/** Match a batch response back to its requests by `id`. Anything that cannot
    be matched is refused rather than zipped positionally. */
export function indexBatchResponse(response: unknown, expected: number): unknown[] {
  if (!Array.isArray(response)) {
    throw new MalformedBatchResponse(
      `expected an array of ${expected} responses, got ${typeof response}`,
    );
  }
  if (response.length !== expected) {
    throw new MalformedBatchResponse(`expected ${expected} responses, got ${response.length}`);
  }
  const byId = new Map<number, Record<string, unknown>>();
  for (const item of response) {
    if (typeof item !== "object" || item === null || !("id" in item)) {
      throw new MalformedBatchResponse("batch response item carries no id");
    }
    const id = (item as { id: number }).id;
    if (byId.has(id)) throw new MalformedBatchResponse(`duplicate id ${id} in batch response`);
    byId.set(id, item as Record<string, unknown>);
  }
  const out: unknown[] = [];
  for (let i = 0; i < expected; i++) {
    const item = byId.get(i);
    if (item === undefined) throw new MalformedBatchResponse(`batch response missing id ${i}`);
    out.push(item["result"]);
  }
  return out;
}

function httpTransport(url: string): Transport {
  return async (payload) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Required. The endpoint answers 403 without it.
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify(payload),
        signal: controller.signal, // lint-copy:allow — AbortController, not copy
      });
      if (!response.ok) {
        if (RETRYABLE_HTTP.has(response.status)) {
          return { code: response.status, message: `HTTP ${response.status}` };
        }
        throw new RpcUnavailable(`rpc: HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof RpcUnavailable) throw error;
      return { code: 503, message: `transport: ${String(error)}` };
    } finally {
      clearTimeout(timer);
    }
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class RpcClient {
  private readonly transport: Transport;
  /** True once any request in this client's lifetime hit a 429. The tick reads
      it to decide whether to hold the cursor rather than record a failure. */
  rateLimitSeen = false;

  /** A second endpoint tried only after the first has given up. The
      official RPC rate-limits Cloudflare's shared egress addresses hard;
      a fallback keeps a lookup honest-but-answered instead of rpc_down. */
  private readonly fallback: Transport | null;

  constructor(url: string, transport?: Transport, fallbackUrl?: string, fallbackTransport?: Transport) {
    this.transport = transport ?? httpTransport(url);
    this.fallback = fallbackTransport ?? (fallbackUrl && fallbackUrl !== url ? httpTransport(fallbackUrl) : null);
  }

  private async sendWithRetry(
    payload: unknown[],
    validate?: (response: unknown) => unknown[],
  ): Promise<unknown> {
    try {
      return await this.sendVia(this.transport, payload, validate);
    } catch (error) {
      if (!(error instanceof RpcUnavailable) || this.fallback === null) throw error;
      return await this.sendVia(this.fallback, payload, validate);
    }
  }

  private async sendVia(
    transport: Transport,
    payload: unknown[],
    validate?: (response: unknown) => unknown[],
  ): Promise<unknown> {
    let delay = BACKOFF_BASE_MS;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const response = await transport(payload);
      if (isFault(response)) {
        if (response.code === 429) this.rateLimitSeen = true;
        if (attempt === MAX_RETRIES - 1) {
          throw new RpcUnavailable(`rpc: gave up: ${response.message}`, response.code === 429);
        }
        await sleep(delay);
        delay = Math.min(delay * 2, BACKOFF_CAP_MS);
        continue;
      }
      if (!validate) return response;
      try {
        return validate(response);
      } catch (error) {
        if (!(error instanceof MalformedBatchResponse)) throw error;
        if (attempt === MAX_RETRIES - 1) {
          throw new RpcUnavailable(`rpc: malformed batch response: ${error.message}`);
        }
        await sleep(delay);
        delay = Math.min(delay * 2, BACKOFF_CAP_MS);
      }
    }
    throw new RpcUnavailable("rpc: gave up after repeated transport faults");
  }

  /** Chunked at MAX_BATCH with BATCH_PACING_MS between chunks. */
  async callBatch(requests: RpcRequest[]): Promise<unknown[]> {
    const results: unknown[] = [];
    const chunks: RpcRequest[][] = [];
    for (let i = 0; i < requests.length; i += MAX_BATCH) {
      chunks.push(requests.slice(i, i + MAX_BATCH));
    }
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c] as RpcRequest[];
      const payload = chunk.map((r, i) => ({
        jsonrpc: "2.0",
        id: i,
        method: r.method,
        params: r.params,
      }));
      const expected = chunk.length;
      const part = (await this.sendWithRetry(payload, (response) =>
        indexBatchResponse(response, expected),
      )) as unknown[];
      results.push(...part);
      if (c < chunks.length - 1) await sleep(BATCH_PACING_MS);
    }
    return results;
  }

  async getHeadBlock(): Promise<number> {
    const response = (await this.sendWithRetry([
      { jsonrpc: "2.0", id: 0, method: "eth_blockNumber", params: [] },
    ])) as Array<{ result?: string }>;
    const head = response[0]?.result;
    if (!head) throw new RpcUnavailable("rpc: eth_blockNumber gave no result");
    return Number(BigInt(head));
  }

  /** A per-item error, or an item with no `result` at all, must never be read
      as an empty window: only an explicit result is an answer. */
  /** `address` is nullable on purpose. Factory events (TokenLaunched,
      PoolGraduated) are filtered by the factory address and must be. Curve
      events cannot be: every launch has its own curve, so there is no address
      to filter by and the filter is topic0 alone, with the emitting curve read
      out of each log's own `address` field (RESEARCH-PHASE2-3.md section 0). */
  async getLogs(
    fromBlock: number,
    toBlock: number,
    address: string | null,
    topic0: string,
  ): Promise<unknown[]> {
    const payload = [
      {
        jsonrpc: "2.0",
        id: 0,
        method: "eth_getLogs",
        params: [
          {
            fromBlock: "0x" + fromBlock.toString(16),
            toBlock: "0x" + toBlock.toString(16),
            address,
            topics: [topic0],
          },
        ],
      },
    ];
    const response = (await this.sendWithRetry(payload)) as Array<Record<string, unknown>>;
    const item = Array.isArray(response) ? response[0] : undefined;
    if (item && !("error" in item) && "result" in item) {
      return (item["result"] as unknown[]) ?? [];
    }
    throw new RpcUnavailable(`rpc: eth_getLogs gave no result: ${JSON.stringify(item)}`);
  }

  async ethCall(to: string, data: string): Promise<string | null> {
    const results = await this.callBatch([
      { method: "eth_call", params: [{ to, data }, "latest"] },
    ]);
    const result = results[0];
    return typeof result === "string" ? result : null;
  }
}
