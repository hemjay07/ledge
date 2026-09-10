# Deploying LEDGE

Everything below is a one-time step you run yourself. Nothing in the repo holds a key. Order matters only where stated.

## Now that ledge.tools is registered

Bought 2026-09-10. Until these steps are done every published link points at
`ledge-alpha.vercel.app`, and the Worker's own config points there too. Do them
in this order, because flipping a config before the name resolves takes the live
site down rather than moving it.

1. **Point the nameservers at Cloudflare.** Add `ledge.tools` as a site in the
   Cloudflare dashboard, then set the two nameservers it gives you at the
   registrar. Wait for Cloudflare to report the zone active. Nothing below works
   until it does.
2. **Add the domain in Vercel.** Project → Settings → Domains → add `ledge.tools`
   and `www.ledge.tools`, and follow the DNS records it asks for. Confirm
   `https://ledge.tools/number.json` returns the file before going further.
3. **Add the Worker's own hostname.** Workers → the `ledge` worker → Settings →
   Domains → add `api.ledge.tools`. Confirm `https://api.ledge.tools/api/health`
   answers.
4. **Only then flip the configs**, in one commit: `NUMBER_JSON_URL` and
   `SITE_ORIGIN` in `worker/wrangler.toml`, and the four rewrite targets in
   `vercel.json`. Redeploy the Worker with `wrangler deploy`.
5. **Add the rate-limit rule**, which does not exist yet and is the one thing
   between a launch-day traffic spike and an outage: Security → WAF → Rate
   limiting → 60 requests per minute per IP on paths starting `/api/` and
   `/og/`.
6. **Set the Cloudflare credentials** so the crawl pushes `number.json` into KV
   after every commit: repo secrets `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`, repo variable `LEDGE_KV_NAMESPACE_ID`. Until these
   are set the Worker answers by fetching the file over HTTP from the site,
   which is the coupling KV exists to remove. On launch day that coupling means
   one slow site makes the API slow too.
7. **Update the links in `OUTREACH.md` and `LAUNCH.md`** from the Vercel alias
   back to `ledge.tools`.

Steps 1, 2, 3, 5 and 6 are yours: they need dashboard access and credentials
that are deliberately not in this repo. Steps 4 and 7 are edits I can make in
one pass once you confirm the name resolves.

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

Status 2026-09-07: deployed and git-connected at https://ledge-alpha.vercel.app (project `ledge`, repo root, `vercel.json` at the root builds `site/`). When `ledge.tools` exists, add the domain in Vercel and replace the alias in `worker/wrangler.toml` (`NUMBER_JSON_URL`, `SITE_ORIGIN`) and the rewrites in `vercel.json` (`api.ledge.tools`).

1. Import the repo. Root directory `site/`. Build command `npm run build` (prebuild copies `number.json` and renders the card). Output `out/`.
2. Settings → Git → Ignored Build Step: leave empty. Data-only commits must rebuild.
3. Domains: `ledge.tools` and `www.ledge.tools`.
4. After the first deploy, open `/number.json` and confirm `crawledAt` equals the latest data commit.

`site/vercel.json` already rewrites `/api/*`, `/t/*`, `/og/t/*` to `https://api.ledge.tools`. Until the Worker exists those routes 502; the rest of the site is unaffected.

## 3. Worker (Cloudflare)

Status 2026-09-07: deployed at https://ledge-api.ledge-worker.workers.dev with D1 `ledge` and KV `LEDGE_KV`; cron every minute. The official RPC rate-limits Cloudflare's egress hard, so `RPC_URL_FALLBACK` is `https://rpc.ordofi.network` (from chainlist; serves factory logs). The site's rewrites point at the workers.dev host until `api.ledge.tools` exists.

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

Keeping the Worker's copy of `number.json` current: the `kv` job in `crawl.yml` pushes `number.json` and `pair-tokens.json` into KV after every data commit, so the API answers from Cloudflare alone. To turn it on, set the repo variable `LEDGE_KV_NAMESPACE_ID` to the id `wrangler kv namespace create` printed above, and the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The job skips itself while any of the three is unset.

The commands above seed KV by hand for the first deploy; after that the job keeps it current. If the push is failing, the Worker falls back to fetching `https://ledge.tools/number.json` and keeps answering with correct figures — but it is then depending on the site being up, which is the coupling KV exists to remove, so a red `kv` job is worth fixing rather than tolerating.

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

## Repo secrets and variables, in one place

Settings → Secrets and variables → Actions. Every job that needs one of these
**skips itself while it is unset**, so a partial setup is safe: nothing fails
because a credential you have not created yet is missing.

| Kind | Name | Used by | Without it |
|---|---|---|---|
| variable | `RPC_URL` | `crawl`, `backfill` | falls back to the endpoint in the code |
| secret | `CLOUDFLARE_API_TOKEN` | `crawl` → `kv`, `reconcile` | KV push and reconciliation skip |
| secret | `CLOUDFLARE_ACCOUNT_ID` | `crawl` → `kv`, `reconcile` | same |
| variable | `LEDGE_KV_NAMESPACE_ID` | `crawl` → `kv` | the Worker reads `number.json` over HTTP instead |
| variable | `LEDGE_D1_NAME` | `reconcile` | no nightly D1-vs-repo check |
| secret | `LEDGE_ORACLE_KEY` | `crawl` → `oracle` | nothing is published on-chain |
| variable | `LEDGE_ORACLE_ADDRESS` | `crawl` → `oracle` | same |
| variable | `LEDGE_ORACLE_EVERY_RUN` | `crawl` → `oracle` | publishes 6-hourly instead of hourly |
| secret | `RESEND_API_KEY` | `dispatch` | no weekly send |
| secret | `RESEND_AUDIENCE_ID` | `dispatch` | same |
| variable | `RESEND_FROM` | `dispatch` | same |

The Cloudflare API token needs **Workers KV Storage: Edit** (for the KV push)
and **D1: Read** (for the reconciliation). It does not need deploy rights: the
Worker is deployed from your machine with `wrangler`, never from CI.

## Checks after everything is up

- `ledge.tools` shows the fold with no stale banner within 2 hours of the last crawl.
- `ledge.tools/number` unfurls in Telegram with the card.
- Paste a live token into the lookup: it answers within ~2 s.
- `api.ledge.tools/api/live` returns rows with no `0x` in them.
- The oracle's `latest()` on Blockscout matches `number.json` after the next 6-hour mark.
