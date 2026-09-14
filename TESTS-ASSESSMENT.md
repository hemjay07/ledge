# The tests: are most of them dead weight? — assessment, 2026-09-14

The owner's feeling: "we have so many tests, I have a feeling the majority
should probably not exist." Three independent assessors read every test
file with different lenses (redundancy, what each test protects, cost),
without seeing each other's work; this is the comparison and the decision.
Every claim below was checked against the code before it was acted on;
the assessors were wrong in several places, which is why the checking is
the point.

## The numbers

| Suite | Tests | Wall time before | After today |
|---|---|---|---|
| pipeline (pytest) | 432 | 43 s | 43 s |
| site (vitest) | 346 | 17–21 s | same |
| worker/node (vitest) | 453 | 7.0 s | **1.3 s** |
| worker/workers (miniflare) | 91 | ~15 s | same |
| gateway (node:test) | 14 | 0.3 s | same |
| **total** | **1,336** | **~85 s** | **~79 s** |

Of the 1,336, the assessors between them flagged **about 30** as
removable (2%), and of those I could confirm **none** as safe to delete
without losing a protection. The suite is not bloated. It is slow in two
places and had one local-only annoyance, all fixed today.

## What the assessors agreed on (2 or 3 of 3)

- **Four tests are irreplaceable sentinels** and no one proposed touching
  them: the crawl-vs-recompute pin over a copy of the real record
  (`test_crawl.py`), the Python↔TypeScript vector gate
  (`test_vectors.py` + `worker/tests/node/vectors.test.ts`), the
  site↔worker schema parity test, and `site/tests/number-json.test.ts`.
  Each guards a divergence that has actually happened (INCIDENTS.md class
  1) or a Class A/B split the architecture depends on.
- Every incident in INCIDENTS.md has at least one test that would fail
  if it regressed, except the four that are environmental (quota, plan,
  endpoint refusals) — those are now covered by the gateway's own tests
  and its metrics, not by a unit test.
- The slow tests are two: the committed-record pin (18 s, and worth it —
  it is the one test that grows with production) and the Worker's
  RPC-client tests that slept through real backoff (6.5 s, now 0.2 s: the
  sleeper is injected and the *requested* delays are asserted, which is
  a stronger test, not a weaker one).

## Where the assessors were wrong, and how I know

| Claim | Check | Verdict |
|---|---|---|
| "11 site tests are time bombs with hard-coded dates that fail after Sep 2026" | `grep Date.now() site/tests` → no test reads the clock; every stamp is formatted from a fixed input | **False.** Formatting a fixed date is deterministic. Kept. |
| "`number-json.test.ts` fails on every CI run; remove it" | CI's prebuild copies the file first; it failed only locally because `pretest` did not | **False as stated.** Fixed the cause: `pretest` now copies `number.json` too. Kept — it is the deployment sentinel. |
| "`worker/tests/workers` cannot run (`cloudflare:test` missing)" | `npx vitest run --config vitest.workers.config.ts` → 91 passed, twice today | **False.** The assessor ran it from the wrong directory. |
| "`test_canonical::test_bytes_identical_across_two_runs` is a duplicate; remove" | No test of that name exists | **Cited a test that does not exist.** |
| "`the pattern itself catches what it is meant to catch` (lint.test.ts), `test_the_banned_word_check_can_fail`, `test_the_invariant_catches_a_wall_clock_measurement` are tautologies" | Each constructs a bad input and asserts the guard rejects it | **Opposite of tautology.** These are negative controls — the proof that a gate can fail, which INCIDENTS.md class 3 ("a test that agreed trivially") says every gate must have. Kept. |
| "16 tests in `test_dispatch.py` pin exact prose; replace with a structure check" | The strings *are* the specification of the weekly message, and the 2026-09-07 incident was exactly a wrong label ("7 days" over a 29-hour record) | **Kept.** A structure check would have passed that bug. |
| "`test_dispatch.py:223` and `:423` are duplicates" | One is the thin-window (n<30) case, the other the short-record (<7 days) case; different branches | Kept both. |

## What changed today

1. `worker/tests/node/rpc.test.ts`: three tests inject an instant sleeper
   and assert the pacing/backoff delays that were requested. 7.0 s → 1.3 s
   for the whole node suite.
2. `site/package.json` `pretest` copies `data/number.json` into
   `public/` before the run, so the byte-identity test is true locally
   for the same reason it is true in CI.
3. Nothing removed.

## Rule from here

Adding a test is cheap and deleting one is not, so the standard for
adding is the standard that keeps the suite honest: a new test must name
the failure it catches (an incident, a definition, a clause), and a gate
test must be shown red before it is shown green. A test that cannot say
what it catches is the only kind that should be deleted — and today none
of the 1,336 failed that question when read.
