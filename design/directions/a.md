# Direction A — "The Ledger"

## Rationale

LEDGE is an instrument whose output will mostly be seen second-hand: quoted in a
reply, pasted into a group chat, cropped into a screenshot by someone arguing about
a launchpad. That argues for the oldest visual language we have for numbers that
are meant to be checked — the ruled accounting register. A ledger is legible at a
glance and still legible under scrutiny: every figure sits in a column, every
column is headed, every entry carries its own line and its own number, and a total
is drawn with a rule above and a double rule below so that nobody has to be told
which figure is the total. That convention does the hierarchy work that a dashboard
would try to do with cards, tints and badges, none of which survive a crop. It also
enforces the constraints structurally rather than decoratively: the register cannot
show a rate without the launch count in the adjacent column, because a ledger row
without its quantity column is visibly incomplete. The page reads as a record that
was kept, not a product that was designed — which is the correct posture for a
number that has to be cited, and the correct posture for the day the number falls.
The one departure from the monochrome sheet is the stale state, printed as a red
ink stamp over the sheet: the only mark on the page that was not typeset with the
rest of the record, and therefore the only one that catches the eye.

## Palette

Named tokens, light (warm cream paper, near-black warm ink):

| Token | Light | Role |
|---|---|---|
| `--paper` | `#F6F3EA` | the sheet |
| `--paper-alt` | `#EFEBDF` | alternating ruled band in registers |
| `--ink` | `#16140E` | figures, totals, headings |
| `--ink-2` | `#45413A` | running text, secondary figures |
| `--ink-3` | `#6B6558` | column heads, folio numbers, denominator captions |
| `--rule` | `#CDC6B3` | hairline rule between entries and rows |
| `--rule-mid` | `#A9A18C` | column-head rule, distribution track |
| `--rule-strong` | `#16140E` | total rules (single above, double below) and masthead |
| `--stamp` | `#A8231C` | stale state only — red ink stamp |
| `--stamp-field` | `#F0E2DE` | stamp ground |

Dark is the same sheet as a photographic negative, printed rather than inverted:
the ground cools to near-black, the ink returns as warm bone (highlights of a
negative keep their warmth), and the rules are dimmed to grey rather than flipped
to white, so the sheet does not turn into a cage of bright lines.

| Token | Dark |
|---|---|
| `--paper` | `#0E0E12` |
| `--paper-alt` | `#14141A` |
| `--ink` | `#E9E5D9` |
| `--ink-2` | `#B4AEA0` |
| `--ink-3` | `#8B857A` |
| `--rule` | `#2C2C34` |
| `--rule-mid` | `#43434E` |
| `--rule-strong` | `#E9E5D9` |
| `--stamp` | `#E4564B` |
| `--stamp-field` | `#241514` |

Contrast (computed): `--ink` on `--paper` 16.8:1 light / 15.3:1 dark; `--ink-3`
on `--paper` 5.2:1 light / 5.2:1 dark; `--stamp` on `--stamp-field` 5.7:1 light /
4.9:1 dark, and 6.5:1 / 5.3:1 on the bare sheet. All AA or better at the sizes used.

## Type pairing

- **Figures, labels, column heads, addresses: IBM Plex Mono** (400/500/600).
  Chosen over a neutral grotesque because a ledger's numerals are struck, not set:
  Plex Mono's slab-ish terminals and open counters read as a typewritten record,
  its zero is slashed-free but unambiguous at 7rem, and its fixed advance keeps the
  register columns aligned without any table trickery. `tabular-nums` is on
  regardless, so the big number does not shuffle when it updates hourly.
- **Running text, glosses, the subject line: Newsreader** (400/500/600 + italic).
  A humanist serif on a variable optical-size axis, so the 15px gloss under the
  total and the 9px-feeling fine print both stay comfortable. It reads as the
  clerk's hand around the machine's figures, and its italic carries the
  qualifications ("lower bound", "not enough data") without needing a colour or
  a box.
- The wordmark is Plex Mono at 0.34em tracking — a stamped header, not a logotype.
