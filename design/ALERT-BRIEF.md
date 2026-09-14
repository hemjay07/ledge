# The first-outside-buy alert — design, 2026-09-14

MOAT.md §3, second item: the one thing a trader *acts* on rather than reads.
Not built; this is the design to build from, with the parts that are already
in place named, so the build is a week and not a month.

## The alert, in one sentence

"A launch matching your filter just took its first outside buy N seconds
after its launch block" — sent to the subscriber's Telegram DM within one
tick of the buy, with the token's page linked, and nothing else.

## Why this and not a price alert

RESEARCH-2026-09-13 §6: sniping is the pain everyone names, and the tools
people keep are the ones they act through. The first outside buy is the
moment a launch stops being a launcher's own transaction and becomes a
market. A subscriber who wants to see launches that cleared the 5-second
snipe window unbought, or that were bought inside 1 s, can say so once and
be told each time. No verdict is attached; the number is the message.

## What exists

- The reading: `token_activity.first_outside_buy_block/_ts` and
  `launch_tx_buy`, written by the tick on the box within ~10 s of the buy
  (worker/src/activity.ts, 2026-09-14). The alert fires off the same fold.
- The bot, the webhook, the DM classifier, the per-chat and global hourly
  limits (worker/src/telegram.ts), and `sendMessage` that reports delivery.
- The population figures the message can quote, per tax band, in
  number.json's `firstBuy` block.

## What to build

1. **A subscription table** (`alert_sub`): chat_id, pair_class (or any),
   tax bucket (or any), delay bound (`within <= N s` or `after >= N s` or
   `none by +1 h`), created_at, last_sent_at. One row per chat; a chat
   changes its filter by sending it again. No wallet, no email.
2. **Two DM commands**: `/alert <pair> <tax> <rule>` (e.g.
   `/alert eth 2-3% after 5s`, `/alert any any within 1s`) and `/alert off`.
   Reply restates the filter in words. `/alert` alone shows the current one.
3. **The trigger**, in the tick after `planActivity`: for each row whose
   `first_outside_buy_block` was set *this pass*, match subscriptions, and
   send: "0x1234…abcd · ETH pair · 2–3% tax · first outside buy 6 s after
   the launch block. https://ledge.tools/t/0x1234…" One message per token
   per chat; at most 20 per chat per hour (the existing limit), with the
   overflow said once: "12 more matched this hour; the filter is broad."
4. **The "none by +1 h" rule** needs a sweep, not the fold: once an hour,
   launches that reached 60 minutes with no outside buy. Cheap; one query.
5. **Tests** (red first): matching (pair/tax/rule), one-message-per-token,
   the hourly cap and its overflow line, `/alert off`, the restated filter,
   no wallet anywhere in a message.

## Constraints that bound it

- CONSTRAINTS 1: the message states a delay, never "sniped" or "clean".
- CONSTRAINTS 2: no buyer is ever named; the message names the token only.
- CONSTRAINTS 8: information stays free. If holding the token is ever a
  condition, it gates the *automation* (more than one filter, a tighter
  cap), never the figure — and that is a dated decision, not a default.

## Cost

A week: two days for the table, the commands and the trigger; one for the
hourly sweep; one for the tests and the miniflare run; one to watch it in
the room. Nothing in it touches the pipeline or the site.
