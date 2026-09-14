import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "../server.mjs";

function upstream() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const items = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(items.map((i) => ({ jsonrpc: "2.0", id: i.id, result: "0x1" }))));
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close(); } })));
}

async function listening(env) {
  const s = startServer(env, false);
  await new Promise((r) => s.server.listen(0, "127.0.0.1", r));
  return { ...s, base: `http://127.0.0.1:${s.server.address().port}` };
}

const RPC = JSON.stringify([{ jsonrpc: "2.0", id: 0, method: "eth_blockNumber", params: [] }]);

test("a loopback caller needs no key; /metrics answers on loopback", async () => {
  const up = await upstream();
  const s = await listening({ GATEWAY_UPSTREAM: up.url, GATEWAY_KEY: "k" });
  const r = await fetch(`${s.base}/`, { method: "POST", body: RPC, headers: { "Content-Type": "application/json" } });
  assert.equal(r.status, 200);
  assert.equal((await r.json())[0].result, "0x1");
  const m = await (await fetch(`${s.base}/metrics`)).json();
  assert.equal(m.requests, 1);
  s.stop(); up.close();
});

test("refuses a body that is not JSON, and anything but POST /", async () => {
  const up = await upstream();
  const s = await listening({ GATEWAY_UPSTREAM: up.url, GATEWAY_KEY: "k" });
  assert.equal((await fetch(`${s.base}/`, { method: "POST", body: "nope" })).status, 400);
  assert.equal((await fetch(`${s.base}/other`, { method: "POST", body: RPC })).status, 404);
  assert.equal((await fetch(`${s.base}/`)).status, 404);
  s.stop(); up.close();
});

test("starts only with an upstream and a key", async () => {
  assert.throws(() => startServer({}, false), /GATEWAY_UPSTREAM/);
  assert.throws(() => startServer({ GATEWAY_UPSTREAM: "http://x" }, false), /GATEWAY_KEY/);
  const s = startServer({ GATEWAY_UPSTREAM: "http://x", GATEWAY_LOOPBACK_ONLY: "1" }, false);
  s.stop();
});
