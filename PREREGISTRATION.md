# Pre-registration: LEDGE's own launch

**Frozen 2026-09-17.** Written 2026-09-12 from `data/number.json` as of
crawl 2026-09-12T06:06Z. `REVAMP.md` 1.5 says this must exist, dated and
immutable, before the token does, or it is worthless. The commit that
carries this line is the hash shown in the homepage slot, on `/launch` and
on `/method`; nothing above the "Outcome" heading is edited after it.

**Owner decisions, 2026-09-12.** Creator tax **3%**. Both commitments below
confirmed **as written**.

**Launch window, decided 2026-09-17: Friday 19 September 2026, 16:00 UTC.**
Chosen for when most of the venue is awake: 58% of all pons launches on
record are made between 14:00 and 24:00 UTC (n = 273,991), and 16:00 is the
middle of that band. It was not chosen from the hour-of-day graduation
rates, which this document says below it does not use. Friday happens to be
the day with the highest rate excluding fast graduations on the record as of
this date (0.95% of 17,566); that is noted so nobody can later say it was
hidden, and it played no part in the choice.

## What this is and is not

This is a statement, before the launch, of what we expect and what we will
publish afterwards, so that nobody — including us — can tell the story
differently once the outcome is known.

It is **not** evidence the tool works. One launch is n=1, and treating a
single outcome as proof is the error this site measures other people making.
What it demonstrates is method. The failure case is worth more than the
success case: nobody else on this venue will publish "we said this, we got
that, we were wrong."

## What is being launched

- Name / ticker: LEDGE. Venue: pons, Robinhood Chain (4663).
- Pair token: ETH. Graduation threshold: 4.2 ETH (per pair token; read from
  the factory at launch and shown on `/t/{address}`).
- Creator tax: 3%.
- Description: the 146-character line in `LAUNCH.md`.

## The reference class, from the published record

The cohort this launch belongs to is ETH-paired with a 2–3% creator tax.
All-time as of the crawl above:

| | launches | graduated | share | excluding graduations inside 5 min |
|---|---|---|---|---|
| ETH × 2–3% tax | 23,353 | 588 | 2.52% | 1.37% · 1 in 73 |
| all ETH-paired | 81,694 | 1,353 | 1.66% | 0.82% |
| all 2–3% tax | 32,033 | 768 | 2.40% | 1.27% |
| every launch | 168,993 | 3,005 | 1.78% | 0.72% · 1 in 140 |

Of the graduations that happen, 15% finish inside 10 seconds and 60% inside
5 minutes; the median is 167 seconds.

**That is the base rate: about 1 in 40 launches like this one graduates at
all, and about 1 in 73 graduates in a way that took longer than five
minutes.** Any expectation below is against that number.

## What we commit to, checkable by anyone

1. **The creator wallet does not buy on the curve.** Not in the launch
   block, not after. `/t/{address}` shows distinct buyers in the launch
   block; a graduation "in 8 seconds with 1 buyer" would put this launch in
   the population the site describes, and we would say so on the front
   page.
2. **No buys are arranged.** No bought volume, no coordinated fill. The
   only thing done to promote the launch is telling people it exists.
3. **Every reading is published as it happens**, from the same index and
   under the same definitions as every other token, on the front page:
   first-block buyers, fill, time to graduation or not, and — once the
   outcomes tracker runs — price at +1 h, +24 h and +7 d after graduation.

## What we expect

Stated as ranges against the base rate, not as a forecast for the token:

- **Graduation.** The base rate is 2.5%. This launch has one thing the base
  rate does not measure: a room of people who already trade on pons and
  were told about it in advance. We expect that to matter and cannot say
  by how much. We do not expect the launch to fill in under five minutes
  (commitment 1 and 2 make that very unlikely, and if it happens we will
  investigate who bought and publish what we find).
- **If it graduates, the timing will look like the slow population**, not
  the spike: tens of minutes to hours, not seconds. Anything under five
  minutes contradicts this and will be reported as such.
- **If it does not graduate**, that is the base-rate outcome, and it is
  published in exactly the same place with the same prominence.

## What we are not using

The hour-of-day effect. `METHOD.md` (2026-09-10) records why: raw and
organic orderings by hour barely agree, crowding explains a fifth of it, and
the whole thing may be who launches at that hour rather than anything about
the hour. The launch time is chosen for when the room is awake, and this
document does not claim the data supports that choice.

## How it is judged

- The token's `/t/{address}` page is the record. Its readings at launch
  +1 h, +24 h and +7 d are copied into the "Outcome" section below with
  their measurement times.
- Matched / not matched is stated for each expectation above, in one line
  each, without narrative.
- The outcome is posted on `/method` with the date and this file's
  pre-launch commit hash, and the homepage slot that carried this document
  carries the outcome.

---

## Outcome

*(empty until after launch)*

---

**Settled 2026-09-12:** creator tax 3% (the 2–3% cohort has the highest
graduation share in the record, 2.52%; 4–5% halves it to 0.77%), and
commitments 1 and 2 confirmed as written.

**Erratum, 2026-09-18.** The launch window above says "Friday 19 September
2026". 19 September 2026 is a Saturday. The date and hour stand: 19
September 2026, 16:00 UTC. The weekday was wrong, and the sentence about
Friday's graduation rate therefore describes a different day from the one
chosen. On the record as of this date Saturday's rate excluding fast
graduations is 0.81% of 33,623 launches. As the document already says, the
day played no part in the choice. Nothing above the Outcome heading is
edited; this note is the correction.

**Filled 2026-09-17:** the launch window, above. It was the last thing
decided, deliberately, because the data layer had to be solid before the
launch post pointed at it.
