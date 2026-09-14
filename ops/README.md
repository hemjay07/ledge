# ops — the box

Files installed on the indexer VPS (INDEXER.md). `crawl.sh` is the runner,
the two `ledge-crawl.*` files are the systemd units that call it every ten
minutes. Installed by hand on 2026-09-12:

    sudo install -m 755 ops/crawl.sh /home/ledge/ledge/ops/crawl.sh   # (it is in the checkout already)
    sudo install -m 644 ops/ledge-crawl.service ops/ledge-crawl.timer /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now ledge-crawl.timer

Watch it: `journalctl -u ledge-crawl -f`. Run once by hand:
`sudo systemctl start ledge-crawl` (the lock makes a second start a no-op).

`/etc/ledge/env` holds `RPC_URL` and `RPC_URL_FALLBACK`, mode 640 root:ledge,
and is not in the repository. Since 2026-09-13 the primary is the official
endpoint and ordofi is the fallback (INDEXER.md, "RPC", has the measurement);
the pipeline alternates to the fallback after one busy answer.

## The probe (outcomes backfill)

`probe.sh` runs `pipeline/backfill_pools.py` in a second clone,
`/home/ledge/ledge-probe`, so a multi-hour probe never holds the crawl's
checkout or its lock. It commits `data/pools/index-backfill.jsonl`,
`data/pools/backfill.jsonl` and a regenerated `number.json`, then pushes
with the crawl's own race resolution. Installed 2026-09-12:

    sudo install -m 644 ops/ledge-probe.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl start ledge-probe        # by hand; no timer until one pass is watched

A first trial on a few pools: `LEDGE_PROBE_LIMIT_POOLS=20 sudo -E -u ledge ops/probe.sh`
(or set `LEDGE_PROBE_LIMIT_POOLS` in `/etc/ledge/env` temporarily).

## The RPC gateway (every chain read goes through it)

`gateway/` is one process on the box that owns all endpoint policy: pacing
per upstream, failover between the two public endpoints on a 429, 5xx,
transport failure or "the network is busy", a retry pass with backoff, a
cache for answers that cannot change (block headers and log ranges below
the reorg window), and `/metrics`. The crawl and the probe reach it on
loopback (`RPC_URL=http://127.0.0.1:8545` in `/etc/ledge/env`, no key
needed); the Worker reaches it by hostname with the shared key in
`X-Ledge-Key`, and the firewall admits the port from Cloudflare's
published ranges only. Tests: `cd gateway && npm test`.

    sudo install -m 640 -o root -g ledge /dev/null /etc/ledge/gateway.env
    sudo sh -c 'printf "GATEWAY_UPSTREAM=https://rpc.mainnet.chain.robinhood.com\nGATEWAY_UPSTREAM_FALLBACK=https://rpc.ordofi.network\nGATEWAY_KEY=%s\n" "$(openssl rand -hex 32)" > /etc/ledge/gateway.env'
    sudo cp ops/ledge-gateway.service /etc/systemd/system/
    sudo systemctl daemon-reload && sudo systemctl enable --now ledge-gateway
    sudo ufw allow OpenSSH
    for ip in $(curl -s https://www.cloudflare.com/ips-v4); do sudo ufw allow from "$ip" to any port 8545 proto tcp; done
    sudo ufw --force enable
    curl -s http://127.0.0.1:8545/metrics

Then on the Worker: `wrangler secret put RPC_PROXY_KEY` with the same key
(never printed; pipe it), `RPC_URL = "http://<box hostname>:8545"` in
`wrangler.toml` (a Worker cannot fetch a bare IP; `<ip>.nip.io` resolves to
it), deploy. Rotate by writing a new key to both places. The journal prints
one metrics line a minute: `refused`/`busy` rising on an upstream is the
rate-limit pressure that used to be an outage.
