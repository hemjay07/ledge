# worker/host — the live indexer on a box

Runs `worker/src/tick.ts`, unchanged, under plain Node against the real
Cloudflare D1 database over its HTTP API, in a loop. See `INDEXER.md` section
2 in the repo root for why this exists.

## Install (Ubuntu 24.04)

1. Install Node 22 from NodeSource:

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. Clone the repo and install dependencies:

   ```bash
   sudo mkdir -p /home/ledge/ledge
   sudo chown "$USER" /home/ledge/ledge
   git clone <repo-url> /home/ledge/ledge
   cd /home/ledge/ledge/worker
   npm ci
   ```

3. Build the host bundle:

   ```bash
   npm run build:host
   ```

   This produces `worker/dist/host.mjs`.

4. Create `/etc/ledge/env`, mode 600, owned by the `ledge` user, listing
   (names only — fill in real values, never commit this file):

   ```
   RPC_URL=
   RPC_URL_FALLBACK=
   FACTORY_ADDRESS=
   CHAIN_ID=
   NUMBER_JSON_URL=
   SITE_ORIGIN=
   TELEGRAM_BOT_TOKEN=
   TELEGRAM_WEBHOOK_SECRET=
   TELEGRAM_HEADER_SECRET=
   TELEGRAM_GRAVEYARD_CHAT_ID=
   CLOUDFLARE_ACCOUNT_ID=
   D1_DATABASE_ID=
   D1_API_TOKEN=
   TICK_INTERVAL_MS=10000
   RPC_BUDGET=400
   ```

   ```bash
   sudo mkdir -p /etc/ledge
   sudo touch /etc/ledge/env
   sudo chmod 600 /etc/ledge/env
   sudo chown ledge:ledge /etc/ledge/env
   ```

   `D1_API_TOKEN` is a Cloudflare API token (My Profile -> API Tokens ->
   Custom, permission Account · D1 · Edit) — not a `wrangler login`
   session. `RPC_URL` is the gateway on loopback, `http://127.0.0.1:8545`
   (ops/README.md); no fallback is needed there, the gateway holds it.
   Installed on the box 2026-09-14 00:54Z.

5. Create the `ledge` system user if it does not already exist:

   ```bash
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin ledge
   sudo chown -R ledge:ledge /home/ledge/ledge
   ```

6. Install the systemd unit:

   ```bash
   sudo cp /home/ledge/ledge/worker/host/ledge-tick.service /etc/systemd/system/ledge-tick.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now ledge-tick
   ```

7. Tail logs:

   ```bash
   journalctl -u ledge-tick -f
   ```

## Cutover test

Run one tick by hand first, without touching the Worker's cron:

```bash
cd /home/ledge/ledge/worker
node dist/host.mjs --once
```

Confirm it logs a line like `from=... to=... launches=... graduations=...`
and exits 0, then follow INDEXER.md section "4. Cutover" for running the box
alongside the Worker cron before removing the cron.

## What this does not do

- Does not touch `wrangler.toml`'s cron trigger — removing it is a separate,
  later step (INDEXER.md section 4).
- Does not deploy anything.
- Does not change `tick.ts` or anything it imports.

## Pair-token registry

The tick classifies a launch's pair token from `data/pair-tokens.json`, which
the crawl publishes. On the box the repository is checked out for the crawl,
so the runner reads the same file from disk: `PAIR_TOKENS_PATH` (default
`../data/pair-tokens.json`, relative to the runner's working directory,
which the unit sets to `/home/ledge/ledge/worker`).
