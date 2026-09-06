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
├── state.json                        # crawl cursor: headBlock, firstIndexedBlock, crawledAt
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

## Method

Full definitions — what counts as a launch and a graduation, the five-minute
threshold, cohort buckets, and the changelog of any definition change — live
at `/method` on the published site, sourced from `METHOD.md` in this repo.
