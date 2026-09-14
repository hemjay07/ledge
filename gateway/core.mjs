// The RPC gateway's policy. Everything LEDGE asks the chain goes through
// here: the crawl and the probe from this box, the Worker's tick and lookups
// from Cloudflare. One place decides which upstream answers, how fast, what
// counts as a refusal, and what may be remembered.
//
// Why this exists (INCIDENTS.md, class 2): both public endpoints rate-limit
// and go "busy", each client had its own copy of retry-and-fallback, and on
// 2026-09-13 the same failure was fixed in three files in one day. The
// clients now hold no policy; this module does, once, with tests.
//
// Rules:
//   - A refusal is an HTTP 429 or 5xx, a transport failure, or a JSON-RPC
//     error the endpoint uses to mean "later" (-32005 "the network is
//     busy"). A refused batch is tried on the next upstream; when every
//     upstream refused, the whole pass is retried after a backoff, and the
//     caller finally gets a 503 it may retry itself.
//   - Any other JSON-RPC error is an answer, returned as-is, never cached.
//   - Only answers that cannot change are cached: a block header for a block
//     more than `reorgWindow` below the last seen head, and a log range
//     whose toBlock is below that same line. The head is learnt from
//     eth_blockNumber answers passing through (and refreshed on demand).
//   - Each upstream is paced: at most `concurrency` in flight and at least
//     `minIntervalMs` between sends. The official endpoint refused a
//     block-header batch after ~50 calls in 30 s from this box
//     (2026-09-14 00:10Z); pacing is what keeps a burst from becoming one.
//   - A batch is served item by item from the cache; only the misses go
//     upstream, and the answer is reassembled in the caller's order and ids.

const USER_AGENT = "ledge/1.0 (+https://ledge.tools)";
const BUSY_CODES = new Set([-32005]);
const DEFAULT_RETRY_DELAYS_MS = [500, 1500, 4000];
const HEAD_TTL_MS = 1000;
const UPSTREAM_TIMEOUT_MS = 20_000;

class Pacer {
  constructor(minIntervalMs, concurrency) {
    this.minIntervalMs = minIntervalMs;
    this.concurrency = concurrency;
    this.inFlight = 0;
    this.lastSentAt = 0;
    this.queue = [];
  }
  async acquire() {
    await new Promise((resolve) => {
      this.queue.push(resolve);
      this.#pump();
    });
  }
  release() {
    this.inFlight -= 1;
    this.#pump();
  }
  #pump() {
    if (this.inFlight >= this.concurrency || this.queue.length === 0) return;
    const wait = this.lastSentAt + this.minIntervalMs - Date.now();
    if (wait > 0) {
      if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.#pump(); }, wait);
      return;
    }
    this.inFlight += 1;
    this.lastSentAt = Date.now();
    this.queue.shift()();
    this.#pump();
  }
}

class Lru {
  constructor(max) { this.max = max; this.map = new Map(); }
  get(k) {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k);
    this.map.delete(k); this.map.set(k, v);
    return v;
  }
  set(k, v) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  get size() { return this.map.size; }
}

const hexToInt = (h) => (typeof h === "string" && /^0x[0-9a-fA-F]+$/.test(h) ? parseInt(h, 16) : null);

/** The key under which an item's answer may be remembered, or null when it
    must not be: only headers and log ranges safely below the head. */
function cacheKey(item, head, reorgWindow) {
  if (head === null) return null;
  const safe = head - reorgWindow;
  if (item.method === "eth_getBlockByNumber") {
    const n = hexToInt(item.params?.[0]);
    if (n === null || n > safe) return null;
    return `hdr:${n}:${item.params[1] === true}`;
  }
  if (item.method === "eth_getLogs") {
    const f = item.params?.[0];
    const to = hexToInt(f?.toBlock);
    const from = hexToInt(f?.fromBlock);
    if (to === null || from === null || to > safe) return null;
    return `logs:${from}:${to}:${JSON.stringify(f.address ?? null)}:${JSON.stringify(f.topics ?? null)}`;
  }
  return null;
}

function isRpcItem(i) {
  return i && typeof i === "object" && typeof i.method === "string" && ("id" in i);
}

export function createGateway(options) {
  const upstreams = options.upstreams.map((url, i) => ({
    url,
    index: i,
    pacer: new Pacer(options.minIntervalMs ?? 150, options.concurrency ?? 3),
    stats: { ok: 0, refused: 0, busy: 0, failed: 0 },
  }));
  if (upstreams.length === 0) throw new Error("gateway: at least one upstream is required");
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const reorgWindow = options.reorgWindow ?? 3000;
  const cache = new Lru(options.cacheEntries ?? 50_000);
  const fetchImpl = options.fetch ?? fetch;
  const metrics = { requests: 0, items: 0, cache: { hits: 0, misses: 0, stored: 0 }, retries: 0, exhausted: 0 };
  let head = null;
  let headAt = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function sendTo(up, items) {
    await up.pacer.acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetchImpl(up.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        body: JSON.stringify(items),
        signal: controller.signal,
      });
      if (response.status === 429 || response.status >= 500) {
        up.stats.refused += 1;
        return { refused: `http ${response.status}` };
      }
      if (!response.ok) {
        up.stats.failed += 1;
        return { refused: `http ${response.status}` };
      }
      const body = await response.json();
      const list = Array.isArray(body) ? body : [body];
      if (list.some((r) => r?.error && BUSY_CODES.has(r.error.code))) {
        up.stats.busy += 1;
        return { refused: "busy" };
      }
      up.stats.ok += 1;
      return { answers: list };
    } catch (error) {
      up.stats.failed += 1;
      return { refused: `transport: ${String(error).slice(0, 120)}` };
    } finally {
      clearTimeout(timer);
      up.pacer.release();
    }
  }

  /** One batch to the upstreams in order, with the retry passes. */
  async function forward(items) {
    let lastReason = "no upstream";
    for (let pass = 0; pass <= retryDelays.length; pass++) {
      if (pass > 0) { metrics.retries += 1; await sleep(retryDelays[pass - 1]); }
      for (const up of upstreams) {
        const out = await sendTo(up, items);
        if (out.answers) return { answers: out.answers };
        lastReason = `${up.url}: ${out.refused}`;
      }
    }
    metrics.exhausted += 1;
    return { refused: lastReason };
  }

  function noteHead(items, answers) {
    for (const item of items) {
      if (item.method !== "eth_blockNumber") continue;
      const a = answers.find((r) => r.id === item.id);
      const n = hexToInt(a?.result);
      if (n !== null) { head = n; headAt = Date.now(); }
    }
  }

  async function refreshHead() {
    if (head !== null && Date.now() - headAt < HEAD_TTL_MS) return;
    const out = await forward([{ jsonrpc: "2.0", id: "gw-head", method: "eth_blockNumber", params: [] }]);
    if (out.answers) noteHead([{ id: "gw-head", method: "eth_blockNumber" }], out.answers);
  }

  /** The entry point: the parsed request body in, {status, body} out. */
  async function handle(body) {
    const items = Array.isArray(body) ? body : [body];
    if (items.length === 0 || !items.every(isRpcItem)) return { status: 400, body: { error: "not a JSON-RPC request" } };
    metrics.requests += 1;
    metrics.items += items.length;

    // Cache lookups need a head to reason about; learn it cheaply once.
    if (items.some((i) => i.method === "eth_getBlockByNumber" || i.method === "eth_getLogs")) await refreshHead();

    const answers = new Array(items.length);
    const misses = [];
    items.forEach((item, i) => {
      const key = cacheKey(item, head, reorgWindow);
      const hit = key === null ? undefined : cache.get(key);
      if (hit !== undefined) { metrics.cache.hits += 1; answers[i] = { ...hit, id: item.id }; }
      else { if (key !== null) metrics.cache.misses += 1; misses.push({ i, item, key }); }
    });

    if (misses.length > 0) {
      // Forwarded under fresh ids so two items with the same id in one
      // batch still come back to the right slot.
      const outgoing = misses.map((m, k) => ({ ...m.item, id: k }));
      const out = await forward(outgoing);
      if (!out.answers) return { status: 503, body: { code: 503, message: `gateway: every upstream refused (${out.refused})` } };
      misses.forEach((m, k) => {
        const a = out.answers.find((r) => r.id === k) ?? { jsonrpc: "2.0", id: k, error: { code: -32603, message: "gateway: upstream returned no item" } };
        answers[m.i] = { ...a, id: m.item.id };
        if (m.key !== null && a.result !== undefined && !a.error) { cache.set(m.key, { jsonrpc: "2.0", result: a.result }); metrics.cache.stored += 1; }
      });
      noteHead(items, answers.filter(Boolean));
    }
    return { status: 200, body: Array.isArray(body) ? answers : answers[0] };
  }

  return {
    handle,
    metrics: () => ({ ...metrics, head, cacheSize: cache.size, upstreams: upstreams.map((u) => ({ url: u.url, ...u.stats })) }),
  };
}
