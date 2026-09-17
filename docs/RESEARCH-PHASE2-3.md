# LEDGE — Phase 2/3 research: live curve state + cross-venue Numbers

Date of all measurements: **2026-09-06**, chain 4663 (Robinhood Chain),
RPC `https://rpc.mainnet.chain.robinhood.com` (`User-Agent: ledge/1.0`).
Head block during this session moved from **56,211,039 → 56,220,347**.

Everything below marked **CONFIRMED** was reproduced by a live `eth_call` /
`eth_getLogs` in this session. Everything marked **UNCONFIRMED** is exactly
that — no guessing has been substituted for a measurement.

---

## 0. Correction to `PONS_CONTRACTS.md` — the curve is NOT shared

`PONS_CONTRACTS.md` calls `0xF6e86610771ee7838cABE2f9c376265CA25EF04c` the
"shared" bonding curve. **It is not shared. Every launch gets its own curve
contract.** CONFIRMED three ways:

1. `data/launches/2026-09-06.jsonl` holds 5,900 launches and **5,900 distinct
   `curve` addresses** (max count per curve = 1).
2. `eth_getCode` on `0xF6e8…` and on a random per-token curve
   `0x36f0eeb62c426cf9daa52e0228f1297f23bda704` both return **20,460 hex chars**
   — same length, *not* an EIP-1167 minimal proxy, a full copy each. They differ
   first at hex offset 2168, inside a `PUSH32` immutable slot:
   - `0xF6e8…`: `…7f0000000000000000000000000000000000000000000000000000000000000000 6001600160a01b031615…`  (pairToken = ETH)
   - `0x36f0…`: `…7f0000000000000000000000005fc5360d0400a0fd4f2af552add042d716f1d168 6001600160a01b031615…`  (pairToken = USDG)
   i.e. identical code with per-launch **immutables** baked in.
3. `eth_call token()` on `0xF6e8…` returns
   `0xd523a627030509021cc39b6d7c8543417d3e50d8` = **CHIT**. `0xF6e8…` is simply
   *CHIT's own curve*, which is where the address in `PONS_CONTRACTS.md` came from
   (it was read out of CHIT's constructor args).

**Consequence for the indexer:** you cannot filter curve logs by address. Filter
by **topic0 only** (no `address` field) and let the log's `address` field tell you
which token's curve emitted it. Verified: an unfiltered `eth_getLogs` on the
`CurveBuy` topic0 over 800 blocks returned **682 logs across 57 distinct curve
addresses** — no address filter needed and none possible.

---

## Part A — live curve state for a Pons token

### A1. Verified source / ABI

- Contract name: **`PonsV2BondingCurve`**, file `contracts/src/v2/PonsV2BondingCurve.sol`
- Compiler `v0.8.35+commit.47b9dedd`, optimizer on, 200 runs, EVM `cancun`, **not a proxy**
- ABI saved to **`pipeline/PonsV2Curve.blockscout.json`** (82 ABI entries; also carries
  contract name, compiler, constructor args)

**Blockscout endpoint that actually works.** The v2 endpoint the task named
(`/api/v2/smart-contracts/{addr}`) returned **HTTP 403 (Cloudflare "Just a moment")**
with `User-Agent: ledge/1.0`, and **HTTP 500 `"Internal server error"`** with a
browser UA, repeatedly. What worked was the **v1 API**:

```
GET https://robinhoodchain.blockscout.com/api?module=contract&action=getsourcecode&address=0xF6e8...
User-Agent: <a browser UA — ledge/1.0 is 403'd by Cloudflare on Blockscout>
```

Returns `{message,result:[{ABI, SourceCode, AdditionalSources, ContractName, …}]}`.
It is **flaky**: roughly half of calls return
`{"message":"Something went wrong.","result":null,"status":"0"}`; retry with backoff.
**Later in the same session Blockscout degraded completely** — 25 consecutive
retries on the *known-verified* curve and factory addresses all failed. Treat
Blockscout as best-effort only; the RPC never failed.

**Second, offline source for the same code:** the curve source is already inside
`pipeline/PonsV2LaunchFactory.blockscout.json` → `additional_sources` as
`contracts/src/v2/PonsV2BondingCurve.sol` (43,741 chars), along with
`PonsV2BondingCurveMath.sol`, `PonsV2MemeHook.sol`, `PonsV2GraduationExecutor.sol`,
`PonsV2BuybackVault.sol`, `PonsV2LaunchDeployer.sol`, `PonsV2LauncherToken.sol`.
No network call is needed to read Pons v2 source again.

**Bytecode cross-check (CONFIRMED):** the computed selectors below appear in the
deployed dispatcher in exactly the order the bytecode jumps them —
`0902f1ac…1936`, `15a55347…1919`, `160d0da5…18f4`, `24a9d853…18ba`, `31ff7f22…182a`,
`3729bb9a…16e0`, `3cd1fb8f…169c`, `3de35b79…1658`, `3f7ed6b7…163b`, `49127e2a…15fd`,
`4c37ef23…15e0`, `4f1f58fd…15bc`, `50e25ac2…159f`, `52920587…1404`, `59a87bc1…0e80`,
`64df049e…0e3b`. The ABI matches the deployed code.

### A2. The views that give fill toward graduation

Function selectors (computed with `pipeline/keccak.py`, all no-arg unless shown):

| selector | signature | meaning |
|---|---|---|
| `0x4f1f58fd` | `realQuoteReserve()` | **quote raised so far, net of fees/tax — the numerator of the fill bar** |
| `0x8b0bc501` | `graduationThreshold()` | **the denominator** |
| `0xca52b0b7` | `trackedQuote()` | gross quote held (incl. unswept fees) |
| `0xed479c47` | `quoteFeeBalance()` | pending protocol/buyback/creator fees |
| `0xdb2bd533` | `creatorTaxBalance()` | pending creator tax |
| `0x808bcddc` | `sellableTokens()` | tokens still buyable; **hits 0 exactly at graduation** |
| `0x4c37ef23` | `trackedTokens()` | tokens still on the curve |
| `0x15a55347` | `reservedTokens()` | the slice reserved to seed the V4 pool |
| `0x3f7ed6b7` | `launchSupply()` | 1e27 on every launch observed |
| `0xe7c2b772` | `graduated()` | bool |
| `0xc68360a5` | `readyToGraduate()` | bool — `!graduated && sellableTokens()==0` |
| `0x0902f1ac` | `getReserves()` | `(phantomQuote+realQuoteReserve, trackedTokens)` |
| `0x9da771f4` | `quoteReserve()` | first leg of `getReserves()` |
| `0xcbcb3171` | `tokenReserve()` | second leg |
| `0xc57eadfc` | `phantomQuote()` | virtual quote seeded at deploy |
| `0xbf56b371` | `launchedAt()` | unix ts, set in the launch tx |
| `0x24a9d853` | `feeBps()` | 100 on every launch observed |
| `0xc1bb8901` | `creatorTaxBps()` | creator-chosen, 0–1000 |
| `0x50e25ac2` / `0x6783774b` | `snipeTaxStartBps()` / `snipeTaxSeconds()` | 9900 / 3 observed on every launch |
| `0xd7e1ef39` | `currentSnipeTaxBps(address)` | live snipe tax for a buyer |
| `0x160d0da5` | `buybackEnabled()` | bool |
| `0xdc08e094` | `isNativeQuote()` | `pairToken == 0x0` |
| `0xfc0c546a` / `0x3de35b79` / `0xd5f39488` / `0xc45a0155` | `token()` / `pairToken()` / `deployer()` / `factory()` | wiring |
| `0x7809452a` | `buybackQuoteBalance()` | |
| `0xf1f5c993` `0xc4b7de97` `0x82589038` `0x3cd1fb8f` `0x64df049e` `0x9040f866` `0x49127e2a` `0x90addc1e` `0xd44bdfe7` | `buybackVault()` `feeEscrow()` `feePolicy()` `buybackCreatorRecipient()` `protocolFeeRecipient()` `protocolFeeShareBps()` `buybackBurnBps()` `maxInternalPriceImpactBps()` `snipeTaxExempt(address)` | policy |

Non-view: `0x59a87bc1 buy(uint256,uint256,address)`, `0xd04c6983 sell(uint256,uint256,address)`,
`0xff6d8d05 graduate(address)`, `0x3729bb9a sweepFees(uint256)`, `0xc4d66de8 initialize(address)`,
`0x31ff7f22 exemptFromSnipeTax(address)`, `0x7b04ea62 setCreatorFeeRecipient(address)`,
`0x9a9b567d setBuybackEnabled(bool)`, `0x52920587 rescueFees()`.

**There is no `progress()` / `percent()` view.** The fill bar must be computed:

```
progress_quote = realQuoteReserve() / graduationThreshold()          # the "X / 4.2 ETH" number
progress_token = 1 - sellableTokens() / (launchSupply - reservedTokens)   # token side
```

The two are **not equal** — the curve is constant-product, so the token side runs
ahead of the quote side (see the live sample below: 53.45% quote vs 73.9% token).
Both reach 100% at the same instant. From the source comment on `readyToGraduate()`:
graduation triggers on the **token side** (`sellableTokens()==0`), which is
"a hard stop the curve refuses to cross", while the quote side "is a floor that a
large trade could sail past". **Use `realQuoteReserve/graduationThreshold` for the
displayed bar** (it is the figure denominated in ETH that users recognise), and
`sellableTokens()==0` for the graduated/not decision.

**`graduationThreshold` is NOT always 4.2 ETH.** It is per-pair-token, set by
`getLaunchConfig`/`pairTokenEconomics`, and it comes in the `TokenLaunched` event
itself (data word 2), so a live view never has to guess. Values CONFIRMED this session:

| pairToken | threshold (raw) | phantomQuote (raw) | ratio |
|---|---|---|---|
| `0x0` (ETH, 18dp) | `4200000000000000000` = 4.2 | `1680000000000000000` = 1.68 | 0.4 |
| `0x5fc5360d0400a0fd4f2af552add042d716f1d168` (USDG, 6dp) | `8090000000` = 8,090 | `3236000000` = 3,236 | 0.4 |
| `0xec262a75e413fafd0df80480274532c79d42da09` (18dp) | `79980227385071671620` ≈ 79.98 | `31992090954028668648` ≈ 31.99 | 0.4 |

`phantomQuote = 0.4 × graduationThreshold` on every launch observed, and
`reservedTokens = launchSupply × phantomQuote / (phantomQuote + threshold)`
= `285714285714285714285714285` (28.571% of 1e27) on **every** launch — CONFIRMED
identical across ETH, USDG and ERC-20 pairs.

#### Verified `eth_call` results

**(a) A graduated token.** `0x9b927d143392f6cbd52a490a9cc6595a56dbc70e`, from
`data/graduations/2026-09-06.jsonl` (grad block 56,030,920), curve
`0x0c7c6bd603ba4262a15b69d9c01d627ff3d25236`:

```
token                0x9b927d143392f6cbd52a490a9cc6595a56dbc70e
pairToken            0x5fc5360d0400a0fd4f2af552add042d716f1d168   (USDG)
graduated            True          readyToGraduate  False
graduationThreshold  8090000000
realQuoteReserve     0             trackedQuote     0
sellableTokens       0             trackedTokens    0
reservedTokens       285714285714285714285714285
launchSupply         1000000000000000000000000000
launchedAt           1788702869    phantomQuote     3236000000
feeBps 100  creatorTaxBps 0  snipeTaxStartBps 9900  snipeTaxSeconds 3
buybackEnabled False  isNativeQuote False
deployer 0x4819c90dbe46335d5682ccd619d5d9c2b4066840
factory  0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e
```

**Gotcha (important for the live view):** after graduation the curve is *drained* —
`trackedQuote`, `realQuoteReserve`, `trackedTokens`, `sellableTokens` are all **0**.
A naive `realQuoteReserve/threshold` on a graduated token renders **0%, not 100%**.
Check `graduated()` first and pin the bar to 100%. The real raised amount at
graduation is in the `PoolGraduated` event's `pairTokenAmount`: for this token
`8090000115`, i.e. the threshold `8090000000` plus 115 wei of overshoot — a clean
independent confirmation that the threshold is what the curve fills to.

**(b) A launched-but-never-graduated ("dead") token.**
`0x93506fb3d39dda7472b0d12d4acaa3b4ee92aea1`, curve `0x36f0eeb62c426cf9daa52e0228f1297f23bda704`:

```
graduated False   readyToGraduate False
graduationThreshold 8090000000
realQuoteReserve    1            trackedQuote 509806   quoteFeeBalance 509805
sellableTokens      714285714285714285714285715   (= launchSupply - reservedTokens, untouched)
trackedTokens       1000000000000000000000000000  (full supply still on the curve)
launchedAt 1788702837   creatorTaxBps 0   isNativeQuote False
```
→ **progress 0.0000%**. Nothing was ever bought beyond dust that went entirely to fees.

**(c) A live, mid-curve token.** `0x1e0616d65ec5790d57cbe05489b9409a8561a01b`,
curve `0xd2414346044d5b597a14f2dd48175cdf0efd642a`, ETH-paired, read at ~`latest`:

```
graduated False   graduationThreshold 4200000000000000000 (4.2 ETH)
realQuoteReserve  2245000707691451167  ( 2.245001 ETH )
trackedQuote      2246295634063144907   quoteFeeBalance 1294926371693740
sellableTokens    186255805381267563488472674
trackedTokens     471970091095553277774186959
launchedAt 1788721060   phantomQuote 1.68e18   creatorTaxBps 0
```
→ **quote-side fill 2.245001 / 4.2 = 53.45%**;
   token-side fill `1 − 186,255,805/714,285,714` = **73.92%**. Same token, two bars.

### A3. Curve events — topic0s and decode (CONFIRMED)

All emitted by the **per-token curve contract**, so index by topic0 with no address filter.

| topic0 | event | topics | data words |
|---|---|---|---|
| `0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455` | **`CurveBuy(address,address,uint256,uint256,uint256,uint256)`** | `[0]=topic0, [1]=buyer, [2]=recipient` | `[0]=quoteIn, [1]=tokensOut, [2]=fee, [3]=tax` |
| `0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df` | **`CurveSell(address,address,uint256,uint256,uint256,uint256)`** | `[1]=seller, [2]=recipient` | `[0]=tokensIn, [1]=quoteOut, [2]=fee, [3]=tax` |
| `0xa69e8258ccc7b9bbb70ab953fc2d1062b4ee28b8ca827534097e1732e87b0262` | `CurveBuyRefunded(address,uint256)` | `[1]=buyer` | `[0]=refund` |
| `0xf8d37a90738ae063b8b8058b66f5880cf3cf7ab0c5d4fa78219696591dfbfb67` | `CurveCompleted(address,uint256,uint256)` | — | `recipient, quoteOut, tokenOut` |
| `0x908408e307fc569b417f6cbec5d5a06f44a0a505ac0479b47d421a4b2fd6a1e6` | `Initialized(address)` | — | `token` — **the per-curve "born" marker** |
| `0x9f4cd7c4ed99d08a797804560c9c5d71d2cf7e101f2e3b5e7d1ca8a24c370e4f` | `FeesSwept(uint256,uint256,uint256)` | — | `protocolAmount, buybackAmount, creatorAmount` |
| `0x3bc39a5562b28f5fe8f36cecabfbaa12bb969acf05717994709225fc412a9934` | `SnipeTaxCharged(address,uint256)` | `[1]=recipient` | `amount` |
| `0xe4b7e48fbd47c2f602bacadee76ad33b16542ddb4997cfc0de04c311adcfa8c7` | `SnipeTaxExempted(address)` | `[1]=account` | — |
| `0x2cc664e1ac1e2d05c0d4637bb63ec8189113b6ac39276be8977e26216a8cdd19` | `CreatorFeeRecipientUpdated(address,address)` *(curve version — 2 args; the factory's 3-arg version is a different topic0, see Part B)* | `[1],[2]` | — |
| `0x5feba9b0d52c92ada4b9c571c2bee52390c54f2947208ab250221e6ee32f12ff` | `BuybackLocked(uint256,uint256)` | — | `quoteSpent, tokensLocked` |
| `0xbfe799fb5e0148a5f2590ff531306d42a5d512b74a5029ceb805abb808b0f1a0` | `BuybackEnabledUpdated(bool)` | — | `enabled` |
| `0x6460dc5c867a0678a8bcc5e64f629fae539901c53a4a8b42fe21d7a6c5e6437d` | `FeesRescued(address,address,uint256,uint256)` | `[1],[2]` | `protocolAmount, creatorAmount` |
| `0xe2cd2f31ebc05ec28640102987f4c8fc5f20e269e1b3aa82577f3f2f0e35c7c6` | `AutoGraduationFailed(address,uint256)` | `[1]=token` | `gasRemaining` |

**Real `CurveBuy` log, decoded (CONFIRMED):**
tx `0x0a2be9bb3c978a508c5cc90efce1c7e0aefef037311d6af08791e7fc915fc15d`, block 56,210,239, logIndex 8

```json
{"address":"0xef1e0f0110998bd3a293db10b98d4ec57db1c73f",
 "topics":["0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455",
           "0x0000000000000000000000002a4d34cd09a36f59ae3bedc0880cd5da929321d7",
           "0x0000000000000000000000002a4d34cd09a36f59ae3bedc0880cd5da929321d7"],
 "data":"0x0000000000000000000000000000000000000000000000000a14af39b3c54f00
           0000000000000000000000000000000000000000000e257fd77cd49c575631f8
           0000000000000000000000000000000000000000000000000019ce8d60848878
           0000000000000000000000000000000000000000000000000000000000000000"}
```
→ curve `0xef1e0f01…`, buyer = recipient = `0x2a4d34cd09a36f59ae3bedc0880cd5da929321d7`,
`quoteIn = 726398102277541632` (0.7263981), `tokensOut = 17102047298487729643729400` (17.10M),
`fee = 7263981022775416` (exactly 1.00% of quoteIn → confirms `feeBps = 100`), `tax = 0`.

**Note:** `eth_getLogs` on this RPC returns `"blockTimestamp":"0x0"` — the field is
present but always zero. Timestamps must come from `eth_getBlockByNumber`.

#### Reconstructing fill from logs alone — VERIFIED EXACT

From the source (`buy` at line 507-518, `sell` at 561-565, `_accrueFees` at 712-713):

```
CurveBuy :  trackedQuote += quoteIn ; quoteFeeBalance += fee ; creatorTaxBalance += tax
CurveSell:  trackedQuote -= quoteOut; quoteFeeBalance += fee ; creatorTaxBalance += tax
FeesSwept:  trackedQuote and the fee balances fall by the same amount  → no net effect
```
and since `realQuoteReserve = trackedQuote − quoteFeeBalance − creatorTaxBalance`:

```
realQuoteReserve = Σ_buy (quoteIn − fee − tax)  −  Σ_sell (quoteOut + fee + tax)
trackedTokens    = launchSupply − Σ_buy tokensOut + Σ_sell tokensIn
progress         = realQuoteReserve / graduationThreshold   (from TokenLaunched word[2])
```
`fee` in `CurveBuy` already **includes the snipe tax** (`emit CurveBuy(..., fee + snipeTax, tax)`),
so do not add `SnipeTaxCharged` on top — it would double-count.

**Verification run.** Curve `0xd2414346044d5b597a14f2dd48175cdf0efd642a`, all 736 of its
logs from block 56,208,036 → 56,212,035 (382 `CurveBuy`, 330 `CurveSell`, 17 `FeesSwept`,
5 `SnipeTaxExempted`, 1 `Initialized`, 1 `SnipeTaxCharged`), compared against `eth_call`
pinned at block **56,212,035**:

```
log-derived realQuoteReserve  39100601060734006
on-chain    realQuoteReserve  39100601060734006     ✅ EXACT MATCH
log-derived trackedTokens     977255199005452194068638155
on-chain    trackedTokens     977255199005452194068638155  ✅ EXACT MATCH
unique buyers from logs: 248
```

So a log-only indexer needs **zero polling** for fill and buyer counts. (Note the same
token was at 53.45% earlier in this session and 0.93% at this pinned block — sells
pull the bar back down. "Walking the ledge" is literal.)

`eth_call` with a **historical block number** works on this public RPC (archive state
available at least ~4,000 blocks back), which is what made the pinned comparison possible.

### A4. CORS — can a browser call these directly?

**RPC: YES, fully open. CONFIRMED.**

```
$ curl -i -X OPTIONS -H 'Origin: https://ledge.tools' \
       -H 'Access-Control-Request-Method: POST' \
       -H 'Access-Control-Request-Headers: content-type' \
       https://rpc.mainnet.chain.robinhood.com
HTTP/2 204
access-control-allow-origin: *
access-control-allow-headers: content-type
access-control-allow-methods: POST
access-control-max-age: 600
vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
server: cloudflare
```
```
$ curl -i -H 'Origin: https://ledge.tools' -H 'Content-Type: application/json' \
       -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
       https://rpc.mainnet.chain.robinhood.com
HTTP/2 200
access-control-allow-origin: *
{"jsonrpc":"2.0","id":1,"result":"0x359af8a"}
```
Preflight is answered, `POST` is allowed, `content-type` is allowed, and
`access-control-allow-origin: *` is on both. A browser can `fetch()` this RPC directly
from `https://ledge.tools`. **The `User-Agent: ledge/1.0` requirement does not apply
in the browser** — the same request with a normal Chrome UA + `Origin` header also
returned 200. (Browsers cannot set `User-Agent` anyway.) The 403 seen from curl with
an unusual UA is Cloudflare bot-scoring on the *server pages*, not the RPC.

**Rate limit is the real browser constraint, not CORS.** A single JSON-RPC batch of
**23 `eth_call`s in one request returned HTTP 429**. Batches of **8** with ~1.5 s
between them were stable across dozens of calls. Budget accordingly in the client.

**Blockscout: could not confirm.** Every attempt to observe its CORS headers this
session returned **500** before any `access-control-allow-origin` header was emitted
(with and without `Origin: https://ledge.tools`). The task brief states it is CORS-open;
**that was NOT reproducible today** — Blockscout was returning 403/500 on both v1 and v2
for hours, including on addresses it had served 30 minutes earlier. **UNCONFIRMED.**
Recommendation: **do not put Blockscout on the browser's critical path.** Everything the
live view needs is available from the RPC, which is confirmed CORS-open.

### A5. Recipe — "paste a token address"

```
1. eth_call factory.getLaunchedToken(token)  → 0x3cf28b5a + padded token, to 0x7eD598…
     word[1]=curve  word[4]=pairToken  word[5]=graduationThreshold
     word[8]=creatorTaxBps  word[10]=phase  word[14]=exists
   exists==0  →  not a Pons v2 token.
2. eth_call on word[1] (the curve), batched ≤8:
     graduated() readyToGraduate() realQuoteReserve() graduationThreshold()
     sellableTokens() trackedTokens() launchSupply() reservedTokens() launchedAt()
     creatorTaxBps() buybackEnabled() deployer()
3. progress = graduated() ? 1.0 : realQuoteReserve()/graduationThreshold()
4. buyers / trade tape: eth_getLogs {address: curve} for the CurveBuy/CurveSell topic0s
   from the token's launch block. (Per-token here; global feed uses topic0 only.)
```
`phase` semantics from `PONS_CONTRACTS.md` (0 = live, 2 = graduated) were **not
re-verified this session**; `graduated()` on the curve is the direct check and was.

---

## Part B — other Robinhood Chain launchpads

### Method

1. Web search (subagent) produced candidate factory addresses from each venue's docs
   and from third-party indexer docs (Bitquery / Mobula).
2. **Every candidate was then checked on-chain** — `eth_getCode`, then
   `eth_getLogs` filtered to that address over a **1,000-block** window
   (56,213,698 → 56,214,697) and, for anything that came back empty, over a
   **40,000-block** window (≈67 min at ~0.101 s/block).
3. Independently, a **discovery pass** that does not depend on web sources at all:
   an unfiltered `eth_getLogs` over 100 blocks (8,189 logs, 536 distinct contracts),
   filter to `Transfer(0x0 → x)` mints (222 mint txs), then `eth_getTransactionByHash`
   on each and rank the `to` addresses. That names every launch entrypoint actually
   used in the window, whether or not it has a website.

### Activity ranking (log volume, same 40,000-block window: 56,180,348 → 56,220,347)

| rank | venue | address | code? | logs / 40k blk | launches/hr | verdict |
|---|---|---|---|---|---|---|
| 1 | **Pons v2** | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` | 24,177 B | **1,873** | **≈1,193** | dominant |
| 2 | **flap.sh** | `0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09` | 2,840 B (ERC-1967 proxy) | **1,409** | unconfirmed | clearly alive |
| 3 | **pools.trade** | `0x000000e200088d55c39a11f609e5f667729ad49b` | 13,380 B | **16** | unconfirmed | barely alive |
| 4 | **bow.fun** (FactoryHub) | `0x229Faa919ABf14279E2461Dba53F039c5B4C7E29` | 130 B (ERC-1967 proxy) | **0** (2 in an adjacent 40k window) | ~0 | effectively dead |
| — | **hood.fun** | `0x626C3d09B65bF5d1D40E0D5F25e19fa49783B3D4` | 15,657 B | **0** | 0 | deployed, silent |
| — | **bow.fun** (alt, per Mobula) | `0xc70e510e14710ea535cab7b2414860af63feab79` | 16,318 B | **0** | 0 | deployed, silent |
| — | **Pons v1** | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` | 24,353 B | **0** | 0 | superseded by v2 |
| — | **ArrowPad** | `0x8660A7F019C7943b0b0A91B8E39AFf3b6DB6Ae62` | 145 B (ERC-1967 proxy) | **0** | 0 | deployed, silent |
| ? | **unknown, discovered on-chain** | `0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc` | — | 228 / **100** blocks | — | **#1 mint entrypoint** — see below |
| ? | unknown | `0x6131b5fae19ea4f9d964eac0408e4408b66337b5` | — | 276 / 100 blocks | — | unidentified |
| ? | unknown | `0xccc88a9d1b4ed6b0eaba998850414b24f1c315be` | — | 145 / 100 blocks | — | unidentified |

**Caveat on the web-sourced addresses:** all eight have real deployed code on chain 4663,
which is a strong sign none is fabricated, but I could **not** independently verify that
any of them belongs to the site it was attributed to — Blockscout's source endpoint was
down for every one of them (25 retries each). The four with zero logs may be dead, or may
be non-emitting routers whose events live on per-token contracts (exactly Pons's pattern).
**Their attribution to hood.fun / bow.fun / pools.trade / ArrowPad is UNCONFIRMED.**

### Pons v2 — full event map (CONFIRMED, from the verified factory ABI)

| topic0 | event | args |
|---|---|---|
| `0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607` | **`TokenLaunched(address,address,address,address,uint256,uint256)`** | idx `token, curve, deployer`; data `pairToken, launchConfigId, graduationThreshold` |
| `0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259` | **`PoolGraduated(address,uint256,uint256,uint256)`** | idx `token`; data `positionId, tokenAmount, pairTokenAmount` |
| `0xcdb72f157fd3666758a6ce201387ffb52038c7562e4fff352828da1096c4b6b4` | `LaunchSwept(address,uint256,uint256)` | idx `token`; `quoteOut, tokenOut` |
| `0xa0a18f5bf205becee8b268d7cf69addab8548ae8ef361791464cf0e0e17c1361` | `GraduationTokensPermanentlyLocked(address,uint256)` | idx `token`; `amount` |
| `0x308c390ed1ab5873392818e036cabdf408bc8ad042fbaead3108954ff75ba980` | `CreatorFeeRecipientUpdated(address,address,address)` | idx `token, previousRecipient, newRecipient` |
| `0x7f119e44c84a715429bee60d30ad2e14afdef6c60bb1a7eaa01290ecf6d1b2e5` | `CreatorFeeRecipientChangeProposed(address,address,address,uint256,uint256)` | |
| `0xbe2de91c1cbef653c760573fff8355c0c851d35ed2a898342b4db556301cccf4` | `CreatorFeeRecipientChangeCancelled(address,address)` | |
| `0xbd886f85b7731f66269f57707414d435bf8df930d3357a10becc48a69377f6d5` | `BuybackEnabledUpdated(address,bool,address)` | |
| `0x7017304fdd491394686dce984eac721f0be1a22228346210f16694772bde44ca` | `LaunchGraduationRescued(address,address,uint256,uint256)` | |
| `0x52c1a28345695afc7f6b7629133124dec5d61ee745affd65e4fd2a776bc05840` | `LaunchForceSwept(address)` | |
| `0x67d517ee0e305d608b8410ddef27bbd2ed964d843d9b936e84ea2ad1bd65e5d1` | `PairTokenEconomicsUpdated(address,uint256,uint256,uint8)` | `pairToken, phantomQuote, graduationThreshold, decimals` |
| `0x060d1992d069dc524985f328329aae36102a017c59733c5c91fc0691ee0703b6` | `PairTokenApprovalUpdated(address,bool)` | |
| `0xedd96c570c6e5ef9add0378e59df53579a283889dc5dab6440ef6eca2ee6c8ce` / `0x2f8ba78ae68cfd0c82c7756c540eaf4eead3341aef9ccebcb91d546bff10d62b` | `LaunchConfigAdded(uint256)` / `LaunchConfigUpdated(uint256)` | |
| `0xc799be5eb19a1a6d6ba7368d21e2bc367c8a335e4a07cd3d954482e6f714d3c5` | `LaunchFeeUpdated(uint256)` | |
| `0x3e99ceb3e222d2214d53dacca902810db845f156f78152fdc076be628c4e9a40` | `MaxCreatorTaxUpdated(uint256)` | |
| `0x82d0fc041b26338f6e9cc240adde9cbe5b20064b4cb39ab96c953d5643687b1e` / `0x2b1bf8cf5a401a6dd314ae29520988783e31f0e50ec734aa9ef26b8b7ff24a1f` | `SnipeTaxStartBpsUpdated(uint256)` / `SnipeTaxSecondsUpdated(uint256)` | |
| `0x4f1ea5016c51c2f82324e00e9b8a4a95ee5aeaa10c653dabaec5f1bc9047ba0b` | `LaunchEnabledUpdated(bool)` | |
| `0xef2b562a67f01ed4b7c4265ec09b539039c6d5dd7e752191d3940508c3dc0068` | `WhitelistedLauncherUpdated(address,bool)` | |
| `0xac04674474e93058fae25e6df5dd94f57cdcacfe560a182a2eefc8c6006fbf6f` / `0xd5ea7aa3e328a0594dcf6914cd9e5369779efaa194ee4dd4c5afcad4f4ebbb0c` / `0x56b32d3633fed72f97c4df44a78b5fa04f1d662d4bddebcd8a9b216d26d093ad` | `GraduationExecutorSet` / `LaunchDeployerSet` / `LaunchForwarderSet` | |
| `0x38d16b8cac22d99fc7c124b9cd0de2d3fa1faef420bfe791d8c362d765e22700` / `0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0` | `OwnershipTransferStarted` / `OwnershipTransferred` | |

Observed counts in the 40,000-block window (CONFIRMED):
`TokenLaunched` **1,338** · `CreatorFeeRecipientUpdated` 469 · `LaunchSwept` **22** ·
`GraduationTokensPermanentlyLocked` **22** · `PoolGraduated` **22**.

- launches ≈ **1,193/hour**
- graduations ≈ **19.6/hour**
- in-window ratio 22/1,338 = **1.64%** — this is *not* a cohort rate (the graduating
  tokens mostly launched before the window); it is only a same-window sanity number.
  The cohort-correct figure remains the 1.16% in `PONS_CONTRACTS.md`.
- The graduation triple always fires together: `LaunchSwept` = `GraduationTokensPermanentlyLocked`
  = `PoolGraduated` = 22. Any one of the three works as the graduation marker.
- **Graduation mechanic:** at `sellableTokens()==0` the curve's `graduate()` runs
  (auto, via `_tryAutoGraduate` on the crossing buy, or permissionlessly by anyone),
  the factory seeds a **Uniswap v4** pool through `poolManager()` / `positionManager()`
  with a custom `memeHook()`, mints an LP position (`positionId` in `PoolGraduated`),
  and permanently locks the graduation tokens. Confirmed from the verified factory ABI
  and `PonsV2GraduationExecutor.sol` / `PonsV2LaunchLocker.sol` in the verified source
  bundle. Uniswap **v4 `PoolManager` on this chain is `0x8366a39cc670b4001a1121b8f6a443a643e40951`**
  (Blockscout `ContractName: PoolManager`, file `src/pkgs/v4-core/src/PoolManager.sol`) —
  CONFIRMED, and its `Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)`
  topic0 `0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f` was the
  3rd-busiest topic chain-wide in the 100-block sample (475 logs).

### flap.sh — `0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09`

- **CONFIRMED:** ERC-1967 proxy. Storage slot
  `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc` =
  **implementation `0xa3b96df56f254b926b17d5f7fb6cd858c216ff44`**.
  This matches the web claim that flap.sh's router is the single log-emitting address
  for all its events (like an EntryPoint, everything surfaces on the proxy).
- **CONFIRMED:** 1,409 logs in the 40,000-block window, spread over **17 distinct topic0s**:

| topic0 | count |
|---|---|
| `0x115c78ad17c4763fb97bca94f3e59dc8cb2e59c9d3862f24a694ec401200f562` | 345 |
| `0x4c35e20d1e9bce377c7d9ec1572d934e46d62961f4da8af5beb8002d5906742d` | 345 |
| `0xb4aa5d6b2390b2b8892ff84cb0ef9a64e969e1af22d049fa61cc2cf66c6ab7bd` | 251 |
| `0xa800a2038683844fac66747f771bfdfae862eb28b16bcfa387afa9fbacce8ff7` | 205 |
| `0x03a4693e592f5e75dc7c136acb39b146d2b4966c0e509c34f362dee02b3b861a` | 140 |
| `0x6d7a33547efbe801870d2426853a4aa2ae198acb815783fb3fc3d853a944202b` | 51 |
| `0x504e7f360b2e5fe33cbaaae4c593bc55305328341bf79009e43e0e3b7f699603` | 8 |
| `0x71a10912a55f73d3cced0d1515c2b33c396c80342522bad0e295ccbede556f37` | 8 |
| `0x6f10bbe11587431707df676556a0551025a4f66551acdddc5793389e20f0d46e` | 8 |
| `0x37502bf23c59a12e1036e7580a8dc056803623dbcd0885abb882adfa069ac89e` | 8 |
| `0x3ceb902d3c555c21c3415b6aa839104b18e4825b2f8324011ff979089a507a8c` | 8 |
| `0xcf2372b9357f0d392563d2cedb11e2b3bf0c14d2b8b75eb8bad073bbea9b0ff9` | 8 |
| `0x6b3125ac92c93333dab20ade84015b8cde845176b110057b49a81768c0cda374` | 8 |
| `0x1546924f4680b1b2e093fd251c437c8781d81a21ed8ad1895e1f2c9b78db0cd0` | 6 |
| `0x46cc246a238d1ca0951a15200994903e2d56cbb0389e63f09d66412a787aa3c0` | 6 |
| `0xafcebb99a3d0047f96f0d1cc8872781aaeef86f4f5e7e1c6a33e5907d6a3ed82` | 2 |
| `0x16f7f7185702757d3ae091c2aaad3cee3a5e0bb82ac2a51fbc9af44651b5080c` | 2 |

  Sample log for the top topic: tx `0xc38748ae6a198f0718d2ddc054133028bc4a9b4fa9c36380d913b853b9ba8c4f`,
  block `0x3592c35`, **1 topic (unindexed)**, data 2 words:
  `0x…462f9322569e0c7f715cf1a823a9d035acd37777` + `0x…0b1e19e223b4528364c63c` →
  an `(address, uint256)` pair. The exact 345/345 tie between the top two topics is the
  shape of two events emitted together on every operation.
- **NOT CONFIRMED:** which topic is "launch" and which is "graduation", their argument
  names, the graduation threshold, or the destination DEX. Blockscout's source endpoint
  failed 25 consecutive times for both the proxy and the implementation, so no ABI could
  be obtained. A brute-force of ~50 common event names × 0–4 params over 17 primitive
  types produced **no match** for any flap.sh topic0 — the names are not the obvious ones.
  Exact scope of that brute-force: **276,660 signatures** — 53 candidate event names
  (`TokenCreated`, `TokenLaunched`, `Launched`, `Created`, `Trade`, `Buy`, `Sell`, `Swap`,
  `Graduated`, `Migrated`, `Bonded`, `PoolCreated`, `Transfer`, `Mint`, … ) × 0–3 params
  over 17 primitive types. **Zero matches** against any of the 17 unresolved topic0s in
  this document (flap.sh ×5, pools.trade, bow.fun, `0x65050a9b…` ×2, `0x6131b5fa…` ×3,
  `0xccc88a9d…`, and 4 busy chain-wide topics). The names are not conventional.
  **To finish this: retry `api?module=contract&action=getsourcecode&address=0xa3b96df56f254b926b17d5f7fb6cd858c216ff44`
  when Blockscout recovers.**

### pools.trade — `0x000000e200088d55c39a11f609e5f667729ad49b`

- **CONFIRMED:** 13,380 bytes of code, **not** a proxy (EIP-1967 impl slot is zero).
- **CONFIRMED:** 16 logs in 40,000 blocks, **all one topic0**
  `0x4ef8284ecf42d4cd19686572ffd87f630858c82398911e776cb831de35eddbf4`,
  unindexed (1 topic), long ABI-encoded data whose first word is an address
  (`0x160828aeb551351fa96004ee9bb550650c6004e1` in the sample) followed by offsets
  `0x40 / 0x80 / 0x1c0 / 0x1e0` — i.e. a struct with dynamic fields, the classic shape
  of a "token launched with name/symbol/metadata" event. ≈**14 events/hour**.
- **NOT CONFIRMED:** the event's name and field layout, the graduation threshold, and
  whether graduation is a separate event (none was seen in 67 minutes — plausible at
  this rate). Web sources say pools.trade is Uniswap Labs' launchpad ending in plain
  Uniswap v4 pools; **not independently verified on chain.**

### bow.fun — `0x229Faa919ABf14279E2461Dba53F039c5B4C7E29`

- **CONFIRMED:** 130 bytes of code, ERC-1967 proxy → implementation
  `0xda788f3cfcd27d145f4b16372f6b655f835feccb`.
- **CONFIRMED:** 0 logs in the 40,000-block window ending 56,220,347; **2 logs** in the
  earlier 40,000-block window ending 56,215,257. Topic0
  `0x65f174315961cf8b1c0d0763569c6c8746f20dc81df9151164bec284e6ed9f01`,
  4 topics (3 indexed: `0xae805c90e0db858f06c7db472753c1d97dcd3b03`,
  `0x93c5ef8cf8fb5db67058c5c06b821adbf18d65b8`, `0x…03`). **≈0.05 events/hour** —
  a rounding error next to Pons.
- The alternate address from Mobula's docs, `0xc70e510e14710ea535cab7b2414860af63feab79`
  (16,318 bytes, not a proxy), emitted **0 logs** in either window.
- **NOT CONFIRMED:** the "3.7 ETH graduation threshold → Uniswap V3 (standard) / V4 (RWA)"
  claim from bow.fun's own docs. No on-chain evidence either way; too few events to sample.

### hood.fun — `0x626C3d09B65bF5d1D40E0D5F25e19fa49783B3D4`

- **CONFIRMED:** 15,657 bytes of code exist at that address on chain 4663, not a proxy.
- **CONFIRMED:** **0 logs** across both 40,000-block windows (≈2¼ hours of chain).
- **NOT CONFIRMED:** that this address is hood.fun's factory at all, or the
  "bonding curve sells out → Uniswap V3, LP locked forever" mechanic. The address came
  from a web citation of hood.fun's whitepaper; Blockscout could not confirm the contract
  name; and the contract is emitting nothing, so no event-shape evidence is available.
  **What was tried:** `eth_getCode` (code present), address-filtered `eth_getLogs` over
  1,000 and 40,000 blocks (zero), EIP-1967 impl slot (zero), Blockscout
  `getsourcecode` ×25 (all failed).

### ArrowPad / Pons v1 — `0x8660A7…` / `0xA5aAb3F0…`

- ArrowPad `0x8660A7F019C7943b0b0A91B8E39AFf3b6DB6Ae62`: 145 bytes, ERC-1967 proxy →
  impl `0x8000b64b62837a1511e302c62354e1bc39b5641a`. **0 logs** in both windows.
- Pons v1 `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB`: 24,353 bytes of code, **0 logs**
  in both windows — consistent with v1 being fully superseded by v2 on 2026-08-04.
  Attribution to Pons v1 is **UNCONFIRMED** (web-sourced, Blockscout down).

### Unidentified but genuinely busy contracts (found on-chain, no web attribution)

These outrank several of the named venues and should be chased before any of them:

- **`0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc` — the single biggest token-mint
  entrypoint on the chain.** In the 100-block discovery window it was the `to` of
  **85 of 222** mint transactions (call selector `0x4d819a2a`), and emitted 228 logs
  under exactly **two** topic0s:
  - `0x8619026a40d38bedb4002fe511cea4bc4a9b336710efe8f21a61869a7ee0f02a` ×118 — 4 topics
    (3 indexed), **16 data words** — a metadata-heavy "created" shape
  - `0x205442d60b70af1203d43cab62352c3b69b94f091be32fe683198057282b5c92` ×110 — 3 topics
    (2 indexed), 2 data words
  Extrapolated ≈**4,200 events/hour**. `name()`/`symbol()` revert; Blockscout could not
  resolve it (retried at three separate points in the session). A ~110–118 launches-per-100-blocks rate would make this **comparable to or
  larger than Pons v2 by launch count** — this is the most important open item in Part B.
  **UNIDENTIFIED.**
- `0x6131b5fae19ea4f9d964eac0408e4408b66337b5` — 276 logs / 100 blocks, three topic0s in
  a perfect 92/92/92 tie (`0xd6d4f568…`, `0xddac4093…`, `0x095e66fa…`), all unindexed —
  three events fired together on every operation. **UNIDENTIFIED.**
- `0xccc88a9d1b4ed6b0eaba998850414b24f1c315be` — 145 logs / 100 blocks, one topic0
  `0xafbab204e8271965231d37baed9b1abca8725b7409c70314455f68bc89142b91`,
  unindexed, 8 data words. **UNIDENTIFIED.**
- `0xe492912f37c2a4eca45d42dc67548f4c6cd7ce2b` — 7 mint txs, **same call selector
  `0x4d819a2a`** as `0x65050a9b…`; likely the same software, second deployment.
- `0x4a86009a36fcec5aa341ffceb3205a911fcf6f60` (6 mints, selector `0x3e0f9c3c`),
  `0x89e5db8b5aa49aa85ac63f691524311aeb649eba` (10 mints, selector `0xb6f9de95` =
  `swapExactETHForTokensSupportingFeeOnTransferTokens` — a UniV2-style router, not a launchpad).

Chain infrastructure identified in passing (CONFIRMED via Blockscout while it was up):
`0x5fc5360d0400a0fd4f2af552add042d716f1d168` = **USDG** (Global Dollar, ERC1967Proxy) —
busiest contract on the chain; `0x0bd7d308f8e1639fab988df18a8011f41eacad73` = **WETH**;
`0x8366a39cc670b4001a1121b8f6a443a643e40951` = **Uniswap v4 PoolManager**;
`0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f` = **RelayRouterV3**;
`0x4337084d9e255ff0702461cf8895ce9e3b5ff108` and
`0x0000000071727de22e5e9d8baf0edac6f37da032` = **ERC-4337 EntryPoints** (v0.6 topic
`0x49628fd147…` = `UserOperationEvent`), i.e. a meaningful share of launches arrive
via account abstraction and the *bundler* is the tx `to`, not the launchpad.

### Cross-venue Number — what is actually supportable today

Only **Pons v2** has a confirmed launch event, a confirmed graduation event, and a
confirmed threshold. A cross-venue "graduation base rate" table is **not yet buildable**:
flap.sh and pools.trade have confirmed activity but unresolved event semantics, and the
biggest mint entrypoint on the chain is unidentified. The honest v1 cross-venue Number is
an **activity** comparison (events/hour, which is fully confirmed above), not a
graduation-rate comparison.

---

## Part C — existing "paste a token" cohort lookups for Pons

One line each, factual. These come from a web-research pass; the claims about each
site's *feature set* were not independently reproduced by me, so treat them as
**reported, not verified** — flagged individually.

- **PonsScan (`ponsscan.xyz`)** — Pons-only explorer; a pasted token shows creator
  history, holders, market state and graduation progress, and it **does** publish
  cohort-flavoured stats: a creator leaderboard ranked by graduations-in-24h with
  per-creator "grad rate" and "survival", plus a "legacy V1-era sample" splitting a
  fixed 12-token cohort into "holding > −50%" vs "collapsed ≤ −80%". *Reported;* the
  key qualifier is that it is **sampled, not a full-history base rate** — which is
  exactly the gap LEDGE fills.
- **GMGN (`gmgn.ai`)** — has a Robinhood Chain surface and resolves Pons tokens, but is
  a trading terminal: charts, sniper tools, smart-money and wallet tracking, per-token
  risk flags. **No cohort or base-rate statistics.** *Reported.*
- **DexScreener** — indexes Robinhood Chain pairs and resolves any token address, but
  shows only per-token price / liquidity / volume / txns; it cannot filter by launchpad
  or graduation status. **No cohort or base-rate statistics.** *Reported.*
- *(also seen: DEXTools announced Robinhood Chain support 2026-07-13 — charts and safety
  scores per pair, no cohort stats. Reported.)*

**Net:** nobody publishes "of the N tokens that looked like this one, X% graduated."
PonsScan is the only one in the neighbourhood, and it does it on a sample.

---

## What could NOT be confirmed — consolidated

| # | Item | Why |
|---|---|---|
| 1 | Blockscout CORS headers | Blockscout returned 403/500 on every request path this session; no `access-control-allow-origin` header was ever observable. Task brief says CORS-open; not reproducible today. |
| 2 | `/api/v2/smart-contracts/{addr}` for the curve | 403 with `ledge/1.0` (Cloudflare), 500 with a browser UA. Worked around via the **v1** `?module=contract&action=getsourcecode` endpoint. |
| 3 | flap.sh event names / graduation threshold / destination DEX | Neither proxy nor implementation source obtainable (25 retries each); brute-force of common event names found no match. |
| 4 | pools.trade event name and layout | Same — no ABI; only the topic0, its ABI-encoded shape and its rate are confirmed. |
| 5 | bow.fun's "3.7 ETH → Uniswap V3/V4" mechanic | Only 2 logs in ~2¼ hours of chain; no ABI; nothing to sample. |
| 6 | hood.fun factory attribution | Code exists at the web-sourced address but emits nothing and could not be named. Tried: getCode, 1k+40k-block getLogs, EIP-1967 slot, Blockscout ×25. |
| 7 | ArrowPad and Pons v1 factory attribution | Same as #6 — code present, zero logs, no source. |
| 8 | Identity of `0x65050a9b…`, `0x6131b5fa…`, `0xccc88a9d…` | Busy contracts with no `name()`/`symbol()` and no reachable source. `0x65050a9b…` in particular may be a launchpad on Pons's scale. |
| 9 | `phase` field semantics in `getLaunchedToken` | Carried over from `PONS_CONTRACTS.md`; not re-verified this session. `graduated()` on the curve was verified and is the better check. |
| 10 | Part C feature claims | Web-sourced; not reproduced by me directly. |
| 11 | Cross-venue graduation base rates | Blocked on #3–#8. |

## Reproduction notes

- RPC never failed and never rate-limited on `eth_getLogs` at ≤1,000-block windows with
  ~1 s pacing. It **did** 429 on a 23-call `eth_call` batch; **8 per batch, 1.5 s apart** was stable.
- Unfiltered `eth_getLogs` over **100 blocks** works and returns ~8,200 logs — this is the
  cheapest venue-discovery primitive on this chain.
- `eth_call` at a historical block number is served (archive state available ≥4,000 blocks back).
- Blockscout: use the **v1** `?module=contract&action=…` API with a **browser User-Agent**,
  expect ~50% failure, sleep ≥3 s, and never depend on it in the browser. **Final state
  at end of session: fully down** — 6 retries on the *known-verified* curve
  `0xF6e8…` (which it had served successfully ~90 minutes earlier) all failed. Any
  Blockscout-dependent item below should simply be retried on another day; it is an
  outage, not a "not verified" answer about the contracts.

### Blockscout retry list (for when it recovers)

Final tally: **14 addresses × 25 retries each = 350 consecutive failed
`getsourcecode` calls**, plus 6 more on the known-verified curve and factory. Not one
succeeded. Re-run exactly this list to close items #3-#8 in the table above:

```
0xa3b96df56f254b926b17d5f7fb6cd858c216ff44   flap.sh implementation   <- highest value
0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc   unidentified #1 mint entrypoint <- highest value
0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09   flap.sh proxy
0x000000e200088d55c39a11f609e5f667729ad49b   pools.trade?
0x626C3d09B65bF5d1D40E0D5F25e19fa49783B3D4   hood.fun?
0xda788f3cfcd27d145f4b16372f6b655f835feccb   bow.fun FactoryHub implementation
0xc70e510e14710ea535cab7b2414860af63feab79   bow.fun alt?
0x8000b64b62837a1511e302c62354e1bc39b5641a   ArrowPad implementation
0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB   Pons v1?
0x6131b5fae19ea4f9d964eac0408e4408b66337b5   unidentified (276 logs/100 blk)
0xccc88a9d1b4ed6b0eaba998850414b24f1c315be   unidentified (145 logs/100 blk)
0xe492912f37c2a4eca45d42dc67548f4c6cd7ce2b   same call selector as 0x65050a9b...
```
Health-check first with `0xF6e86610771ee7838cABE2f9c376265CA25EF04c` (known verified):
if that returns no result, Blockscout is still down and the run is wasted.

## Files written

- `pipeline/PonsV2Curve.blockscout.json` — verified `PonsV2BondingCurve` ABI + metadata (82 entries)
- `RESEARCH-PHASE2-3.md` — this file
