# LEDGE

**[ledge.tools](https://ledge.tools)** counts every token launch on pons, a
launchpad on Robinhood Chain (chain 4663): how many launches graduate to a
liquidity pool, how fast, when the first outside buy lands, and what happens
to the price after. Every figure carries the number it was counted from.

LEDGE rates, ranks and predicts nothing. It counts. The rules it will not
break are in [`CONSTRAINTS.md`](CONSTRAINTS.md); the definitions behind every
number are in [`METHOD.md`](METHOD.md) and on [/method](https://ledge.tools/method).

LEDGE is independent. It is not affiliated with, endorsed by, or operated by
Pons Labs, LLC. It reads public chain data and publishes what it counts.

## What it publishes

| Where | What |
| --- | --- |
| [/](https://ledge.tools) | The graduation rate, with and without graduations inside 5 minutes, and the time-to-graduation distribution. |
| [/cohorts](https://ledge.tools/cohorts) | The same rates by pair token, creator tax, hour and day; price after graduation; when the first outside buy lands. |
| [/live](https://ledge.tools/live), [/graduated](https://ledge.tools/graduated), [/graveyard](https://ledge.tools/graveyard) | Every curve taking buys now; every graduation and how long it took; every launch with no buy in 72 hours. |
| [/t/{address}](https://ledge.tools/t) | Any token: buys, sells, fill, first outside buy, and how launches like it did. |
| [/number.json](https://ledge.tools/number.json) | Every published figure, as one versioned file. Free, unkeyed, for ever. |
| [@ledgetools_bot](https://t.me/ledgetools_bot) | The same lookup on Telegram. The room [@ledgetools](https://t.me/ledgetools) gets a daily digest. |
| [/launch](https://ledge.tools/launch) | LEDGE's own token launch on pons, pre-registered before it happens and counted by the same rules. |

## Reproduce any figure

Every number on the site is derived from the raw event records in `data/`
by one command, with no network access:

```
python pipeline/recompute.py --data-dir data --out data/number.json --check
```

`--check` rebuilds `number.json` and diffs it byte for byte against the
committed file. CI runs the same command on every push, and a deploy cannot
pass with a figure that does not recompute. `data/number.json` is committed
on every crawl, so its git history is every number the site has ever shown.

Only [`pipeline/stats.py`](pipeline/stats.py) computes a statistic. The site,
the Worker and the bot read the file and print what they find; a lint in CI
refuses arithmetic anywhere else, and [`tests/vectors/`](tests/vectors/) pins
the sentences the two languages must agree on.

## How it runs

```
pipeline/   Python. The crawl (every 10 min, on a small box), stats, recompute, the gate.
data/       The record: launches and graduations as daily JSONL, number.json, coverage.
worker/     Cloudflare Worker: the API, token pages, figure cards, the Telegram bot.
worker/host The live indexer, the same tick run as a loop on the box against D1.
gateway/    The RPC gateway the crawl and the indexer read through: pacing, failover, cache.
site/       Next.js static export on Vercel. Reads number.json at build; /api and /t go to the Worker.
contracts/  LedgeOracle: the headline reading mirrored on Robinhood Chain, rates with their counts.
ops/        systemd units for the box; the stall alert.
```

`ARCHITECTURE.md` and `INDEXER.md` explain the two layers, `DEPLOY.md` how to
stand them up, `INCIDENTS.md` what has gone wrong and what guards it now.

## Tests

```
pytest pipeline/tests -q            # the pipeline
npm test --prefix worker            # the Worker and the host runner
npm test --prefix site              # the site
npm test --prefix gateway           # the gateway
bash scripts/lint-worker.sh         # no statistics outside stats.py
bash scripts/lint-copy.sh           # no banned copy on any public surface
```

## Definitions change only in the open

A change to any window, cutoff or bucket is a dated entry in `METHOD.md`
and on the site's changelog, with the figures that moved. Nothing is
renamed quietly and no ugly number is taken down.
