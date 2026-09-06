# Deploying LEDGE

Everything below is a one-time step you run yourself. Nothing in the repo holds a key. Order matters only where stated.

## 0. Accounts

- GitHub: the repo `hemjay07/ledge`, public (the dataset is the product; Actions minutes are unlimited on public repos).
- Vercel: one project, root directory `site/`, framework Next.js, output `out/` (static export).
- Cloudflare: free plan; the domain `ledge.tools` on Cloudflare DNS is simplest, since the Worker needs `api.ledge.tools`.
- Resend (weekly dispatch only): free tier.
- Telegram: a bot from @BotFather (optional).

## 1. Repository

```bash
cd /Users/mujeeb/ledge
gh auth switch --user hemjay07
gh repo create hemjay07/ledge --public --source=. --push
```

Then in the repo settings, Actions → General → Workflow permissions: read and write (the crawl commits data).

Run the crawl once by hand: Actions → `crawl` → Run workflow. It should commit `data/` within ~5 minutes. If the RPC 403s from GitHub's runners, set the repo variable `RPC_URL` to an alternative endpoint.

## 2. Site (Vercel)

1. Import the repo. Root directory `site/`. Build command `npm run build` (prebuild copies `number.json` and renders the card). Output `out/`.
2. Settings → Git → Ignored Build Step: leave empty. Data-only commits must rebuild.
3. Domains: `ledge.tools` and `www.ledge.tools`.
4. After the first deploy, open `/number.json` and confirm `crawledAt` equals the latest data commit.

`site/vercel.json` already rewrites `/api/*`, `/t/*`, `/og/t/*` to `https://api.ledge.tools`. Until the Worker exists those routes 502; the rest of the site is unaffected.

## 3. Worker (Cloudflare)

```bash
cd worker
wrangler login
wrangler d1 create ledge                       # paste database_id into wrangler.toml
wrangler kv namespace create LEDGE_KV          # paste id into wrangler.toml
wrangler d1 execute LEDGE_DB --remote --file=schema.sql
wrangler kv key put --binding LEDGE_KV number:current      --path ../data/number.json
wrangler kv key put --binding LEDGE_KV pair-tokens:current --path ../data/pair-tokens.json
npm run sync-fonts && wrangler deploy
```

Then Workers → the `ledge` worker → Settings → Domains: add `api.ledge.tools`.

Security → WAF → Rate limiting rule: 60 requests per minute per IP on paths starting `/api/` and `/og/`.

Check: `https://api.ledge.tools/api/health`, then `/api/token/<any address from data/launches>`.

Keeping the Worker's copy of `number.json` current: until the KV-push job exists (not built yet), the Worker falls back to fetching `https://ledge.tools/number.json`, which is always current after each Vercel deploy. Nothing to do.

### Telegram (optional)

```bash
wrangler secret put TELEGRAM_BOT_TOKEN        # from @BotFather
wrangler secret put TELEGRAM_WEBHOOK_SECRET   # openssl rand -hex 32
wrangler secret put TELEGRAM_HEADER_SECRET    # openssl rand -hex 32
curl "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d "url=https://api.ledge.tools/tg/$TELEGRAM_WEBHOOK_SECRET" \
  -d "secret_token=$TELEGRAM_HEADER_SECRET"
```

## 4. Oracle (Robinhood Chain)

Follow `README.md` → "On-chain oracle" → "One-time setup". Summary: two keys (owner offline, writer in CI), fund the writer with ~0.003 ETH for a month at the 6-hourly cadence (0.012 ETH if you set `LEDGE_ORACLE_EVERY_RUN=1`), deploy with `forge script`, then set the repo secret `LEDGE_ORACLE_KEY` and the variable `LEDGE_ORACLE_ADDRESS`. The crawl workflow's `oracle` job starts publishing at 00/06/12/18 UTC.

## 5. Weekly dispatch (optional)

Repo secrets `RESEND_API_KEY` and `RESEND_AUDIENCE_ID`. Subscribers are managed in Resend's audience until a subscribe endpoint exists. Test with Actions → `dispatch` → Run workflow → `dry_run: true` and read the artifact.

## 6. Token launch (Pons)

- Image: `design/logo/finals/token-1024.png`
- Name `LEDGE`, ticker `LEDGE`, creator tax 3%, pair ETH
- Description (≤ 200 chars): see `LAUNCH.md`
- Website: `https://ledge.tools`

## Checks after everything is up

- `ledge.tools` shows the fold with no stale banner within 2 hours of the last crawl.
- `ledge.tools/number` unfurls in Telegram with the card.
- Paste a live token into the lookup: it answers within ~2 s.
- `api.ledge.tools/api/live` returns rows with no `0x` in them.
- The oracle's `latest()` on Blockscout matches `number.json` after the next 6-hour mark.
