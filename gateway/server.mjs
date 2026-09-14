// The RPC gateway's front door. Policy lives in core.mjs; this file only
// decides who may ask and how the answer travels.
//
//   POST /          a JSON-RPC request or batch, under 1 MB. From the box
//                   itself (loopback) no key is needed; from anywhere else
//                   the request must carry the shared key in X-Ledge-Key.
//                   The firewall admits the port from Cloudflare's published
//                   ranges only (ops/README.md), so the key is the second
//                   lock, not the only one.
//   GET  /metrics   counters, loopback only: requests, cache hits, and per
//                   upstream ok / refused / busy / failed. Also logged once a
//                   minute so the journal shows rate-limit pressure without
//                   anyone asking.
//
// Environment (/etc/ledge/gateway.env on the box): GATEWAY_UPSTREAM (the
// primary endpoint), GATEWAY_UPSTREAM_FALLBACK (optional second),
// GATEWAY_KEY (the shared key; required unless GATEWAY_LOOPBACK_ONLY=1),
// PORT (8545), GATEWAY_MIN_INTERVAL_MS (150), GATEWAY_CONCURRENCY (3). The
// names differ from the crawl's RPC_URL on purpose: the crawl's RPC_URL now
// points at this gateway, and the gateway must never read it as its own
// upstream and forward to itself.

import http from "node:http";
import { createGateway } from "./core.mjs";

const MAX_BODY = 1_000_000;

export function startServer(env = process.env, listen = true) {
  const upstreams = [env.GATEWAY_UPSTREAM, env.GATEWAY_UPSTREAM_FALLBACK].filter(Boolean);
  const key = env.GATEWAY_KEY ?? "";
  if (upstreams.length === 0) throw new Error("gateway: GATEWAY_UPSTREAM is required");
  if (!key && env.GATEWAY_LOOPBACK_ONLY !== "1") throw new Error("gateway: GATEWAY_KEY is required (or GATEWAY_LOOPBACK_ONLY=1)");

  const gateway = createGateway({
    upstreams,
    minIntervalMs: Number(env.GATEWAY_MIN_INTERVAL_MS ?? 150),
    concurrency: Number(env.GATEWAY_CONCURRENCY ?? 3),
  });

  const isLoopback = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
  const reply = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/metrics") {
      if (!isLoopback(req)) return reply(res, 404, {});
      return reply(res, 200, gateway.metrics());
    }
    if (req.method !== "POST" || req.url !== "/") return reply(res, 404, {});
    if (!isLoopback(req) && (!key || req.headers["x-ledge-key"] !== key)) {
      console.log(`gateway: refused ${req.socket.remoteAddress} (no key)`);
      return reply(res, 401, {});
    }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reply(res, 413, {}); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (res.writableEnded) return;
      let parsed;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return reply(res, 400, { error: "not JSON" }); }
      try {
        const out = await gateway.handle(parsed);
        return reply(res, out.status, out.body);
      } catch (error) {
        console.error(`gateway: ${String(error).slice(0, 200)}`);
        return reply(res, 500, { error: "gateway failure" });
      }
    });
  });

  let ticker = null;
  if (listen) {
    const port = Number(env.PORT ?? 8545);
    server.listen(port, "0.0.0.0", () => console.log(`gateway: listening on ${port}, upstreams ${upstreams.map((u) => new URL(u).host).join(", ")}`));
    ticker = setInterval(() => {
      const m = gateway.metrics();
      console.log(`gateway: requests=${m.requests} items=${m.items} cache=${m.cache.hits}/${m.cache.misses} retries=${m.retries} exhausted=${m.exhausted} ` +
        m.upstreams.map((u) => `${new URL(u.url).host} ok=${u.ok} refused=${u.refused} busy=${u.busy} failed=${u.failed}`).join(" | "));
    }, 60_000);
    ticker.unref();
  }
  return { server, gateway, stop: () => { if (ticker) clearInterval(ticker); server.closeAllConnections(); server.close(); } };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) startServer();
