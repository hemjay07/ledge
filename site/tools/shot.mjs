#!/usr/bin/env node
/* Screenshots of the exported sheet at two widths and both themes.
   The theme cannot be forced from the command line, so each shot loads the
   page inside a same-origin iframe and stamps data-theme on its root. */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const ROOT = join(process.cwd(), "out");
const SHOTS = join(process.cwd(), "screenshots");
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
  const candidates = [join(ROOT, url), join(ROOT, url + ".html"), join(ROOT, url, "index.html")];
  const file = candidates.find((p) => existsSync(p) && statSync(p).isFile());
  if (!file) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

mkdirSync(SHOTS, { recursive: true });
const tmp = join(ROOT, "__shot");
mkdirSync(tmp, { recursive: true });

const page = process.argv[2] ?? "/";
const height = Number(process.argv[3] ?? 2400);
const targets = [
  { name: "desktop-1280", width: 1280, height },
  { name: "mobile-390", width: 390, height },
];

for (const t of targets) {
  for (const theme of ["light", "dark"]) {
    const wrapper = join(tmp, `${t.name}-${theme}.html`);
    writeFileSync(
      wrapper,
      `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:${theme === "dark" ? "#121110" : "#EFEAE0"}}
iframe{display:block;border:0;width:${t.width}px;height:${t.height}px}</style>
<iframe id="f" src="${base}${page}"></iframe>
<script>
  var f = document.getElementById("f");
  f.addEventListener("load", function () {
    f.contentDocument.documentElement.setAttribute("data-theme", "${theme}");
    var h = f.contentDocument.documentElement.scrollHeight;
    f.style.height = h + "px";
    document.title = "ready-" + h;
  });
</script>`,
    );

    const out = join(SHOTS, `${page === "/" ? "index" : page.slice(1)}-${theme}-${t.name}.png`);
    await run(
      CHROME,
      [
        "--headless=old",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        // the sheet settles once on load; screenshot the settled state
        "--force-prefers-reduced-motion",
        "--hide-scrollbars",
        "--force-device-scale-factor=2",
        `--window-size=${t.width},${t.height}`,
        "--virtual-time-budget=6000",
        `--screenshot=${out}`,
        `${base}/__shot/${t.name}-${theme}.html`,
      ],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 60000 },
    );
    console.log(`shot: ${out}`);
  }
}

rmSync(tmp, { recursive: true, force: true });
server.close();
