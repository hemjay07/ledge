# Multi-venue indexing

Draft, 2026-09-09. A design document. Nothing here is built.

Pons is not the only launchpad on Robinhood Chain. This describes what it would take
for LEDGE to measure all of them with one method, and where that method breaks.

It assumes the framing in `REPOSITION.md`. It changes `METHOD.md` and it changes the
shape of the raw partitions, so it cannot be done quietly: it needs a dated
definitions entry and a `DEFINITIONS_VERSION` bump.

## What is verified, and how

Measured 2026-09-09 against `rpc.mainnet.chain.robinhood.com` with a `User-Agent`
header. Scripts were scratch, not committed; the numbers below are what they printed.

**Unfiltered and topic-filtered `eth_getLogs` both work.** 20 blocks with no address
and no topic filter returned 1,398 logs across 152 distinct emitting contracts. 900
blocks filtered to `Transfer` with a zero-address `from` returned 1,484 logs. Neither
was rejected and neither hit a result cap. This was the open question: it is answered,
and it is what makes venue discovery and any per-curve work possible at all.

**Venues can be discovered without knowing their names.** The detector:

1. `eth_getLogs` for topic0 `Transfer` with topic1 = the zero address — every mint.
2. Keep only tokens that mint **exactly once** in the window. Wrappers, LP tokens and
   savings vaults mint continuously and drop out here.
3. Read which contract each of those transactions went to.

Over 900 blocks ending at 58,279,461: 1,484 mint logs, 39 distinct tokens,
**25 genuinely new tokens**.

**The detector is calibrated.** The known Pons v2 factory
`0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` came back in that window with 5
launches. A detector that finds the venue we already index is a detector we can
trust on the ones we do not.

**At least four launchpad-shaped factories exist.** Confirmed by calling `name()`,
`symbol()`, `decimals()` and `totalSupply()` on each new token — launchpad tokens are
unmistakable at a fixed 1,000,000,000 supply.

| venue | launches in 900 blocks | code bytes | sample token |
|---|---|---|---|
| `0xe33e9e479df8802cb0866d5d05258bec4cf62948` | 8 | 4,416 | Gate Gecko (GAGE), Midas Touch (MIDAS) |
| `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` (Pons v2) | 5 | 24,177 | LighterAI (LAI) |
| `0x3b0a9ae92d692df19e1574268839ac8ff99e0c1f` | 1 | 24,241 | nvmaxi (NVMAXI) |
| `0x1cbaf24d53fe930fce8eff149fa797d2611da149` | 1 | 20,443 | Gold xStock (GLDx) |

Correctly excluded by the supply test: `liSLVR` (liquid staking, 3,486 supply),
`spUSDG` (Spark savings, 6 decimals). Three of the four venues appear in no
published comparison of this chain's launchpads.

**900 blocks is a few minutes.** 8 against 5 is noise. Nothing here claims any venue
is larger than Pons. The one publishable consequence, once measured over a real
window, is whether the circulating figure that Pons is ~73% of the chain's launches
still holds — our sample is not evidence either way.

## What is not known

- **Brand names.** We have addresses. Mapping `0xe33e9e47…` to a product name needs
  the block explorer, and both `robinhoodchain.blockscout.com` and
  `explorer.mainnet.chain.robinhood.com` answer a Cloudflare bot challenge (HTTP 403,
  "Just a moment…") to every non-browser client. This is not a blocker: LEDGE may
  publish a venue by its factory address, which `CONSTRAINTS.md` §2 already permits as
  provenance. A name, when we get one, is a label on a row, not a dependency.
- **Every venue's launch and graduation event signatures.** We know Pons's two. We
  know nothing about the other three.
- **Whether `0xe33e9e47…` is one venue or a router in front of several.** 4,416 code
  bytes is small for a launchpad factory; the other three are 18–24 KB.

## `tx.to` is not a reliable attribution

Three rows in the raw scan resolved to contracts with **23 code bytes** — the length
of an EIP-7702 delegation designator, i.e. a delegated EOA, not a venue. Others
resolved to the ERC-4337 EntryPoint (`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`)
and to Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`).

So `tx.to` is fine for discovery — it surfaces candidates to investigate — and wrong
for indexing. **The indexer attributes a launch by the contract that emitted the
launch log, never by the transaction's recipient.** Any venue whose users route
through a bundler or a multicall would otherwise be silently misattributed or lost.

## The graduation problem, and the way around it

This is the hard part, and it is why this is a design document rather than a task.

Cross-venue graduation cannot be defined by reading each venue's own graduation
event, because we would have to reverse-engineer a different event per venue, and
because the venues do not mean the same thing by it. Pons flips a phase flag at a
4.2-ETH threshold. hood.fun's own whitepaper describes completing the curve, then a
permissionless `migrate` that pairs the raised ETH with reserved tokens into a 1% fee
Uniswap v3 pool and locks the position. Those are not the same event and a table that
put them in one column would be comparing two different things — the exact failure
`CONSTRAINTS.md` §9 exists to prevent.

**Recommendation: define cross-venue graduation at the destination, not the origin.**
Every one of these venues ends the same way — a Uniswap v3 pool for the token. So
index the Uniswap v3 factory's `PoolCreated` on this chain and treat *a pool existing
for a launchpad token* as the venue-independent graduation event. One event
signature, one address, identical semantics for every venue including ones we have
not discovered yet.

Consequences that must be stated on `/method`, not buried:

- This is a **different quantity** from the Pons Number. Pons's own graduation flag
  and a Uniswap v3 pool are not synonyms, and the counts will not match. The Pons
  Number keeps its current definition and its own page. The cross-venue rate is a new
  metric with a new name, published beside it, never substituted for it.
- The Uniswap v3 factory address on chain 4663 is **not yet confirmed**. Confirm it
  from a known graduated Pons token's pool before writing any code.
- Not every pool creation is a graduation, and not every graduation may create a pool
  (a venue could migrate into an existing pool, or elsewhere entirely). The rate is a
  lower bound until measured against Pons's own flag, where we have both.

The calibration is free and it is the first thing to do: for the graduated Pons
tokens we already hold, how many have a Uniswap v3 pool, and how far apart are the
two timestamps? If that agreement is poor, this whole approach is wrong and we should
know before building anything.

## Code changes

The factory address is hardcoded in three places today — `pipeline/rpc.py:22`,
`pipeline/enrich.py:15`, `pipeline/stats.py:31` — and `RpcClient.get_logs`
(`pipeline/rpc.py:211`) pins `address` to it. That is the shape that has to change.

**A venue registry**, one file, the only place a venue is named:

```
VENUES = {
  "pons": {factory, launchTopic, graduationTopic, decoder, firstBlock, enrich: True},
  "0xe33e…": {factory, launchTopic: None, ...},   # discovered, not yet decoded
}
```

A venue with no known launch topic is still indexed — via the mint-once detector,
which needs no per-venue knowledge — and carries fewer fields. This matters: it means
a new venue starts producing a launch count on day one, and gains detail later.

**Partition shape.** Launch records gain `venue`. Existing lines have no such field,
so the reader must default a missing `venue` to `"pons"` — the partitions are the
reproducibility substrate and rewriting 108,317 historical lines to add a constant is
a worse trade than one defaulting rule. `recompute.py` must apply the same default,
or `--check` fails on the first run.

**Per-venue fields.** `curve`, `pairToken`, `pairClass` and `creatorTaxBps` come from
Pons's `getLaunchedToken` and have no meaning on another venue. They stay
Pons-only and stay `None` elsewhere. **No cohort that depends on them may be computed
across venues** — the pair-token and creator-tax registers remain Pons-scoped, and
the site has to say so on the row rather than letting a reader assume otherwise.

**What is computable across all venues:** launch count, graduation count, the rate,
time-to-graduation, and the sub-5-minute share. That is the whole cross-venue table,
and it is enough for the finding that matters.

**Stats.** `stats.py` computes every rate per venue plus a chain total. The Class A /
Class B split is unaffected. `number.json` gains a `venues` block; `schemaVersion`
increments; the site's `Stat` and `Register` denominator rules apply unchanged, which
means a venue with n < 30 renders "not enough data" like any other cohort — and on
the evidence above, three of the four venues will do exactly that at first. That is
the correct outcome, not a problem to engineer around.

## RPC budget

The current run uses roughly 134 s of a 45-minute window. Adding three venues at
Pons's per-venue cost is additive on `eth_getLogs` and free on enrichment (no
`getLaunchedToken` equivalent to call). The mint-once detector is one extra
topic-filtered `getLogs` per window. Nothing here approaches the ceiling. The
`MAX_FORWARD_BLOCKS = 200_000` cap and the reorg window carry over unchanged.

## Phases

1. **Confirm the Uniswap v3 factory on chain 4663 and calibrate.** Against Pons
   tokens we already know graduated: what share have a pool, and what is the timestamp
   gap? Decision gate — if agreement is poor, stop and rethink the definition.
2. **Measure the venue split over a real window**, days not minutes, using the
   mint-once detector alone. This costs nothing and either supports or kills the
   headline finding before any refactor.
3. **Venue registry + `venue` on partitions + the defaulting rule**, with a test that
   pins `crawl.py` and `recompute.py` to the same output. The existing
   `test_crawl_writes_the_same_number_file_recompute_would` is the model: write the
   test so it fails without the change.
4. **Per-venue stats and the `venues` block** in `number.json`.
5. **The site row.** One table, one method, every venue, each with its n.
6. **`METHOD.md`** — dated entry defining cross-venue graduation, stating plainly that
   it is not the Pons Number and why the counts differ.

Phases 1 and 2 are measurement and can be thrown away. Nothing before phase 3 touches
committed code.

## Why this is worth doing

The most detailed public comparison of this chain's launchpads (memecentral.fun,
31 Aug 2026) states that **"no comparable per-venue graduation data exists for this
chain"** and declines to publish figures rather than guess. A competitor has written
down that the thing is missing.

It is also the one direction where our existing pipeline is the moat rather than a
liability. Per-token discovery pages put LEDGE against GMGN, Axiom, DexScreener and
PonsScan, all of which are funded and already shipped. A cross-venue table with one
method and every denominator shown puts it against nobody, and it is a table of
platforms rather than tokens — which breaks none of the constraints that survived
`REPOSITION.md`.
