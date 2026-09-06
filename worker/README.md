# worker — the LEDGE live layer

A Cloudflare Worker: a minute indexer, the lookup API, the `/t/{address}` page
and its card, and the Telegram webhook.

**It computes no statistics.** Every rate, share and percentile is defined in
`pipeline/stats.py`, serialised into `data/number.json`, and read here as a
table lookup. `src/lookup.ts`, `src/ladder.ts` and `src/text.ts` are held to
that by `scripts/lint-worker.sh`, and `tests/node/vectors.test.ts` asserts the
TypeScript lands on the same objects and the same sentences Python does.

D1 is canonical for nothing. It answers "when exactly did this token launch",
holds seven days, and is disposable.

## Local

    npm ci
    npm test                        # both suites
    npm run typecheck
    npx wrangler d1 execute LEDGE_DB --local --file=schema.sql
    npm run dev                     # http://localhost:8787

Seed local KV so the cohort figures resolve:

    npx wrangler kv key put --local --binding LEDGE_KV number:current      --path ../data/number.json
    npx wrangler kv key put --local --binding LEDGE_KV pair-tokens:current --path ../data/pair-tokens.json

## Layout

| File | What it is |
|---|---|
| `src/index.ts` | router and `scheduled()` |
| `src/tick.ts` | the minute indexer: logs, headers, dedupe, retention |
| `src/rpc.ts` | batch JSON-RPC, the envelope `pipeline/rpc.py` proved |
| `src/lookup.ts` | chain observations plus verbatim table lookups. No arithmetic |
| `src/ladder.ts` | which step of the published table an elapsed time falls on. No arithmetic |
| `src/text.ts` | the one text builder, shared by the API, `/t`, the card and the bot. No arithmetic |
| `src/format.ts` | the formatting rules, and the only file here that divides |
| `src/card.ts` | the death card as positioned text and as SVG |
| `src/og.ts` | resvg-wasm rasterising |
| `src/schema.ts` | the response contract, with the denominator rules in `superRefine` |
| `src/curve.ts` | the curve-fill seam. Returns null until research R1 lands |
