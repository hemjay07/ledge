# LEDGE — design system

Every value in this document is extractable from `design/hybrid.html`. Nothing here is invented.
Read with `CONSTRAINTS.md` (binding) and `METHOD.md` (binding definitions).

---

## 1. Identity

### World statement

LEDGE is a **kept record, published as a broadside**. It is not a product surface and not a
dashboard. The top of the page is a finished sheet — one figure large enough to read across a
room, its denominator hanging beneath it as a caption, closed top and bottom by heavy printed
rules — because LEDGE is consumed second-hand, as a screenshot pasted into a group chat by
someone who has to end an argument. Below that sheet the page turns into a ruled accounting
register: folio numbers in the margin, every section an entry, every cohort a table where the
rate cannot appear without the launch count in the adjacent column, and every table closed by
an `All` footing row. The register is the argument: a ledger row without its quantity column is
visibly incomplete, so the layout enforces the denominator rule structurally rather than by
policy. The distribution is an engraved logarithmic scale rather than a chart, because a scale
carries its own units and can be read from a thumbnail.

The posture is an instrument, not an interface. There is nothing on the page that can be
mistaken for a control inviting an action, and no sentence tells the reader what to do with a
number.

### The one colour, and why it is only for stale

The sheet is two-tone: bone and ink in light, ink and chalk in dark. Exactly one hue exists in
the system — **`#B3321C` in light, `#F2704A` in dark** — and it appears only when the instrument
has failed to update: a vermilion correction slip pasted across the top of the sheet, the way a
paste-over correction appears on a printed bill, plus the age rendered in that same red inside
the fold caption.

The reason is not restraint for its own sake. If colour is spent on cohorts, on emphasis, or on
a positive state, then colour stops meaning anything and the one moment that must catch the eye
— a number that is lying about its own freshness — has no way left to catch it. Colour is
reserved so that the only time the page looks alarmed is the only time it should.
The stale state is never colour-only: the slip also states the age and the last successful
measurement in words.

### Signature element — the colophon strip

The **colophon strip** is the signature. It is the band that closes the fold: `LEDGE.TOOLS` set
in wide-tracked mono on the left, `MEASURED 6 SEP 2026 · 15:58 UTC` on the right, seated between
a 3px mid rule above and a 7px heavy rule below.

Its job is to make the screenshot self-attributing. Cropped anywhere between the heavy rule at
the top of the fold and the heavy rule under the colophon, a 390px phone screenshot is already a
complete citation: the figure, its denominator, its sample size, its window, its age, its source
URL and its measurement timestamp — all inside the crop. The number cannot escape the page
without its provenance attached. That is the only defence a public figure has once it leaves the
site, and it is the one element that must never be removed, reordered, or moved below the fold.

---

## 2. Tokens

### Surface + ink ladder — light (`:root`)

| Token | Hex | Role |
|---|---|---|
| `--ground` | `#EFEAE0` | the bone sheet |
| `--ground-alt` | `#E5DFD1` | alternating register band, slip ground |
| `--ink` | `#16130F` | poster figures, totals, headings, needle |
| `--ink-2` | `#45413A` | running text, secondary counts, notes |
| `--ink-muted` | `#57503F` | denominators, kicker, colophon stamp |
| `--ink-3` | `#645E4E` | folio numbers, column heads, fine print, tick legends |
| `--rule-hair` | `#CDC6B3` | hairline rules, table row separators, entry tops |
| `--rule-mid` | `#A9A18C` | column-head rule, scale baseline, link underline |
| `--rule-heavy` | `#16130F` | heavy and mid printed rules, total footing rule |
| `--stale` | `#B3321C` | the one colour — correction slip only |
| `--stale-ink` | `#FFFFFF` | text on the slip |

### Surface + ink ladder — dark

Applied twice: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`
and `:root[data-theme="dark"] { … }`. The dark sheet is not an inversion — the ground is a warm
near-black rather than the ink value, and the chalk is held below pure white so a full-bleed
dark sheet does not glare.

| Token | Hex | Role |
|---|---|---|
| `--ground` | `#121110` | the ink sheet |
| `--ground-alt` | `#1C1A17` | alternating register band, slip ground |
| `--ink` | `#E8E3D8` | poster figures, totals, headings, needle |
| `--ink-2` | `#B4AEA0` | running text, secondary counts, notes |
| `--ink-muted` | `#A39B8A` | denominators, kicker, colophon stamp |
| `--ink-3` | `#918B80` | folio numbers, column heads, fine print, tick legends |
| `--rule-hair` | `#38342C` | hairline rules, table row separators, entry tops |
| `--rule-mid` | `#565046` | column-head rule, scale baseline, link underline |
| `--rule-heavy` | `#E8E3D8` | heavy and mid printed rules, total footing rule |
| `--stale` | `#F2704A` | the one colour — correction slip only |
| `--stale-ink` | `#121110` | text on the slip |

### Measured contrast (computed, not eyeballed)

| Pair | Light | Dark |
|---|---|---|
| `--ink` on `--ground` | 15.44:1 AAA | 14.74:1 AAA |
| `--ink` on `--ground-alt` | 13.94:1 AAA | 13.57:1 AAA |
| `--ink-2` on `--ground` | 8.46:1 AAA | 8.53:1 AAA |
| `--ink-2` on `--ground-alt` | 7.64:1 AAA | 7.86:1 AAA |
| `--ink-muted` on `--ground` | 6.67:1 AA | 6.84:1 AA |
| `--ink-muted` on `--ground-alt` | 6.02:1 AA | 6.29:1 AA |
| `--ink-3` on `--ground` | 5.38:1 AA | 5.58:1 AA |
| `--ink-3` on `--ground-alt` | 4.86:1 AA | 5.13:1 AA |
| `--stale` on `--ground` | 5.17:1 AA | 6.46:1 AA |
| `--stale-ink` on `--stale` | 6.20:1 AA | 6.46:1 AA |

`--ink-3` is the lightest ink in the system and is checked against the banded row
(`--ground-alt`), not only the bare sheet, because column heads and the insufficient-data cell
both land on bands. Rules are non-text and are exempt from the text ratio.

### Type

Three faces, one `<link>`:

```html
<link href="https://fonts.googleapis.com/css2?family=Anton&family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap" rel="stylesheet">
```

| Face | Scope | Why |
|---|---|---|
| **Anton** 400 | The two poster figures only — the Pons Number and the excluding-fast figure. Nothing else, including the wordmark. | Single-weight condensed poster face with no light cut available. It cannot be tuned down into a soft dashboard number, and its narrow set lets a rate reach poster scale at 390px without breaking the measure. |
| **IBM Plex Mono** 400/500/600 | Every numeral outside those two figures; every label, column head, folio number, running head, colophon strip, address, footer. | Fixed advance holds the register columns in alignment without table trickery; `tabular-nums` means a figure does not shuffle when it updates hourly. It reads as a typewritten record, not a UI font. |
| **Newsreader** 400/500/600 + italic | The one running-text face: glosses, ledes, notes, table row labels, fine print. | **Chosen over Work Sans.** The body is a ledger and the fold is a poster, and Newsreader is the only one of the two that serves both: against Anton it *contrasts* (serif against condensed grotesque, so the poster figure stays the loudest thing on the sheet) where Work Sans would read as a lighter weight of the same genre and blur the two registers; and its variable optical-size axis (`opsz 6..72`) keeps both the 1.0625rem lede under the poster figure and the 0.8125rem italic fine print in the register comfortable, which a single-optical-size grotesque cannot do across that range. |

### Fluid type scale — exact `clamp()` values

| Token | Value | Used by |
|---|---|---|
| `--fs-figure` | `clamp(3.25rem, 23vw, 10.5rem)` | the Pons Number (Anton) |
| `--fs-figure-2` | `clamp(2rem, 10vw, 3.5rem)` | the excluding-fast figure (Anton) |
| — | `clamp(1rem, 3.2vw, 1.125rem)` | the fold caption (the hanging denominator) |
| — | `clamp(2rem, 9vw, 4.25rem)` | fold top padding |
| `--fs-stat` | `clamp(1.5rem, 4vw, 2rem)` | all-time figures (Plex Mono) |
| `--fs-lede` | `clamp(1.0625rem, .4vw + 1rem, 1.1875rem)` | entry ledes |
| `--fs-body` | `1rem` | body default |
| `--fs-note` | `.875rem` | notes, table cells |
| `--fs-fine` | `.8125rem` | fine print, captions, footer, slip |
| `--fs-label` | `.6875rem` | entry labels, folio numbers, kicker |
| `--fs-strip` | `clamp(.5625rem, 2.4vw, .6875rem)` | running head + colophon strip |
| `--fs-micro` | `.625rem` | table column heads |

`--fs-figure`'s vw term is load-bearing, not decorative. It is set so the poster figure clears
the 390px viewport with the 6% indent applied, verified by measuring `scrollWidth` in headless
Chrome: at 390px the computed size is **89.7px**, and the ink right edge is **267.9px** for
`1.85%`, **310.8px** for a worst case of `12.34%`, and **353.8px** even for `100.00%` — all
inside 390. Document `scrollWidth` at 390px is **390**, i.e. zero horizontal overflow.

Numerals: `font-variant-numeric: tabular-nums` and `font-feature-settings: "tnum" 1` are set on
`body` and re-asserted on every numeral class.

### Spacing

Base **`0.25rem` (4px)**. Only these multiples exist:

| Token | Value | Multiple |
|---|---|---|
| `--s-1` | `.25rem` | 1× |
| `--s-2` | `.5rem` | 2× |
| `--s-3` | `.75rem` | 3× |
| `--s-4` | `1rem` | 4× |
| `--s-6` | `1.5rem` | 6× |
| `--s-8` | `2rem` | 8× |
| `--s-12` | `3rem` | 12× |
| `--s-16` | `4rem` | 16× |

Measure: `--sheet-max: 52rem`. Gutter: `--pad-x: 1.25rem`, becoming `2.5rem` at `min-width: 64rem`.

### Rule weights — this design has rules, not radii or shadows

Stated as philosophy, not omission: **hierarchy in LEDGE is carried entirely by rule weight and
type size.** There are no cards, no panels, no chrome. Consequently:

```css
/* the whole depth model */
border-radius: 0;   /* radii sm/md/lg/xl are all 0 */
box-shadow:   none; /* and text-shadow, and filter */
```

A rounded corner or a shadow would make an element read as a surface floating above the page —
an interface element — and the page must contain nothing that looks like a control. A printed
rule cannot be mistaken for anything but a rule. `grep` of `hybrid.html` returns zero occurrences
of `border-radius`, `box-shadow`, `text-shadow`, `filter`, and zero gradients.

| Token | Value | Colour |
|---|---|---|
| `--rw-hair` | `1px` | `--rule-hair` |
| `--rw-mid` | `3px` | `--rule-heavy` |
| `--rw-heavy` | `7px` | `--rule-heavy` |

---

## 3. Craft

### The rule ladder — when each weight is used

```css
.rule-hair {height:var(--rw-hair); background:var(--rule-hair)}
.rule-mid  {height:var(--rw-mid);  background:var(--rule-heavy)}
.rule-heavy{height:var(--rw-heavy);background:var(--rule-heavy)}
```

- **Heavy (7px, ink).** Three on the page and no more: opening the fold, closing the colophon
  strip, opening the footer. They mark where the shareable sheet begins and ends. A heavy rule
  is a crop mark; adding a fourth would tell the reader a fourth thing is quotable.
- **Mid (3px, ink).** Closes the fold's evidence block, immediately above the colophon strip.
  It says "the record is complete" before the attribution is stamped on it.
- **Hairline (1px, `--rule-hair`).** Everything else: the separator under the running head, the
  top of every ledger entry, the vertical margin rule beside the folio number, every table row
  separator. Never ink-weight — it must recede so the columns, not the grid, do the reading.
- Two further hairlines are drawn in ink rather than `--rule-hair`, and only in tables: the
  column-head rule (`--rule-mid`) and the `All` footing rule (`--rule-heavy`). Those are the two
  places a ledger conventionally draws a line in the same ink as the figures.

Two rules never sit adjacent. A heavy rule already terminates the fold, so the first ledger entry
below it does not draw its own top border.

### The register table recipe

Structural contract: **column 1 is the bucket, and a `Launches (n)` column stands beside every
rate.** A `tfoot` `All` row is required — it is how a reader checks that the buckets sum to the
population the fold reported.

```html
<div class="scroller" tabindex="0" role="group" aria-label="Graduation rate by pair token">
  <table>
    <caption>Graduations of launches, by the token the pool is paired against.</caption>
    <thead>
      <tr><th scope="col">Pair token</th><th scope="col">Launches (n)</th>
          <th scope="col">Graduations</th><th scope="col">Rate</th></tr>
    </thead>
    <tbody>
      <tr><th scope="row">ETH</th><td class="fig n">1,457</td><td class="fig n">13</td><td class="fig">0.89%</td></tr>
      <tr><th scope="row">Other</th><td class="fig n">26</td><td class="fig n">0</td>
          <td class="thin">not enough data (n=26)</td></tr>
    </tbody>
    <tfoot>
      <tr><th scope="row">All</th><td class="fig">3,347</td><td class="fig">62</td><td class="fig">1.85%</td></tr>
    </tfoot>
  </table>
</div>
```

```css
.scroller{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-top:var(--s-3)}
table{width:100%;min-width:19rem;border-collapse:collapse;font-size:var(--fs-note)}
caption{caption-side:top;text-align:left;font-size:var(--fs-fine);color:var(--ink-3);padding-bottom:var(--s-2)}
th,td{padding:.4375rem clamp(.3125rem,1.6vw,.625rem) .4375rem 0;text-align:right;
      border-bottom:var(--rw-hair) solid var(--rule-hair);white-space:nowrap}
th:first-child,td:first-child{text-align:left;padding-left:.375rem;white-space:normal}
th:last-child,td:last-child{padding-right:.375rem}
thead th{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:var(--fs-micro);
         font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);
         border-bottom:var(--rw-hair) solid var(--rule-mid);padding-bottom:.3125rem}
tbody tr:nth-child(even){background:var(--ground-alt)}
tbody th{font-weight:500}
td.fig{font-size:.9375rem}          /* Plex Mono, tabular */
td.n{color:var(--ink-2)}            /* the denominator column, one step back */
td.thin{color:var(--ink-3);font-style:italic;font-size:var(--fs-fine);
        font-family:"Newsreader",Georgia,serif;white-space:normal}
tfoot th,tfoot td{border-bottom:0;border-top:var(--rw-hair) solid var(--rule-heavy);
                  padding-top:.4375rem;font-weight:600}
```

`min-width:19rem` and the fluid cell padding are tuned so all four columns — including `Rate` —
are visible at 390px without horizontal scroll. Verified by measuring every `.scroller`'s
`scrollWidth` against its `clientWidth` in a 390px iframe: no table scroller overflows. Nothing
sets a minimum on the last column — doing so pushes the widest table (`By pair token`, whose
first column holds `Tokenized stock`) past 390px and clips the `Rate` figure, which is the one
column that must never be the one that scrolls away.

An insufficient cohort (n < 30) prints `not enough data (n=…)` in the rate cell, in the running
face and italic, so it is visibly *not a figure* while the counts beside it stay honest.

Precision, stated on the page and applied everywhere: two decimals at n ≥ 1,000, one decimal
below, `not enough data (n=…)` under 30.

### The folio-number recipe

Every body section is an entry in the register, numbered in the margin from `02` (the fold is
`01`, stamped into its running head as `TRAILING 24 HOURS · 01`).

```html
<section class="entry" data-folio="04" aria-labelledby="h-pair">…</section>
```

```css
.entry{position:relative;padding:var(--s-6) 0 var(--s-6) 2.75rem;
       border-top:var(--rw-hair) solid var(--rule-hair)}
.entry::before{content:attr(data-folio);position:absolute;left:0;top:1.55rem;width:1.75rem;
               text-align:right;font-family:"IBM Plex Mono",ui-monospace,monospace;
               font-size:var(--fs-label);letter-spacing:.06em;color:var(--ink-3)}
.entry::after{content:"";position:absolute;left:2.1rem;top:0;bottom:0;width:1px;
              background:var(--rule-hair)}
@media (min-width:40rem){
  .entry{padding-left:3.5rem}
  .entry::before{width:2.25rem}
  .entry::after{left:2.75rem}
}
```

The folio is generated content, not markup: it is a page furniture mark, not information a
screen reader should read out. The vertical hairline at `left:2.1rem` is the register's ruled
margin and runs the full height of the entry.

### Hover recipe for links

Links are underlined by a rule, not by `text-decoration`, so they match the rule ladder. Hover
thickens the rule from hairline to ink weight; the negative margin keeps the baseline from
shifting by a pixel.

```css
a{color:inherit;text-decoration:none;border-bottom:1px solid var(--rule-mid)}
a:hover{border-bottom-color:var(--ink);border-bottom-width:2px;margin-bottom:-1px}
```

### Focus-visible recipe

One recipe, applied to links and to every horizontally scrollable region (which carry
`tabindex="0"` so a keyboard user can scroll them):

```css
a:focus-visible,.scroller:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
```

Ink, never the stale red — focus is not a warning.

### The stale recipe

Two marks, one hue, and never colour alone.

```css
.stale-slip{background:var(--stale);color:var(--stale-ink);
  font-family:"IBM Plex Mono",ui-monospace,monospace;
  font-size:var(--fs-fine);font-weight:500;line-height:1.5}
.stale-slip > div{max-width:var(--sheet-max);margin:0 auto;padding:var(--s-3) var(--pad-x)}
.stale-slip[hidden]{display:none}
.is-stale{color:var(--stale);font-weight:600}
```

1. The **correction slip**: a full-bleed band above the sheet carrying
   `This number is {age} old. Last successful measurement {time}.` inside `role="status"`.
2. The **age in the fold caption** takes `.is-stale`, so the red is present inside the crop a
   screenshot would take.

Trigger: `crawledAt` older than `7200` seconds, or `?stale=1` for demonstration. `?live=1`
switches the frozen demo clock for the real one.

---

## 4. Primitives

### Figure

The poster figures. Anton, and the only place Anton appears.

```css
.figure-block{margin-left:6%}
@media (min-width:48rem){ .figure-block{margin-left:12%} }
.figure{display:block;font-family:"Anton",Impact,"Arial Narrow",sans-serif;font-weight:400;
        font-size:var(--fs-figure);line-height:.82;letter-spacing:-.015em;
        font-variant-numeric:tabular-nums}
.caption{margin-top:clamp(var(--s-4),3.5vw,var(--s-6));font-size:clamp(1rem,3.2vw,1.125rem);
         max-width:36ch;text-wrap:balance}
.caption b{font-weight:600}
.caption .den{color:var(--ink-muted)}
.second{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--s-2) var(--s-4);
        padding:var(--s-4) 0 1.1rem}
.second .figure-2{font-family:"Anton",Impact,"Arial Narrow",sans-serif;font-weight:400;
                  font-size:var(--fs-figure-2);line-height:.9;letter-spacing:-.01em}
.second .gloss{font-size:var(--fs-note);color:var(--ink-muted);max-width:34ch}
.second .gloss b{color:var(--ink);font-weight:600}
```

The figure carries `aria-hidden="true"` and is paired with a `.vh` span giving the full
accessible name including the denominator, the window and the age.

### Register table

See §3. Class set: `.scroller` › `table` › `caption` / `thead th` / `tbody th[scope=row]` /
`td.fig` / `td.n` / `td.thin` / `tfoot`.

### Ledger entry

```css
.entry / .entry::before / .entry::after   /* see §3 folio recipe */
.label{margin:0 0 var(--s-1);font-size:var(--fs-label);font-weight:600;letter-spacing:.14em;
       text-transform:uppercase;color:var(--ink-2)}
.label .n{font-weight:400;color:var(--ink-3);letter-spacing:.06em}
.lede{font-size:var(--fs-lede);max-width:48ch;margin-top:var(--s-3)}
.note{font-size:var(--fs-note);color:var(--ink-2);max-width:56ch;margin-top:var(--s-3)}
.note--fine{font-size:var(--fs-fine);color:var(--ink-3);font-style:italic}
```

`.label .n` is where the entry's own denominator lives (`· n = 62 graduations · 24 h`), so the
window and sample size are attached to the heading, not only to the rows.

### Colophon strip

```css
.head,.colophon{display:flex;justify-content:space-between;align-items:baseline;gap:var(--s-2);
  font-size:var(--fs-strip);letter-spacing:.1em;text-transform:uppercase;font-weight:600;
  padding:var(--s-2) 0 .55rem}
.head .mark,.colophon .mark{font-weight:600;letter-spacing:.28em;white-space:nowrap}
.head .win,.colophon .stamp{color:var(--ink-muted);font-weight:500;text-align:right;
                            white-space:nowrap}
```

Composition, in order and non-negotiable:

```html
<div class="rule-mid"></div>
<div class="colophon">
  <span class="mark">LEDGE.TOOLS</span>
  <span class="stamp">Measured 6 Sep 2026 · 15:58 UTC</span>
</div>
<div class="rule-heavy"></div>
```

`--fs-strip` shrinks with the viewport specifically so both halves stay on one line at 390px;
`white-space:nowrap` on both makes any future overflow a visible failure rather than a silent
two-line strip. The same class set, with `.head`, draws the running head at the top of the fold.

### Scale

Direction B's engraved logarithmic scale, restyled in ink/bone and **unboxed** — no plate, no
border, no radius. It sits as one more ruled ledger entry. Axis: 1 s → 1 h, `x = 40.5 + 639 ·
log₁₀(t) / log₁₀(3600)` over a `0 0 720 150` viewBox.

```css
.scale{margin-top:var(--s-4)}
.scale svg{display:block;width:100%;min-width:30rem;height:auto}
.eng-line,.eng-tick{stroke:var(--rule-mid)}     /* baseline, minor ticks   */
.eng-major{stroke:var(--ink-2)}                 /* labelled major marks    */
.eng-pct{stroke:var(--ink)}                     /* p50/p75/p90/p95 marks   */
.eng-cut{stroke:var(--ink-3);stroke-dasharray:2 3}  /* the 5-minute cutoff */
.eng-text{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;
          letter-spacing:.08em;text-transform:uppercase;fill:var(--ink-3)}
.eng-text--pct{fill:var(--ink-2);font-weight:500}
.eng-num{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px;font-weight:600;
         fill:var(--ink)}
.needle-body{stroke:var(--ink);stroke-width:1.25}
.needle-cap{fill:var(--ink)}
```

The 5-minute cutoff is a **dashed** engraving because a dash reads as a note on the scale rather
than a graduation of it — it is a descriptive threshold, not a boundary. The hairline needle
rests at the median and does not move (see §5). The maximum is marked, and the note beneath
restates every percentile as text so nothing is lost when the SVG is scrolled or unavailable.
`min-width:30rem` keeps the engraved legends legible; below that width the scale scrolls inside
its `.scroller`, which is focusable and labelled.

### Stale banner

```html
<div class="stale-slip" id="slip" hidden>
  <div role="status" id="slip-text">This number is 3 h old. Last successful measurement 15:58 UTC, 6 September 2026.</div>
</div>
```

CSS in §3. It is the first element in `<body>`, above the sheet, so it is inside any crop that
includes the fold.

---

## 5. Motion

**One reveal, and nothing else on the page moves.** The sheet settles once on load. Direction B's
needle-settling animation is deliberately not carried over: a still object photographs cleanly,
and this page's job is to be photographed.

```css
@media (prefers-reduced-motion:no-preference){
  .sheet{animation:settle 420ms cubic-bezier(.2,.6,.2,1) both}
  @keyframes settle{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
}
```

- **Timing:** 420 ms.
- **Easing:** `cubic-bezier(.2,.6,.2,1)` — fast out, long settle, no overshoot.
- **Properties:** `opacity` and `translateY(6px)` only, both compositor-friendly.
- **Reduced motion:** the entire animation lives inside
  `@media (prefers-reduced-motion: no-preference)`, so under a reduced-motion preference the
  sheet is simply present at full opacity from the first paint. There is no fallback animation
  and nothing to suppress.
- There are no hover transitions, no scroll effects, no number count-ups. A number that animates
  into place is a number that looked like a different number a moment ago.

---

## 6. The denominator rule

> **Never show a number without its denominator.** — `CONSTRAINTS.md` §3

This is enforced twice: structurally by the register (a rate has a `Launches (n)` column beside
it or the row is visibly incomplete) and mechanically by the `Stat` primitive.

A `Stat` is any element carrying `data-stat`. It must declare **four** things, or it does not
render:

| Attribute | Meaning |
|---|---|
| element text | the **value** |
| `data-n` | the **sample size** the value was computed over |
| `data-window` | the **time window** it was computed over |
| `data-updated` | the **`updatedAt`** timestamp of the crawl it came from |

```html
<span class="figure" aria-hidden="true"
      data-stat="pons-number"
      data-n="3347" data-window="24h" data-updated="2026-09-06T15:58:32Z">1.85%</span>
```

The runtime refuses to publish an under-denominated figure. It does not warn and continue: it
replaces the value with an em dash, marks the element, and throws — halting the rest of the page
script — so a missing denominator can never ship as a silently rendered number.

```js
var REQUIRED = ["n", "window", "updated"];
Array.prototype.forEach.call(document.querySelectorAll("[data-stat]"), function (el) {
  var missing = REQUIRED.filter(function (k) {
    var v = el.dataset[k];
    return v === undefined || v === null || v === "";
  });
  var value = (el.textContent || "").trim();
  if (!value) missing.unshift("value");
  if (missing.length) {
    el.textContent = "—";
    el.setAttribute("data-stat-error", missing.join(","));
    throw new Error("LEDGE: stat \"" + el.dataset.stat + "\" is missing " + missing.join(", ") +
                    ". A number does not render without its denominator.");
  }
});
```

Consequences for anyone extending the page:

1. A new figure is added by declaring a `Stat`, never by typing a number into markup.
2. `data-window` is mandatory even when the window is "all-time" — "all-time" is a window, and
   on this page it is stated as *since 15:58 UTC, 6 September 2026*, because an unbounded
   all-time is not a denominator.
3. `data-updated` is mandatory even on the all-time figures, so the freshness state applies to
   every number on the sheet and not only to the fold.
4. The visible caption beneath a `Stat` still spells the denominator out in words for a human
   reader. The attributes are the machine's copy of the same fact; they do not replace it.
5. Cohorts with n < 30 are not `Stat`s at all — they render the literal string
   `not enough data (n=…)` in the running face, which is why it is styled `td.thin` rather than
   `td.fig`.

---

## 7. Compliance checklist for any new surface

- [ ] No individual token is scored, ranked, predicted, or named.
- [ ] No wallet or deployer address appears as a subject; the only addresses are the Pons factory and LEDGE's own contracts, as provenance.
- [ ] Every rate carries `n`; every cohort carries its sample size; every figure carries its window.
- [ ] No decimals beyond the stated precision rule; n < 30 renders `not enough data (n=…)`.
- [ ] The 5-minute threshold is always described, never labelled as a verdict.
- [ ] Freshness is stated on every figure, and the stale state paints the slip.
- [ ] Nothing requires a wallet, an email, or an account.
- [ ] Colour appears only in the stale state.
- [ ] `border-radius: 0`, no shadows, no gradients, no filters.
- [ ] Contrast computed, not eyeballed; every text pair ≥ 4.5:1 in both themes.
- [ ] One reveal; `prefers-reduced-motion` respected.
- [ ] The colophon strip closes any block intended to be screenshotted.
- [ ] Banned-phrase check (`CONSTRAINTS.md` NOT-THIS list + emoji regex) returns zero hits.
