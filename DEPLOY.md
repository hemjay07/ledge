# Deploying LEDGE

Everything below is a one-time step you run yourself. Nothing in the repo holds a key. Order matters only where stated.

## The short path: Vercel only, no nameserver migration

**Added 2026-09-11, and this is the recommended route.** The seven-step
Cloudflare migration below still works and is still correct, but it buys one
thing a visitor never sees.

The only reason to move the nameservers was to give the Worker a hostname at
`api.ledge.tools`. The site already proxies `/api/*` to the Worker through the
rewrites in `vercel.json`, and that works today on the workers.dev host. So the
migration buys a prettier API hostname and the Cloudflare firewall rule, and
costs a DNS cutover.

**Two steps, both yours, about five minutes:**

1. **Vercel** → the `ledge` project → Settings → Domains → add `ledge.tools` and
   `www.ledge.tools`. Vercel then prints the exact DNS records it wants. Do not
   take them from here: read them off that screen, because they change.
2. **Namecheap** → Domain List → Manage `ledge.tools` → Advanced DNS → add the
   records Vercel just showed you. Leave the nameservers on Namecheap.

That is the whole thing. The site serves on the domain, the API keeps answering
through the existing rewrites, and nothing about the Worker or Cloudflare
changes.

**What is given up by skipping the migration:** the Cloudflare WAF rate-limit
rule on `/api/` and `/og/`, and one network hop on API calls. The rate limit
matters on a launch day and not before, and the migration is still available
later — nothing here forecloses it.

**Then tell me it resolves**, and I will make the two edits that are mine: the
links in the outreach note (internal) and `LAUNCH.md` move from the Vercel alias to
`ledge.tools`. Do not send anything with a `ledge.tools` link before that,
because a dead link in the first line of a pitch ends the pitch.

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
7. **Update the links in the outreach note (internal) and `LAUNCH.md`** from the Vercel alias
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

Full detail in the "On-chain oracle" appendix at the end of this file. Summary: two keys (owner offline, writer in CI), fund the writer with ~0.003 ETH for a month at the 6-hourly cadence (0.012 ETH if you set `LEDGE_ORACLE_EVERY_RUN=1`), deploy with `forge script`, then set the repo secret `LEDGE_ORACLE_KEY` and the variable `LEDGE_ORACLE_ADDRESS`. The crawl workflow's `oracle` job starts publishing at 00/06/12/18 UTC.

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

---

# Appendix: the oracle and the dispatch in full (moved from README.md, 2026-09-17)

## On-chain oracle

The same reading `data/number.json` carries is mirrored on Robinhood Chain by
`contracts/src/LedgeOracle.sol`, so a contract can read the Pons Number without
trusting a web server. One packed storage slot holds both rates in basis points
**and both counts**, so a reader never has a rate without its denominator. The
contract has no proxy, no upgrade path, no pause, and no way to change a stored
reading except by publishing a newer one: `crawledAt` must strictly increase, so
a stalled publisher shows up on-chain as a reading that stopped advancing.

`pipeline/publish_oracle.py` reads `data/number.json`, refuses to send when the
24h window is flagged insufficient, signs an EIP-1559 transaction (stdlib only:
`pipeline/secp256k1.py`, no web3 and no Foundry at run time), then reads the
contract back and diffs all six fields against the file, exiting non-zero on a
mismatch. It runs as a separate `continue-on-error` job in `crawl.yml`, after
the data commit, so a failed publish can never block or dirty the dataset.

```
forge test                                  # in contracts/
python pipeline/publish_oracle.py --dry-run # derive the reading, send nothing
```

### Cost

Measured with `forge test --gas-report` (optimizer on, 200 runs): 589,740 gas to
deploy, 55,760 gas for the first publish (cold slot), **38,660 gas for every
publish after it**. `eth_estimateGas` on Robinhood Chain returns no L1 data
surcharge for this call and receipts report `gasUsedForL1: 0x0`, so the L2
number is the whole cost.

At the 0.3696 gwei base fee read from the chain (`eth_gasPrice`, priority fee 0):

| | gas | ETH |
|---|---|---|
| deploy, once | 589,740 | 0.000218 |
| first publish | 55,760 | 0.0000206 |
| each hourly publish | 38,660 | 0.0000143 |
| one month, 720 publishes | 27,835,200 | 0.0103 |

Fund the writer one month at a time and no further — 0.012 ETH covers a month
with headroom. The gas price is read fresh on every run and printed in the job
log; if it moves, the log moves with it.

### One-time setup

Run once, by hand. Nothing below is automated, and no key in this repo.

1. **Generate two keys offline.** The owner key never touches CI; its only job
   is `setWriter` if the writer key is ever exposed.
   ```
   cast wallet new        # owner  — write the key down offline, do not export it
   cast wallet new        # writer — this one becomes a GitHub secret
   ```

2. **Fund the writer** with about 0.012 ETH on Robinhood Chain (a month of
   publishes at the rate in the table above) and the owner with enough for the
   deploy plus a rotation, about 0.001 ETH.

3. **Deploy**, with the owner key. `--interactives 1` prompts for the key
   instead of putting it in the shell history.
   ```
   cd contracts
   export ETH_RPC_URL=https://rpc.mainnet.chain.robinhood.com
   export LEDGE_ORACLE_WRITER=0x<the writer address from step 1>
   forge script script/Deploy.s.sol:Deploy --rpc-url "$ETH_RPC_URL" \
     --broadcast --interactives 1
   ```
   The deployer becomes `owner` and the address in `LEDGE_ORACLE_WRITER` becomes
   `writer`; the run prints the contract address.

4. **Check what was deployed** before trusting it.
   ```
   cast call <address> "owner()(address)"  --rpc-url "$ETH_RPC_URL"
   cast call <address> "writer()(address)" --rpc-url "$ETH_RPC_URL"
   ```
   `setWriter` rotates the writer later without a redeploy — one transaction from
   the owner key, no new address anywhere:
   ```
   cast send <address> "setWriter(address)" 0x<next> --rpc-url "$ETH_RPC_URL" --interactive
   ```

5. **Verify the source on Blockscout**, so the NatSpec is readable next to the
   numbers.
   ```
   forge verify-contract <address> src/LedgeOracle.sol:LedgeOracle \
     --chain 4663 \
     --constructor-args $(cast abi-encode "constructor(address)" "$LEDGE_ORACLE_WRITER") \
     --verifier blockscout \
     --verifier-url https://robinhoodchain.blockscout.com/api
   ```
   That host answers non-browser clients with a bot challenge (HTTP 403/500 to
   curl and to Foundry's user agent, checked 2026-09-06), so the command may
   fail without ever reaching the verifier. If it does, produce the standard
   JSON input and paste it into the explorer's own verify form:
   ```
   forge verify-contract <address> src/LedgeOracle.sol:LedgeOracle \
     --show-standard-json-input > LedgeOracle.verify.json
   ```
   Verification is cosmetic — it changes nothing about what the contract does —
   so a blocked verifier is not a reason to delay the deploy.

6. **Tell the workflow**, in the repo's Settings:
   - secret `LEDGE_ORACLE_KEY` — the writer's private key from step 1
   - variable `LEDGE_ORACLE_ADDRESS` — the contract address from step 3

   The oracle job is skipped entirely while either is absent.

7. **Watch the first run.** The next hourly crawl that commits data runs the
   oracle job; its log prints the reading, the gas, the cost, and the read-back
   diff. To trigger one by hand, run the crawl workflow from the Actions tab.

### Rotating a leaked writer key

`cast send <address> "setWriter(address)" 0x<new writer>` from the owner key,
then replace the `LEDGE_ORACLE_KEY` secret. The old key can do nothing from the
next block onward. The writer holds gas and nothing else: it can call `publish`
and no other function, and `publish` can only move `crawledAt` forward.


## Weekly dispatch

`pipeline/dispatch.py` composes one email a week from the committed record:
the trailing 7-day figure and the excluding-fast figure as "1 in N", the two
furthest-apart rows of the pair-token and creator-tax cohorts, the p50 and p90
time to graduation, and one fact drawn from the published ladder. Every figure
is a count or a rate that came out of `pipeline/stats.py`, with its n and its
window; the module formats and selects, and computes nothing.

The 7-day window is deliberately **not** a key in `data/number.json`. It could
be — `stats.window` takes any interval and the site's Zod schema is not
`.strict()` — but that file is covered byte-for-byte by `recompute.py --check`
and frozen again in `tests/vectors/`, and the dispatch is not reason enough to
move a file other consumers are pinned to. If a second consumer ever needs the
window it belongs in `number.json`, with a dated `/method` entry.

```bash
python pipeline/dispatch.py --dry-run   # writes dispatch/preview.{txt,html}, opens no socket
python pipeline/dispatch.py             # sends, given RESEND_API_KEY and RESEND_AUDIENCE_ID
```

`.github/workflows/dispatch.yml` runs it on Monday at 09:00 UTC, uploads the
preview as an artifact on every path, and sends only when both secrets exist.

### Mailing list

There is no sign-up form on the site, and there will not be one until it can be
built without breaking CONSTRAINTS §8 — nothing on `ledge.tools` may require an
email to see a number. A sign-up endpoint in the Worker is a follow-up and is
not implemented. Until it lands, Resend's own hosted sign-up page against the
same audience is the whole mechanism: the list lives in Resend, this repo never
holds an address, and `dispatch.py` addresses the audience by id and never
enumerates it. Every message carries Resend's per-recipient opt-out link.
