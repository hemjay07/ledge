# Our own node — the evaluation, 2026-09-14

Step 3 of the three decided on 2026-09-14 (gateway → tick on the box → this).
Written on paper before any build, as agreed. Numbers with sources at the
bottom; everything unmeasured is marked so.

## What a node is, here

Robinhood Chain is an Arbitrum Orbit L2 (chain 4663) running Arbitrum
Nitro, ~0.1 s blocks, data posted to Ethereum L1 as blobs. A node of our own
is `offchainlabs/nitro-node` with Robinhood's chain-info and genesis files,
fed by **two Ethereum mainnet endpoints we must also provide**: an L1
execution JSON-RPC and an L1 beacon (consensus) REST endpoint for blob
reads. "The L1 node must be fully synced before Robinhood Chain can finish
syncing."

## The requirements, from Robinhood's own page

| | Full node (official) | Note |
|---|---|---|
| CPU | 8+ modern cores, strong single-core | |
| RAM | **64 GB (128 GB recommended)** | our box has 4 GB |
| Disk | locally attached NVMe, **2 × chain size + 20%, "several TBs"** | today's live data ~68 GB (Titan snapshot, Sep 2026); the chain is 10 weeks old |
| Parent chain | Ethereum mainnet execution RPC **and** beacon REST | a paid L1 provider, or a second machine running an L1 node |
| Sync | from a daily snapshot (`--init.url`); "consumes significant L1 request quota" | |
| **Archive** | "substantially more disk", **must sync from scratch — no snapshots** | the 14-August backfill needs archive |

Growth, measured from the one number available: 68 GB in 10 weeks ≈
**~7 GB/week ≈ 30 GB/month** for a full node at current activity (18–25k
launches/day). At that rate, the "2 × chain size" rule wants a 1 TB NVMe
within a year; an archive node several times that.

## What it would cost

| Option | Monthly | Gets us |
|---|---|---|
| **A. Stay on public endpoints behind the gateway** (today) | $7 (the box) | works, measured: refused calls fail over, exhausted = 0 over the first hour; no history beyond what the endpoints allow; no SLA |
| **B. A paid RPC provider as an upstream** | $25–125 (Blockmachine $25/20M RU or $125/100M; SolidRPC $25/10M; QuickNode/Alchemy/dRPC unquoted) | rate limits we pay for instead of beg for; **archive** for the backfill (SolidRPC and Blockmachine claim it); one line in `/etc/ledge/gateway.env` |
| **C. Our own full node** | ~$100–200 for a 64 GB / 1 TB NVMe dedicated machine (Hetzner AX-class, unquoted here) **plus** $50+ for an L1 execution+beacon endpoint | no third-party rate limit on *live* reads; still no archive |
| **D. Our own archive node** | C plus multi-TB disk, and a from-genesis sync we cannot snapshot | full history, forever, under our control |

Our usage, measured today from the gateway's own counters: ~1,400
requests / 20,000 items an hour with the tick catching up (≈ 10 M items a
month at that rate, far less at steady state), of which ~40% now hit the
cache. That is inside Blockmachine's $25 tier and SolidRPC's $25 tier, with
headroom; the probe and a backfill would add a one-time burst.

## The judgement

1. **Do not build C or D now.** The requirement is 64 GB RAM and TBs of
   NVMe plus an Ethereum L1 endpoint we would also have to buy; the thing
   we most want from a node — history to 14 August — is the archive case,
   which cannot start from a snapshot. That is $150–300/month and a week of
   ops for a site with no revenue yet. The failure mode is obvious: a node
   we run badly is less reliable than an endpoint we run through a gateway.
2. **Do B, as one more upstream behind the gateway, when either of these
   happens:** the gateway's `exhausted` counter stops being zero for a day,
   or the 14-August backfill is scheduled (it needs archive; a month of a
   $25–125 provider is the cheapest archive there is). Adding it is one
   environment line; the gateway already knows how to fail over to it and
   how to count what it refused.
3. **Revisit C/D when the token's creator fees or the site's use justify
   ~$200/month** — the gateway makes a node one more upstream, so nothing
   built now is thrown away by building one later. Re-measure chain growth
   then: 30 GB/month is a 10-week-old chain's number.

## What this changes on the list

- A7 (backfill to 14 August) is re-scoped: it runs against a paid archive
  upstream for one month, through the gateway, not against public
  endpoints and not against a node of our own.
- INDEXER.md's "next step is our own node" line now points here.

## Sources

- Robinhood Chain docs, run a full node (hardware, command, parent-chain
  endpoints, snapshots, archive): https://docs.robinhood.com/chain/run-a-full-node/
- Titan Locker, snapshot size (~68 GB live, ~38–40 GB compressed, daily):
  https://titandeployer.com/articles/how-to-run-a-robinhood-chain-node
- Provider pricing survey (SolidRPC, Blockmachine tiers; Alchemy/QuickNode/
  dRPC listed unpriced): https://solidrpc.io/blog/best-robinhood-chain-rpc-providers-2026
- Chain facts (Orbit L2, blobs to Ethereum, 0.1 s blocks):
  https://eco.com/support/en/articles/15859739-what-is-robinhood-chain-inside-robinhood-s-arbitrum-l2
- Our own usage: `journalctl -u ledge-gateway` metrics lines, 2026-09-14 00:00–01:00Z.
