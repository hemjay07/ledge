# Pons V2 contracts on Robinhood Chain (chain 4663) — verified 2026-09-06

Source: decoded constructor args of CHIT (0xD523A627030509021cC39B6d7C8543417D3E50D8),
contract `PonsV2LauncherToken` (verified, solc 0.8.35) via Blockscout /api/v2/smart-contracts.

| Role | Address |
|---|---|
| Launch factory (`launchFactory_`) | 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e |
| Bonding curve (`curve_`, shared)  | 0xF6e86610771ee7838cABE2f9c376265CA25EF04c |
| Example deployer                   | 0x96Cb8EB2E349e64bA47b1015890A2fe7584c369B |

Token getters (no-arg, return address): curve(), deployer(), launchFactory(), getTokenInfo()
Token events: Approval, Transfer only. Curve/factory events referenced in source:
CurveBuy, CurveBuyRefunded, CurveSell, CurveGraduated, CurveCompleted, FactorySet.
Supply arg: 1e27 (1B tokens). RPC: https://rpc.mainnet.chain.robinhood.com

Status: factory + curve addresses confirmed from source; ABIs/event topic0s pending (see next step).

## Update — factory verified (same day)

Factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` = **PonsV2LaunchFactory**, verified, no proxy. Full ABI saved: `PonsV2LaunchFactory.blockscout.json`.

Key events (all on the factory):
- `TokenLaunched(address,address,address,address,uint256,uint256)` — one per launch
- `PoolGraduated(address,uint256,uint256,uint256)` — one per graduation
- `LaunchSwept`, `GraduationTokensPermanentlyLocked`, `MaxCreatorTaxUpdated`, `SnipeTax*Updated`, `PairTokenEconomicsUpdated`

Useful views: `previewLaunchEconomics(uint256,address)`, `getLaunchedToken(address)`, `getLaunchConfig(uint256)`,
`launchConfigCount()`, `maxCreatorTaxBps()`, `launchFee()`, `pairTokenEconomics(address)`, `approvedPairTokens(address)`,
`memeHook()`, `poolManager()`, `positionManager()` — Pons v2 runs on Uniswap v4 with a custom hook.

Crawl proof (2026-09-06, head 55,906,156): factory-filtered eth_getLogs over last 1,000 blocks → 24 logs
(21 × topic0 0x8d4aad49…, 3 × 0x308c390e…). ≈20k/day. Public RPC rate-limits windows >1,000 blocks → crawl in 1,000-block windows, throttled.
Sample TokenLaunched data word[2] = 0x3a4965bf58a40000 = 4.2 ETH (graduation threshold in-event).
Curve `0xF6e8…` has code (20,460 hex) but ABI fetch throttled; NOT needed for the Number (time-to-grad = PoolGraduated block − TokenLaunched block).

## Decoded layouts (verified by eth_call, 2026-09-06)

topic0 map: TokenLaunched = 0x8d4aad49…a89607 · PoolGraduated = 0x0a44ef75…8c259 · CreatorFeeRecipientUpdated = 0x308c390e…ba980 (the "second event" seen in crawl; not a graduation)

TokenLaunched: indexed(token, curve, deployer) · data(pairToken, launchConfigId, graduationThreshold). pairToken 0x0 = ETH. NO creator tax in event.
PoolGraduated: indexed(token) · data(positionId, tokenAmount, pairTokenAmount).

getLaunchedToken(token) → 15-word static tuple:
  [0]token [1]curve [2]deployer [3]creatorFeeRecipient [4]pairToken [5]graduationThreshold [6]poolFee [7]tickSpacing
  [8]creatorTaxBps  [9]buybackEnabled [10]phase [11]sweptQuote [12]sweptTokens [13]sweptAt [14]exists
  CHIT: creatorTaxBps=100 (1%), phase=2, buyback=false. phase semantics: see check below.
getLaunchConfig(0): supply 1e27, curveFeeBps 100, phantomQuote 1.68 ETH, graduationThreshold 4.2 ETH, poolFee 0, tickSpacing 200, enabled.
maxCreatorTaxBps=1000 (10%) · launchFee=0.0005 ETH · pairTokenEconomics(0x0)=zeros (ETH handled by config, not this map).

Number v1 needs NO per-token calls: launches=TokenLaunched, graduations=PoolGraduated, time-to-grad=block delta (×~0.101s).
Tax/phase cohorts: getLaunchedToken on all graduated (~275/day) + random sample of non-graduated. Crawler: ledge/crawl0.py.

phase (verified): 0 = live on bonding curve (minutes-old token) · 2 = graduated (CHIT, has Uniswap pairs). 1 and 3 unobserved (likely completing / swept).
Observed: new launch 0x7d1e707f… set creatorTaxBps=500 (5%). Tax varies per launch — real cohort signal.

## First Number — 2026-09-06 (crawl0: 120k blocks ≈ 3.4 h, 0 RPC errors)
- 2,673 launches · 31 graduated in-window → **1.16%** (lower bound). Published figure 1.1%.
- Time-to-grad: p10 0.2m · p25 1.2m · median 4.8m · p75 15m · p90 36m · max 93m. Nothing after ~90 min.
- **52% of grads (16/31) in <5 min; 7 in <1 min.** Organic-style (>5 min) rate: **15/2,673 = 0.56% ≈ 1 in 180.**
- Pairing: ETH 67% / non-ETH 33% across 51 assets — top: USDG, NVDA, SPCX (SpaceX), SPY (Robinhood tokens). Non-ETH grads 1.56% vs ETH 0.96% (14 vs 17 — small n).
- Deployers: 1,938 unique; 247 launched 2+ in 3.4 h; top deployer 86 launches. Rate ≈ 794/h ≈ 19k/day.
- Tax sample (36 grads + 300 random dead, reweighted): see tax-cohorts-2026-09-06.json. ALL cells n<30 grads → suggestive only.
  0% tax is the MOST COMMON choice (~43% of launches). Phase: dead=0, graduated=2 (clean). Buyback: 0/36 graduated used it.
Artifacts: first-number-2026-09-06.json · tax-sample-2026-09-06.json · tax-cohorts-2026-09-06.json. 20-h backfill running → crawl1.log/json.
