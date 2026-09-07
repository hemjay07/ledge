# LEDGE

LEDGE measures every token launch on Pons (ponsfamily.com), a launchpad on
Robinhood Chain, and publishes the graduation rate hourly: the fraction of
launches that reach a liquidity pool, the same rate excluding graduations
that happen inside five minutes, the time-to-graduation distribution, and
cohort rates by pair token, creator tax, hour of day, and day of week — each
figure carries its sample size and the time it was last measured. The site
is a static instrument, not a dashboard: one number, its evidence
underneath, nothing that scores, ranks, or recommends an individual token.

See `CONSTRAINTS.md` for what LEDGE will never do, `METHOD.md` for the
binding definitions (what counts as a launch, a graduation, a fast
graduation), and `ARCHITECTURE.md` for how the pipeline and site are built.

## Dataset layout

```
data/
├── state.json                        # crawl cursor: lastIndexedBlock, lastIndexedAt (the published crawledAt), firstIndexedBlock
├── pair-tokens.json                  # pair token address -> symbol -> pairClass mapping
├── number.json                       # the published, versioned figures (site reads only this file)
├── launches/YYYY-MM-DD.jsonl[.gz]    # one TokenLaunched event per line
└── graduations/YYYY-MM-DD.jsonl[.gz] # one PoolGraduated event per line
```

Today's partition stays plain-text `.jsonl` (append-only); every earlier day
is rotated to a deterministic `.jsonl.gz` once and never rewritten. Every
timestamp comes from the block header, never from a blocks-per-second
conversion. Full field definitions and record schemas are in
`ARCHITECTURE.md` §5, and the versioned shape of `number.json` is in
`ARCHITECTURE.md` §7.

## Recompute

Every number on the site is reproducible from the files in `data/` with one
command, no network access required:

```
python pipeline/recompute.py --data-dir data --out data/number.json --check
```

`--check` re-derives `number.json` from the JSONL partitions and diffs it
against the committed file byte-for-byte, exiting non-zero on any
difference. This is the same command CI runs on every push; it is also the
gate a deploy cannot pass with a stale or hand-edited figure.

## One place a statistic is defined

`pipeline/stats.py` computes every rate, share, percentile and cohort row
LEDGE publishes. Nothing else does — not the site, not the Worker, not the
oracle. Each of those reads `data/number.json` and prints what it finds.

The awkward case is the sentence the live lookup wants: *"minute 14 — 76.4% of
graduations had already happened by now."* The "minute 14" is an observation
about one token; the "76.4%" is a statistic. Computing that percentage in
TypeScript would put a published figure outside the recompute gate. So
`number.json` carries two extra structures and the live layer does a table
lookup instead of arithmetic:

- **`ttg.ladder`** — cumulative counts of graduations at eleven fixed second
  marks (30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600), each with
  its raw count and its share. Placing a token is finding the last mark at or
  below its age. The 300 s and 60 s rungs are the "inside five minutes" and
  "inside a minute" figures by construction, so the ladder cannot contradict
  them.
- **`cohorts.pairTax`** — pair class crossed with creator-tax bucket, 20 cells,
  each with its own `n`, its own rate, and its own rate excluding fast
  graduations. "What happened to launches configured like this one" is a row
  lookup. Most cells are under n = 30 and say so.

Both ship inside the file the byte-for-byte recompute gate already covers, so
adding them extended that gate for free — which is the whole reason they live
there.

`tests/vectors/` holds the contract between the two languages: Python emits the
exact objects and sentences the live layer must produce for a set of inputs,
and the Worker's own code is run against them. See
[`tests/vectors/README.md`](tests/vectors/README.md).

```
python pipeline/vectors.py --check   # are the committed vectors current?
```

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


## Method

Full definitions — what counts as a launch and a graduation, the five-minute
threshold, cohort buckets, and the changelog of any definition change — live
at `/method` on the published site, sourced from `METHOD.md` in this repo.
