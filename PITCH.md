# The pitch, for the operator

Written 2026-09-10, to be pasted into Telegram by Mujeeb in his own voice.

Context: this person launched CHIT and earned roughly 5 ETH on pons. He runs a
room. His help is CONDITIONAL on the project being good — the three things he
raised (on-chain activity and when to launch, token utility, and a project worth
his name) are acceptance criteria, not casual suggestions.

Two rules this pitch follows, and both matter more than any phrasing in it.
Lead with the one number he cannot get anywhere else. And state plainly what
cannot be proved, because he has earned here and will spot an overclaim faster
than he will spot a good argument. The admission is what makes the rest credible.

## Short opener, first message

> Built something on pons I want you to look at before you decide anything:
> ledge.tools
>
> It indexes every launch from the factory contract, hourly, since the chain's
> early blocks. 108,000 launches so far. The thing I have that nobody else has
> published: I time every single graduation. 15% of them finish in under 10
> seconds. Some finish in the same block they launched in.
>
> Nobody can see a launch and buy it in under a second. So "graduated" is not
> one thing, and right now every tool on this chain treats it like it is.

## The fuller case, second message

> Why I think this is worth your name on it.
>
> **It is real and it is running.** Not a mockup. An hourly crawl commits data
> to a public repo, a worker indexes live curve activity every minute, and every
> number on the site regenerates from public chain data with one command. If any
> figure does not follow from the raw data, the build fails. You can check any of
> it yourself.
>
> **The finding is the product.** 93.5% of launches never take a single buy.
> That is 187 of 200 I sampled by reading each launch's own bonding curve
> directly. And of the ones that do graduate, most did it in under five minutes.
> The median takes 156 seconds. I publish the whole distribution and let people
> draw their own conclusions.
>
> **What I cannot prove, so I do not claim it.** A sub-second graduation means
> nobody discovered it in time to buy it. It does not tell me whether that was
> the deployer filling their own curve or a bot sniping the mempool. I would need
> the buyers' identities to separate those and I do not print wallet addresses.
> So the site states the duration and stops. I would rather say less and be right.
>
> **On your three points.**
>
> Activity and timing: partly there. The live board shows every curve taking buys
> right now with its fill against its own threshold. What is not there yet is the
> plain reading of whether the venue is hot or cold against its own baseline, and
> I am building that next because you are right that it is the thing a launcher
> actually wants.
>
> Token utility: you were right that it was detached, and I changed the rule that
> was blocking it. Every number stays free and unkeyed to everyone, for ever. But
> the bot can run in your room, gated on holding the token, posting each reading
> as it lands. It withholds no information from anyone, because everything it
> posts is already free on the site. That is the honest version of utility for a
> tool like this, and I am not going to pretend it is more than it is.
>
> Cross-launchpad volume: not doing it yet. It is weeks of work and I would
> rather show you three finished things than four half-finished ones.
>
> **What I am asking.** Look at it and tell me if it is worth launching. If it is
> not there yet, tell me what is missing and I will build it. I am not asking you
> to put your room behind something you do not rate.

## Figures used, and where each comes from

Refresh from `data/number.json` before sending; do not quote a stale number to
someone who will check it.

| Figure | Source |
|---|---|
| 108,000+ launches indexed | `allTime.launches`, hourly crawl from block 55,173,069 |
| every graduation timed, ~2,474 | `allTime.ttg.n` |
| 15% under 10 seconds | `allTime.ttg.histogram`, the buckets below 10 s |
| median 156 seconds | measured 2026-09-10 over graduations with a launch on record |
| 93.5% never take a buy | `samples.raisedNothing`, 187 of 200, dated 2026-09-08 |

## What NOT to say, and why

- Do not say "self-filled", "rigged" or "fake". The measurement does not support
  it: block time here is 0.101 s, and a sub-second fill is equally consistent
  with a sniping bot. `METHOD.md`'s 2026-09-10 entry sets this out.
- Do not claim nobody else CAN compute graduation time. It is one subtraction on
  two public timestamps, and Bitquery and Dune hold the data. The true claim is
  narrower and still worth making: nobody has published it.
- Do not promise the token any yield, revenue share or buyback.
