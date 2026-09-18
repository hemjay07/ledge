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
//     whose toBlock is below that same line. Never a null: an upstream that
//     lacks a block answers null, and the next upstream may have it. The head is learnt from
//     eth_blockNumber answers passing through (and refreshed on demand).
//   - Each upstream is paced: at most `concurrency` in flight and at least
//     `minIntervalMs` between sends. The official endpoint refused a
//     block-header batch after ~50 calls in 30 s from this box
//     (2026-09-14 00:10Z); pacing is what keeps a burst from becoming one.
//   - A batch is served item by item from the cache; only the misses go
//     upstream, and the answer is reassembled in the caller's order and ids.

const USER_AGENT = "ledge/1.0 (+https://ledge.tools)";
const BUSY_CODES = new Set([-32005]);
/* A -32000 whose message is the endpoint's own upstream timing out ("Post
   http://10.x.x.x:8547/rpc: context deadline exceeded", 2026-09-18, 275
   tick passes lost in twelve hours) is a refusal in everything but its
   code: the endpoint did not answer the question. Any other -32000 (a
   range too large, an unknown block) is an answer and is passed through. */
const TRANSIENT_MESSAGE = /context deadline exceeded|timeout|timed out|deadline/i;
const isTransient = (e) => !!e && (BUSY_CODES.has(e.code) || (e.code === -32000 && TRANSIENT_MESSAGE.test(String(e.message ?? ""))));
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

/* Bounded by bytes, not entries: a cached 1,000-block log range is a few
   hundred kilobytes, a header a few hundred bytes, and the box has 1 GB
   of memory in total (2026-09-14 01:10Z: the gateway had grown to 218 MB
   in 35 minutes under an entry cap, and the kernel killed the probe's
   recompute beside it). Size is the JSON length of what is stored. */
class Lru {
  constructor(maxBytes) { this.maxBytes = maxBytes; this.bytes = 0; this.map = new Map(); }
  get(k) {
    if (!this.map.has(k)) return undefined;
    const e = this.map.get(k);
    this.map.delete(k); this.map.set(k, e);
    return e.value;
  }
  set(k, value) {
    const size = JSON.stringify(value).length;
    if (size > this.maxBytes) return;
    if (this.map.has(k)) { this.bytes -= this.map.get(k).size; this.map.delete(k); }
    this.map.set(k, { value, size });
    this.bytes += size;
    while (this.bytes > this.maxBytes && this.map.size > 0) {
      const oldest = this.map.keys().next().value;
      this.bytes -= this.map.get(oldest).size;
      this.map.delete(oldest);
    }
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
    stats: { ok: 0, refused: 0, busy: 0, failed: 0, missing: 0 },
  }));
  if (upstreams.length === 0) throw new Error("gateway: at least one upstream is required");
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const reorgWindow = options.reorgWindow ?? 3000;
  const cache = new Lru(options.cacheBytes ?? 32 * 1024 * 1024);
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
      if (list.some((r) => r?.error && isTransient(r.error))) {
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

  const isNullHeader = (item, a) => item.method === "eth_getBlockByNumber" && a && !a.error && a.result === null;

  /** One batch to the upstreams in order, with the retry passes. A header
      still null after the fill is retried like a refusal, with the same
      backoff (2026-09-16 01:1xZ: the primary refused the tick's batch, the
      fallback held none of the range, the single fill attempt was refused
      too, and the tick got nulls on every pass). What is still null when
      the passes run out is returned null, never cached, for the caller to
      retry. */
  async function forward(items) {
    let lastReason = "no upstream";
    let answers = null;
    let pending = items;
    for (let pass = 0; pass <= retryDelays.length; pass++) {
      if (pass > 0) { metrics.retries += 1; await sleep(retryDelays[pass - 1]); }
      for (const up of upstreams) {
        const out = await sendTo(up, pending);
        if (!out.answers) { lastReason = `${up.url}: ${out.refused}`; continue; }
        const filled = await fillMissingHeaders(pending, out.answers, up);
        answers = answers === null ? filled : answers.map((a) => filled.find((f) => f.id === a.id) ?? a);
        pending = pending.filter((item) => isNullHeader(item, answers.find((a) => a.id === item.id)));
        if (pending.length === 0) return { answers };
        lastReason = `${up.url}: ${pending.length} headers not held`;
        break; // the fill already asked the other upstreams for these; back off before asking again
      }
    }
    metrics.exhausted += 1;
    return answers === null ? { refused: lastReason } : { answers };
  }

  /** A header answered null is not an error to the endpoint -- it simply
      has not received that block yet -- so it never failed over, and the
      tick behind it could not timestamp what it had just read (2026-09-14,
      eight passes in ten minutes). Each null header is asked of the other
      upstreams, alone; what none of them has stays null. */
  async function fillMissingHeaders(items, answers, from) {
    const missing = [];
    items.forEach((item, i) => {
      const a = answers.find((r) => r.id === item.id);
      if (item.method === "eth_getBlockByNumber" && a && !a.error && a.result === null) missing.push({ i, item });
    });
    if (missing.length === 0) return answers;
    from.stats.missing += missing.length;
    let filled = answers.map((a) => ({ ...a }));
    for (const up of upstreams) {
      if (up === from) continue;
      const still = missing.filter((m) => filled.find((r) => r.id === m.item.id)?.result === null);
      if (still.length === 0) break;
      const out = await sendTo(up, still.map((m) => m.item));
      if (!out.answers) continue;
      for (const m of still) {
        const a = out.answers.find((r) => r.id === m.item.id);
        if (a && !a.error && a.result !== null) filled = filled.map((r) => (r.id === m.item.id ? { ...a } : r));
      }
    }
    return filled;
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
        // A null result is "not known here", not a fact: an upstream behind
        // the head, or one that has pruned the block, answers null for a
        // header it will or does have elsewhere. Remembered, it is served
        // forever (2026-09-15 18:03Z: 900 nulls from the fallback, cached
        // while the primary was refusing, stopped the tick and the crawl
        // for seven hours). Only a real answer is stored.
        if (m.key !== null && a.result !== undefined && a.result !== null && !a.error) { cache.set(m.key, { jsonrpc: "2.0", result: a.result }); metrics.cache.stored += 1; }
      });
      noteHead(items, answers.filter(Boolean));
    }
    return { status: 200, body: Array.isArray(body) ? answers : answers[0] };
  }

  return {
    handle,
    metrics: () => ({ ...metrics, head, cacheSize: cache.size, cacheBytes: cache.bytes, upstreams: upstreams.map((u) => ({ url: u.url, ...u.stats })) }),
  };
}
