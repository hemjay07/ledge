#!/usr/bin/env node
/* Measures the exported pages in headless Chrome: horizontal overflow at each
   width, contrast-bearing token values, and the stale state. */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";

const ROOT = join(process.cwd(), "out");
const CHROME =
  process.env.LEDGE_CHROME ??
  "/Users/mujeeb/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.77/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain",
};

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = [join(ROOT, url), join(ROOT, url + ".html"), join(ROOT, url, "index.html")].find(
    (p) => existsSync(p) && statSync(p).isFile(),
  );
  if (!file) return void res.writeHead(404).end("not found");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const chrome = spawn(CHROME, [
  "--headless=old", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  "--remote-debugging-port=9333", "about:blank",
]);
await new Promise((r) => setTimeout(r, 1500));

const version = await (await fetch("http://127.0.0.1:9333/json/version")).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);

async function measure(path, width, theme) {
  await send("Emulation.setDeviceMetricsOverride",
    { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 }, sessionId);
  await send("Page.navigate", { url: `${base}${path}` }, sessionId);
  await new Promise((r) => setTimeout(r, 900));
  const expr = `(() => {
    document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)});
    const cs = getComputedStyle(document.documentElement);
    const over = [...document.querySelectorAll("*")]
      .filter(el => el.scrollWidth > el.clientWidth + 1)
      .filter(el => !el.classList.contains("vh"))
      .filter(el => getComputedStyle(el).overflowX !== "auto")
      .map(el => el.tagName + "." + el.className + " " + el.scrollWidth + ">" + el.clientWidth);
    const scrollers = [...document.querySelectorAll(".scroller")]
      .filter(el => el.scrollWidth > el.clientWidth + 1).length;
    return JSON.stringify({
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      overflowing: over.slice(0, 5),
      scrollersOverflowing: scrollers,
      ground: cs.getPropertyValue("--ground").trim(),
      ink: cs.getPropertyValue("--ink").trim(),
      figure: (() => { const f = document.querySelector(".figure");
        return f ? getComputedStyle(f).fontFamily.split(",")[0] : null; })(),
      staleHidden: (() => { const s = document.querySelector(".stale-slip");
        return s ? s.hidden : null; })(),
      h1: document.querySelectorAll("h1").length,
    });
  })()`;
  const { result } = await send("Runtime.evaluate", { expression: expr, awaitPromise: true }, sessionId);
  return JSON.parse(result.value);
}

for (const path of ["/", "/cohorts", "/method", "/number", "/404.html"]) {
  for (const width of [390, 768, 1280, 1920]) {
    const theme = width === 390 ? "dark" : "light";
    const r = await measure(path, width, theme);
    const ok = r.docScrollWidth <= r.innerWidth && r.overflowing.length === 0;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${path.padEnd(12)} ${String(width).padStart(4)}px  ` +
        `scrollWidth=${r.docScrollWidth} inner=${r.innerWidth} ` +
        `scrollers-overflowing=${r.scrollersOverflowing} h1=${r.h1} ` +
        `ground=${r.ground} figure=${r.figure ?? "-"} stale-hidden=${r.staleHidden}` +
        (r.overflowing.length ? `\n     overflow: ${r.overflowing.join(" | ")}` : ""),
    );
  }
}

ws.close();
chrome.kill();
server.close();
