# tests/vectors — the contract between Python and the live layer

These two files exist to make one sentence checkable:

> `pipeline/stats.py` stays the only place a statistic is defined. The live
> layer observes and looks up; it does not aggregate.

That is the spine of the Phase 2–4 architecture (`ARCHITECTURE-PHASE2-4.md`
§0). Without a gate it is an intention that survives exactly as long as the
people who agreed it. With one it is a fact that fails a build.

| File | Written by | Read by |
|---|---|---|
| `fixture-number.json` | `pipeline/vectors.py` | `worker/tests/node/vectors.test.ts` |
| `lookup.json` | `pipeline/vectors.py` | the same test |

Both are **generated**. Never hand-edit either one; regenerate:

```
python pipeline/vectors.py            # rewrite both files
python pipeline/vectors.py --check    # exit 1 if either is out of date
```

CI regenerates and diffs (`.github/workflows/ci.yml`, "vector gate"), and
`pipeline/tests/test_vectors.py` asserts the committed files are current, so a
stale file fails two jobs.

## What is in them

`fixture-number.json` is a complete `number.json`, built from the frozen
20-hour capture in `pipeline/tests/fixture-backfill-20h.json`. It is **not**
live data: an hourly crawl cannot turn the gate red.

`lookup.json` is a list of cases:

```jsonc
{
  "name": "cohort-n-30",
  "why": "a cell of exactly 30: the gate opens",
  "input":  { "pairClass": "other", "taxBps": 600, "elapsedSeconds": 600,
              "phase": 0, "graduated": false, "indexed": true },
  "expected": {
    "cohort":    { "crawledAt": …, "key": { "pairClass": "other", "taxBucket": "6-10%" },
                   "h24": { "window": "24h", … }, "allTime": { "window": "allTime", … } },
    "placement": { "crawledAt": …, "window": "allTime", "elapsedSeconds": 600,
                   "rung": { "atSeconds": 600, "cumulative": 409, "cumulativeShare": 0.764486 },
                   "n": 535, "insufficient": false, "reason": "ok" },
    "text": {
      "headline":  "minute 10 · on the curve · cohort 3.3% (n=30) · Other · 6–10%",
      "placement": "By 10 min, 76.4% of the 535 graduations measured in this window had already happened."
    }
  }
}
```

The Worker must produce the `expected` objects **by deep equality** and the
`expected` strings **character for character**, from its own
`lookup.ts` / `ladder.ts` / `text.ts`, given the `input` and
`fixture-number.json`. Nothing in `expected` may be computed on the TypeScript
side: every figure in it is a verbatim read out of `number.json`.

## Which boundaries are pinned, and why those

| Case | What it pins |
|---|---|
| `elapsed-below-first-rung` | younger than the ladder's first mark → `before_first_step`, never "not enough data" |
| `elapsed-on-first-rung`, `elapsed-on-ladder-mark` | a rung is inclusive exactly on its mark |
| `elapsed-one-second-before-mark` | one second under a mark stays on the rung below |
| `elapsed-on-last-rung`, `elapsed-past-last-rung` | the top rung holds past the end of the table |
| `elapsed-past-max` | older than any graduation measured → the outcome word "died" |
| `cohort-n-29` / `cohort-n-30` | the n = 30 gate, from both sides, in one cell each |
| `cohort-empty-cell`, `cohort-unobserved-pair-class` | a cell nothing landed in still publishes its n |
| `tax-not-recorded`, `tax-out-of-range` | no readable tax → no cell, and the card says so |
| `tax-bucket-boundary-*` | 0 / 1 / 100 / 101 / 300 / 301 / 500 / 501 / 1000 bps each land in one bucket only |
| `graduated-token` | an observed outcome, in the past tense |
| `not-indexed-token` | evicted from the live window: the cohort survives, the clock does not |

The n = 29 and n = 30 cells are engineered. The frozen capture carries block
numbers only — no timestamps and **no creator-tax readings at all** — so
`vectors.py` assigns tax deterministically (`_synthetic_tax_bps`), placing
exactly 29 launches in one cell and exactly 30 in the next. This is documented
loudly in that module and never touches `data/`.

## The rules a re-implementation must match

Both sides print numbers, and each language has a rounding rule that disagrees
with the other's. These are the two that bite:

- **Percentages** go through `toFixed`, which rounds half **up** on the exact
  binary value. Python's `format()` rounds half to **even** and would disagree
  at, for example, `1.125%`. `vectors.py` uses `Decimal(...).quantize(...,
  ROUND_HALF_UP)` to match. Precision is `n >= 1000 ? 2 : 1` decimals
  (`METHOD.md`, "Precision").
- **Durations** use `Math.round`, which takes ties toward `+∞`. Python's
  `round()` takes them to even. `vectors.py` uses `floor(x + 0.5)`.

Two more that look like tidying but are not:

- A count printed beside a rate is grouped (`n=3,566`); the `n` inside
  "not enough data (n=3566)" is not. That asymmetry is real and must be
  reproduced.
- Tax buckets are stored as `2-3%` and printed with an en dash, `2–3%`.

## When a case fails

A red case means the two sides disagree about a **published figure**. It is
never fixed by editing `lookup.json`.

1. Decide which side is wrong against `METHOD.md` and `ARCHITECTURE-PHASE2-4.md`.
2. If Python is wrong, fix `pipeline/stats.py` or `pipeline/vectors.py`, run
   `python pipeline/vectors.py`, and commit the regenerated files.
3. If the Worker is wrong, fix the Worker.
4. If the **definition** changed, that needs a dated `/method` changelog entry
   before either side moves (`CONSTRAINTS.md` §9).

Deleting a case, or loosening an assertion to make a build pass, removes the
only evidence that the Number on the site and the number in a shared link are
the same number.
