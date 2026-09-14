# Is there a moat, and is there a real product? — 2026-09-14

The owner has asked this in five different ways since 6 September ("do we
have a real value", "is this moat any useful", "make sure it is of real
value", "not something we think might be useful but a real product").
This is the straight answer, written from the evidence we now have rather
than from hope. It supersedes the moat language in PLAN.md where they
disagree.

## 1. The data is not a moat. It never was.

The claim on 12 September was "our moat is data; if someone starts today
we still win because we collected earlier". The research on 13 September
settled it: Bitquery sells the full pons v2 history from 14 August for
$49/month, ponsscan.com indexes every trade live, and any competent person
with either can recompute every figure on our site — including first-buy
timing over the entire history — in an afternoon. Our forward record
starts 5 September; theirs starts earlier. A head start of days on data
that is public and purchasable is not a moat, and calling it one would
have led us to spend on the wrong thing (a node, an archive) for the wrong
reason. NODE-EVALUATION.md now says so explicitly.

What we do have that is *hard to copy* is smaller and different:

- **A published, defined, gated statistic with its n**, not a tape. Every
  number here has a definition on /method, a dated changelog when it
  changes, and a byte-for-byte recompute gate in CI. Nobody else on pons
  does this. It is copyable in principle; in practice nobody has, because
  it is slow, unglamorous, and pays only in trust.
- **The refusal to score or name wallets**, held as a constraint rather
  than a preference, which makes us quotable by people who cannot quote a
  scorer (the venue, a journalist, a trader arguing a loss).
- **A track record**, which compounds only with time and only if we are
  never caught wrong. Two days ago the site was 30 hours stale. That is
  the kind of thing that decides whether this becomes a moat or not.

So: no moat today. A *possible* one — being the reference — that is earned
over months by being right and present, and is lost in one bad week.

## 2. What is already real value, with evidence

Real value means a specific person opens the page because it answers a
question they actually have. We have one clear case and two half-cases.

**Clear: "was my launch sniped, and how common is that?"** Sniping is the
loudest complaint on X (RESEARCH §6); @rhanalyticsnow's one-day measurement
of "40% sniped" was widely quoted. We now publish the population figure
with n = 21,293: 79.9% of launches carry an opening buy in the launch
transaction; of first *outside* buys, 39.9% land within 1 s and 60.0%
within 5 s of the launch block; 24.6% had no outside buy after an hour. A
creator can put their own launch against that. This is not "might be
useful" — it is the number people were already arguing about, with a
definition and an n, from a source that does not sell a bot. **What is
missing to make it a product rather than a page: the per-token line**
("your launch's first outside buy landed at 0.4 s; 40% of launches like
yours were bought inside 1 s"). TODO A5b's last step.

**Half: the graduation distribution.** "1.8% graduated; median 41 s; 14.7%
of graduations inside 10 s" gets reposted when data accounts post it. It
is true and ours is better-defined, but it is a *finding*, read once, not
a page returned to. Value as content, not as a tool.

**Half: the live boards.** /live, /graduated, /graveyard are the kind of
thing a trader might return to, but four other sites have live boards,
theirs have more (trader PnL, wallet claiming), and ours were down or
partial for most of the last two days. Not a reason to come here yet.

## 3. What would make it a real product — the honest test

A product is something a person uses more than once without being asked.
Three candidates pass a plain-language test ("would a pons launcher or
trader use this on a Tuesday without us posting about it?"):

1. **The per-token "was I sniped" line on /t/{address}** (A5b's last step)
   — the question exists, the data exists, the definition is published.
   Days of work. This is the one to finish first.
2. **A Telegram alert on the first outside buy** ("a launch in your tax
   band just took its first outside buy 4.2 s after the block — outside
   the snipe window") — the thing a trader *acts* on, which the research
   said is what retains users (terminals, not dashboards). Built on data
   the box already records. A week, including the opt-in and rate limits.
   This is also where the token can honestly be worth holding
   (CONSTRAINTS 8: information free, automation may be token-conditioned).
3. **The daily digest in the room**, already built, running the moment
   the room exists. Distribution, not product — but the market moves on
   pushes, and this is the cheapest push we have.

Everything else on the list is either infrastructure (which is now mostly
done and must simply stay up) or content.

## 4. What to stop calling value

- "All-time" figures over a ten-day record. Fixed in copy; keep it fixed.
- Anything that needs a reader to already trust us. Trust is the output
  of this project, not an input.
- The token as a revenue experiment. PLAN.md already puts fees under $100
  at 94%. The token is a distribution event; B6 measures it as one.

## 5. How we will know (dates, not adjectives)

- By **21 September**: the per-token first-buy line is live; the room
  exists and the digest has posted for seven consecutive days; the site
  has had no stale banner for seven consecutive days; coverage of the
  live index is ≥ 99% on a sampled day (A3's own DONE condition).
- By **5 October**: one outside account has quoted a LEDGE figure with
  the link, unprompted, or the alert bot has 50 opt-ins. If neither has
  happened, the value hypothesis is wrong and the question is not "how
  do we market it" but "what else does a launcher need that nobody
  measures" — first-buy timing was found by listening, and the next
  thing will be too.

None of this requires a moat. It requires being right, present, and
useful on the one question people are already asking.
