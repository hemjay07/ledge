# Direction C — "The Broadside"

## Rationale

LEDGE is not consumed on its own site; it is consumed as a screenshot pasted into a group chat by
someone who has to end an argument. So the top of the page is designed as a finished sheet rather
than as an entrance to a product: a heavy rule, a running head, one figure large enough to read
across a room, its denominator hanging beneath it as a caption, the second figure set below a hairline,
and `LEDGE.TOOLS` with the measurement stamp closing the sheet on another heavy rule. Cropped anywhere
inside those two heavy rules, a 390px phone screenshot is already a complete, self-attributing share
card — the citation carries its own provenance, its own n, and its own age, which is the only defence
a number has once it leaves the page. Below the fold the sheet turns dense and typographic — printed
rules, tick marks, ruled tables — because the evidence is meant to be checked, not browsed. There is
no card, no panel, no chrome: hierarchy is rule weight and type size alone, so nothing on the page can
be mistaken for an interface element inviting an action. Colour appears exactly once, and only when
the instrument has failed to update: a vermilion correction slip pasted across the top of the notice,
the way a paste-over correction appears on a printed bill. Fresh, the sheet is two-tone and silent.

## Palette

Named tokens, three-state (`:root` light · `@media (prefers-color-scheme: dark)` guarded with
`:root:not([data-theme="light"])` · `:root[data-theme="dark"]`). The dark sheet is not an inversion:
the ground is a warm near-black rather than the ink value, and the chalk is softened below pure white
so a full-bleed dark sheet does not glare.

| Token | Light (bone sheet) | Dark (ink sheet) | Role |
|---|---|---|---|
| `--ground` | `#EFEAE0` | `#121110` | the sheet |
| `--ground-slip` | `#E5DFD1` | `#1C1A17` | one step down, reserved for pasted matter |
| `--ink` | `#16130F` | `#E8E3D8` | press ink / chalk — 17:1 and 14:1 |
| `--ink-muted` | `#57503F` | `#A39B8A` | denominators, notes — 6.4:1 and 6.7:1 |
| `--rule` | `#16130F` | `#E8E3D8` | heavy and mid rules |
| `--rule-hair` | `#BDB5A3` | `#423E38` | hairlines, table rows (non-text) |
| `--stale` | `#B3321C` | `#F2704A` | the one colour — correction slip only — 5.1:1 and 6.4:1 |
| `--stale-ink` | `#FFFFFF` | `#121110` | text on the slip |
| `--bar` | `#16130F` | `#E8E3D8` | the distribution rule |

Every text pair clears WCAG AA; ink on ground clears AAA.

## Type pairing

**Anton** (400, its only weight) for the display figures, the wordmark and `LEDGE.TOOLS`. It is a
single-weight condensed poster face with no light cut available, which is the point: it cannot be
tuned down into a soft dashboard number, and its narrow set lets `1.85%` reach 34vw at 390px without
breaking the measure. Set at `line-height:.82` and `-.015em` so the figure reads as a block of ink.

**Work Sans** (400/500/600) for everything else — a compact, low-contrast grotesque with a plain,
unfashionable lowercase and true tabular figures, so the tables read as printed matter beside Anton
rather than competing with it. Small caps effects are made with `letter-spacing:.14–.16em` uppercase,
not a third face. `font-variant-numeric: tabular-nums` is set on `body` and inherited everywhere.
Hex addresses use the platform monospace stack — no third webfont is loaded.

## Notes on the figures

All figures come from `data/number.json` verbatim. Rates are printed to the precision the sample
supports: two decimals at n ≥ 1,000, one decimal below, and `not enough data (n=…)` under 30 — stated
on the page. Seconds render as `41 s`, `4 min`, `8 min`, `18 min`, `42 min`. The distribution rule uses
a log axis from 1 s to the longest observed graduation, labelled as such, with no boundary claim.
`DEMO_NOW` in the inline script freezes the clock so this direction renders its fresh state;
`?live=1` uses the real clock, `?stale=1` pastes the correction slip.
