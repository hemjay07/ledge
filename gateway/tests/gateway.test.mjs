// Tests for the RPC gateway. Every upstream here is a fake http server on an
// ephemeral port, scripted per test, so nothing touches the chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createGateway } from "../core.mjs";

const HEAD = 62_300_000;

function fakeUpstream(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const items = JSON.parse(body);
      calls.push(items);
      const out = handler(items, calls.length);
      if (typeof out === "number") {
        res.writeHead(out, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `http ${out}` }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => { server.closeAllConnections(); server.close(); } }),
    ),
  );
}

const ok = (items, fn) => items.map((i) => ({ jsonrpc: "2.0", id: i.id, result: fn(i) }));
const busy = (items) =>
  items.map((i) => ({ jsonrpc: "2.0", id: i.id, error: { code: -32005, message: "the network is busy" } }));
const headOf = (i) => (i.method === "eth_blockNumber" ? "0x" + HEAD.toString(16) : "0xabc");
const req = (method, params, id = 0) => ({ jsonrpc: "2.0", id, method, params });

function gw(a, b, extra = {}) {
  return createGateway({
    upstreams: [a.url, b ? b.url : undefined].filter(Boolean),
    minIntervalMs: 0,
    concurrency: 4,
    retryDelaysMs: [1, 2],
    reorgWindow: 3000,
    ...extra,
  });
}

test("answers from the primary when it answers", async () => {
  const a = await fakeUpstream((items) => ok(items, headOf));
  const b = await fakeUpstream((items) => ok(items, () => "0xshouldnot"));
  const g = gw(a, b);
  const out = await g.handle([req("eth_blockNumber", [])]);
  assert.equal(out.status, 200);
  assert.equal(out.body[0].result, "0x" + HEAD.toString(16));
  assert.equal(b.calls.length, 0);
  a.close(); b.close();
});

test("fails over to the second upstream on a 429, and counts it", async () => {
  const a = await fakeUpstream(() => 429);
  const b = await fakeUpstream((items) => ok(items, () => "0x1"));
  const g = gw(a, b);
  const out = await g.handle([req("eth_getBlockByNumber", ["0x10", false])]);
  assert.equal(out.status, 200);
  assert.equal(out.body[0].result, "0x1");
  // two calls hit the primary: the head refresh the cache needs, then the item
  assert.equal(g.metrics().upstreams[0].refused, 2);
  assert.equal(g.metrics().upstreams[1].ok, 2);
  a.close(); b.close();
});

test("treats a JSON-RPC 'busy' body as a refusal and fails over", async () => {
  const a = await fakeUpstream((items) => busy(items));
  const b = await fakeUpstream((items) => ok(items, () => "0x2"));
  const g = gw(a, b);
  const out = await g.handle([req("eth_getLogs", [{ fromBlock: "0x1", toBlock: "0x2", topics: [] }])]);
  assert.equal(out.body[0].result, "0x2");
  assert.equal(g.metrics().upstreams[0].busy, 2); // head refresh + the item
  a.close(); b.close();
});

test("retries with backoff when both refuse, then gives the caller a 503 it can retry", async () => {
  const a = await fakeUpstream(() => 429);
  const b = await fakeUpstream(() => 503);
  const g = gw(a, b);
  const out = await g.handle([req("eth_blockNumber", [])]);
  assert.equal(out.status, 503);
  // retryDelaysMs has two entries: the first pass plus two retries, each
  // trying both upstreams
  assert.equal(a.calls.length, 3);
  assert.equal(b.calls.length, 3);
  a.close(); b.close();
});

test("caches a block header well below the head and never a recent one", async () => {
  const a = await fakeUpstream((items) => ok(items, headOf));
  const g = gw(a);
  await g.handle([req("eth_blockNumber", [])]); // learns the head
  const old = "0x" + (HEAD - 10_000).toString(16);
  const recent = "0x" + (HEAD - 10).toString(16);
  await g.handle([req("eth_getBlockByNumber", [old, false])]);
  await g.handle([req("eth_getBlockByNumber", [old, false])]);
  await g.handle([req("eth_getBlockByNumber", [recent, false])]);
  await g.handle([req("eth_getBlockByNumber", [recent, false])]);
  const forwarded = a.calls.flat().filter((i) => i.method === "eth_getBlockByNumber");
  assert.equal(forwarded.filter((i) => i.params[0] === old).length, 1);
  assert.equal(forwarded.filter((i) => i.params[0] === recent).length, 2);
  assert.equal(g.metrics().cache.hits, 1);
  a.close();
});

test("caches a log range only when its toBlock is below the reorg window", async () => {
  const a = await fakeUpstream((items) => ok(items, headOf));
  const g = gw(a);
  await g.handle([req("eth_blockNumber", [])]);
  const oldRange = { fromBlock: "0x" + (HEAD - 5000).toString(16), toBlock: "0x" + (HEAD - 4001).toString(16), topics: ["0xaa"] };
  const newRange = { fromBlock: "0x" + (HEAD - 600).toString(16), toBlock: "0x" + HEAD.toString(16), topics: ["0xaa"] };
  for (const r of [oldRange, oldRange, newRange, newRange]) await g.handle([req("eth_getLogs", [r])]);
  const forwarded = a.calls.flat().filter((i) => i.method === "eth_getLogs");
  assert.equal(forwarded.length, 3);
  a.close();
});

test("serves the cached part of a batch and forwards only the misses, reassembled by id", async () => {
  const a = await fakeUpstream((items) => ok(items, (i) => (i.method === "eth_blockNumber" ? "0x" + HEAD.toString(16) : "hdr:" + i.params[0])));
  const g = gw(a);
  await g.handle([req("eth_blockNumber", [])]);
  const blocks = [HEAD - 9000, HEAD - 9001, HEAD - 9002].map((n) => "0x" + n.toString(16));
  await g.handle([req("eth_getBlockByNumber", [blocks[0], false], 7)]);
  const out = await g.handle(blocks.map((b, i) => req("eth_getBlockByNumber", [b, false], i + 1)));
  assert.deepEqual(out.body.map((r) => [r.id, r.result]), [[1, "hdr:" + blocks[0]], [2, "hdr:" + blocks[1]], [3, "hdr:" + blocks[2]]]);
  const last = a.calls.at(-1);
  assert.equal(last.length, 2); // only the two misses went upstream
  a.close();
});

test("never caches an error answer", async () => {
  let n = 0;
  const a = await fakeUpstream((items) => (++n === 2 ? items.map((i) => ({ jsonrpc: "2.0", id: i.id, error: { code: -32000, message: "no" } })) : ok(items, headOf)));
  const g = gw(a);
  await g.handle([req("eth_blockNumber", [])]);
  const old = "0x" + (HEAD - 20_000).toString(16);
  const first = await g.handle([req("eth_getBlockByNumber", [old, false])]);
  assert.ok(first.body[0].error);
  await g.handle([req("eth_getBlockByNumber", [old, false])]);
  assert.equal(a.calls.length, 3);
  a.close();
});

test("paces requests to an upstream: no two closer than minIntervalMs", async () => {
  const stamps = [];
  const a = await fakeUpstream((items) => { stamps.push(Date.now()); return ok(items, headOf); });
  const g = gw(a, undefined, { minIntervalMs: 40, concurrency: 1 });
  await Promise.all([1, 2, 3].map(() => g.handle([req("eth_blockNumber", [])])));
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
  assert.ok(gaps.every((x) => x >= 35), `gaps ${gaps}`);
  a.close();
});

test("refuses a body that is not JSON-RPC before any upstream call", async () => {
  const a = await fakeUpstream((items) => ok(items, headOf));
  const g = gw(a);
  const out = await g.handle({ not: "rpc" });
  assert.equal(out.status, 400);
  assert.equal(a.calls.length, 0);
  a.close();
});

test("the cache is bounded by bytes and evicts the oldest entries first", async () => {
  const big = "x".repeat(10_000);
  const a = await fakeUpstream((items) => ok(items, (i) => (i.method === "eth_blockNumber" ? "0x" + HEAD.toString(16) : big + i.params[0])));
  const g = gw(a, undefined, { cacheBytes: 25_000 });
  await g.handle([req("eth_blockNumber", [])]);
  const blocks = [1, 2, 3].map((n) => "0x" + (HEAD - 50_000 - n).toString(16));
  for (const b of blocks) await g.handle([req("eth_getBlockByNumber", [b, false])]);
  const m = g.metrics();
  assert.ok(m.cacheBytes <= 25_000, `cacheBytes ${m.cacheBytes}`);
  assert.equal(m.cacheSize, 2); // the first block was evicted
  await g.handle([req("eth_getBlockByNumber", [blocks[0], false])]);
  assert.equal(g.metrics().cache.hits, 0);
  a.close();
});
