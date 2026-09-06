# `/t/{address}` is not built here

The death card at `ledge.tools/t/{address}` is **rendered by the Cloudflare
Worker**, not by this Next app, and there is deliberately no `page.tsx` in this
directory.

Why: a Next static export cannot produce per-address HTML for an unbounded
address space, and a single static shell can only carry one `og:image` — which
would make every death card unfurl identically and destroy the only thing the
card is for. Serving it from `api.ledge.tools` would work, but the shareable
URL would then be the wrong one: `ledge.tools/t/0x…` is the citation.

How it reaches the apex domain: `site/vercel.json` rewrites

    /t/:address        -> https://api.ledge.tools/t/:address
    /t/:address/og.png -> https://api.ledge.tools/t/:address/og.png
    /og/t/:path*       -> https://api.ledge.tools/og/t/:path*
    /api/:path*        -> https://api.ledge.tools/api/:path*

so the Worker answers on `ledge.tools`, the card's `og:image` is per-address,
and the site's own client fetches are same-origin.

The shell's markup, its baked meta and its `<noscript>` fact block live in
`worker/src/html.ts`; the card image is `worker/src/og.ts`; every sentence on
both comes from `worker/src/text.ts`, the same builder the API and this site's
lookup render from.

Decision and rationale: `ARCHITECTURE-PHASE2-4.md` §4.

Adding a `page.tsx` here would shadow the rewrite with a static file and break
every unfurl. Do not.
