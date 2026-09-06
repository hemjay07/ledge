/* The /t/{address} shell.

   Static export cannot produce per-address HTML for an unbounded address
   space, and one static shell can only carry one og:image -- which would make
   every card unfurl identically. So this is rendered per request, proxied
   through Vercel so the shareable URL stays on the apex domain (section 4).

   It is a shell with baked meta and the facts in the HTML itself: they are there
   the HTML for a reader with no scripting and for an unfurler, and the page
   hydrates from /api/token/{a} for everyone else. */

import type { TokenResponse } from "./schema";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function tokenShell(
  body: Omit<TokenResponse, "text">,
  text: string,
  title: string,
  siteOrigin: string,
): string {
  const address = body.address;
  const ogImage = `${siteOrigin}/og/t/${address}.png`;
  const canonical = `${siteOrigin}/t/${address}`;
  const facts = text.split("\n").map((line) => `<p>${escapeHtml(line)}</p>`).join("\n      ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — LEDGE</title>
<link rel="canonical" href="${canonical}">
<meta name="description" content="${escapeHtml(title)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(text.split("\n")[3] ?? title)}">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${ogImage}">
<style>
  :root { --ground: #EFEAE0; --ink: #16130F; --ink-muted: #57503F; --stale: #B3321C; }
  html { background: var(--ground); color: var(--ink); }
  body { margin: 0; padding: 48px 24px; font: 16px/1.55 "IBM Plex Mono", ui-monospace, monospace; }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size: 1rem; font-weight: 600; letter-spacing: 0.28em; margin: 0 0 2rem; }
  p { margin: 0 0 0.9rem; }
  hr { border: 0; border-top: 2px solid var(--ink); margin: 2rem 0 1rem; }
  footer { color: var(--ink-muted); font-size: 0.85rem; }
  a { color: inherit; }
  .stale { color: var(--stale); }
</style>
</head>
<body>
  <main>
    <h1>LEDGE.TOOLS</h1>
    <div id="fact">
      ${facts}
    </div>
    <hr>
    <footer>
      <p>${escapeHtml(body.address)}</p>
      <p><a href="${siteOrigin}/method">${siteOrigin}/method</a></p>
    </footer>
  </main>
  <script type="application/json" id="ledge-data">${JSON.stringify(body).replace(/</g, "\\u003c")}</script>
</body>
</html>`;
}
