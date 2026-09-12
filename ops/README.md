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
and is not in the repository.

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
