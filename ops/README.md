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

## The RPC relay (Worker egress through the box)

`rpc-proxy.mjs` listens on 8545 and forwards JSON-RPC to `RPC_URL` (falling
back once to `RPC_URL_FALLBACK` when the upstream cannot be reached at all)
from the box's own address, because on 2026-09-13 both public endpoints
refused Cloudflare's egress for an hour while answering the box in 0.3 s.
It accepts only a POST carrying the shared key in `X-Ledge-Key`, and the
firewall admits the port from Cloudflare's published ranges only.

    sudo install -m 640 -o root -g ledge /dev/null /etc/ledge/proxy.env
    sudo sh -c 'echo "RPC_PROXY_KEY=$(openssl rand -hex 32)" > /etc/ledge/proxy.env'
    sudo cp ops/ledge-rpc-proxy.service /etc/systemd/system/
    sudo systemctl daemon-reload && sudo systemctl enable --now ledge-rpc-proxy
    sudo ufw allow OpenSSH
    for ip in $(curl -s https://www.cloudflare.com/ips-v4); do sudo ufw allow from "$ip" to any port 8545 proto tcp; done
    sudo ufw --force enable

Then on the Worker: `wrangler secret put RPC_PROXY_KEY` with the same key
(never printed; pipe it), `RPC_URL = "http://<box>:8545"` in
`wrangler.toml`, deploy. Rotate by writing a new key to both places.
