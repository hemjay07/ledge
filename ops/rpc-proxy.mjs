// The RPC relay: the Worker reaches the chain through the box.
//
// 2026-09-13: both public endpoints refused Cloudflare's shared egress for
// an hour (the tick failed 39 times in a row with "rate limited"; a lookup
// answered rpc_down) while the same endpoints answered this box in 0.3 s.
// The Worker's indexing and lookups therefore leave from here: one steady
// address, the same User-Agent the endpoints require.
//
// It is not an open proxy. It accepts one thing -- a POST whose body is a
// JSON-RPC request or batch, under 1 MB, carrying the shared key in
// X-Ledge-Key -- and forwards it, unchanged, to the configured upstream
// (RPC_URL), trying RPC_URL_FALLBACK once if the upstream cannot be reached
// at all. Everything else is refused before any upstream call. The
// firewall (ops/README.md) admits port 8545 from Cloudflare's published
// ranges only, so the key is the second lock, not the only one.
//
// Plain HTTP: the box has no domain and Workers will not accept a
// self-signed certificate. The key is therefore a capability to use this
// relay and nothing more -- it unlocks no data, only egress -- and is
// rotated by writing a new one to /etc/ledge/proxy.env and the Worker
// secret. RPC_PROXY_KEY, RPC_URL, RPC_URL_FALLBACK come from the
// environment; PORT defaults to 8545.

import http from "node:http";

const PORT = Number(process.env.PORT ?? 8545);
const KEY = process.env.RPC_PROXY_KEY ?? "";
const UPSTREAM = process.env.RPC_URL ?? "";
const FALLBACK = process.env.RPC_URL_FALLBACK ?? "";
const USER_AGENT = "ledge/1.0 (+https://ledge.tools)";
const MAX_BODY = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 25_000;

if (!KEY || !UPSTREAM) {
  console.error("rpc-proxy: RPC_PROXY_KEY and RPC_URL are required");
  process.exit(2);
}

function reply(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

async function forward(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body,
      signal: controller.signal,
    });
    return { status: upstream.status, text: await upstream.text() };
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/") return reply(res, 404, "{}");
  if (req.headers["x-ledge-key"] !== KEY) {
    console.log(`rpc-proxy: refused ${req.socket.remoteAddress} (no key)`);
    return reply(res, 401, "{}");
  }

  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      reply(res, 413, "{}");
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", async () => {
    if (res.writableEnded) return;
    const body = Buffer.concat(chunks).toString("utf8");
    try {
      const parsed = JSON.parse(body);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      if (!items.every((i) => i && typeof i === "object" && typeof i.method === "string")) {
        return reply(res, 400, "{}");
      }
    } catch {
      return reply(res, 400, "{}");
    }
    try {
      let out = await forward(UPSTREAM, body);
      // One line per refused answer, so a rate limit upstream is visible in
      // the journal rather than only in the Worker's health counter.
      if (out.status !== 200 || process.env.RPC_PROXY_LOG_ALL) {
        console.log(`rpc-proxy: ${req.socket.remoteAddress} upstream ${out.status} for ${body.slice(0, 80)}`);
      }
      // 2026-09-14 00:10Z: the official endpoint answered a tick's ~50
      // eth_getLogs with 200 and then its block-header batch with 429, from
      // this box. A refused answer is tried once on the other endpoint; the
      // Worker never retries a 429 inside a tick (worker/src/rpc.ts), so
      // without this every catch-up tick died at the same step.
      if ((out.status === 429 || out.status >= 500) && FALLBACK) {
        const second = await forward(FALLBACK, body);
        console.log(`rpc-proxy: fallback ${second.status} after ${out.status}`);
        out = second;
      }
      return reply(res, out.status, out.text);
    } catch (primaryError) {
      if (!FALLBACK) return reply(res, 502, JSON.stringify({ code: 502, message: String(primaryError) }));
      try {
        const out = await forward(FALLBACK, body);
        return reply(res, out.status, out.text);
      } catch (fallbackError) {
        return reply(res, 502, JSON.stringify({ code: 502, message: String(fallbackError) }));
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`rpc-proxy: listening on ${PORT}, upstream ${new URL(UPSTREAM).host}`);
});
