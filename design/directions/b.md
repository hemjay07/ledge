# Direction B — "The Instrument"

## Rationale

LEDGE's product is not a page, it is a citation: the number has to survive being screenshotted into a group chat, cropped, and re-posted by someone who is losing an argument. So the page is built as a measuring apparatus rather than a publication — a machined ground with a faint horizontal grain, a calibration plate stating what the instrument is and how long it has been in service ("in service since block 56,028,514 · observations 3,347"), engraved small-caps labels, and a single stamped readout window holding the Pons Number. An instrument is a credible object in a way a dashboard is not: it has no opinion, it reports what its scale is pointed at, and its authority comes from being calibrated and denominated rather than from persuasion. That is why the time-to-graduation distribution is a true engraved logarithmic scale with a hairline needle resting at the median instead of a chart — a scale can be read from a thumbnail, it carries its own units, and its ticks (p50 / p75 / p90 / p95, plus the descriptive 5-minute cutoff drawn as a dashed engraving rather than a verdict) show the shape of the distribution without ever implying a boundary. Every figure sits beside its denominator because a reading without its range is not a measurement, and the only colour on the whole apparatus is the amber warning lamp that lights when the instrument is out of date — so the one time the page looks alarmed is the one time it should. The needle's single settling motion on load is the only movement, it is suppressed under `prefers-reduced-motion`, and once it stops the page is completely still: a still object photographs cleanly, and this page's job is to be photographed.

## Palette — named hex tokens

The three-state token pattern: `:root` (light), `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`. Dark is the designed default posture; light is the same apparatus in brushed aluminium and enamel rather than a naive inversion — the ground lifts to aluminium, the readout plate becomes enamel, and the lamp darkens to hold AA against a pale field.

| Token | Dark (deep warm neutral) | Light (brushed aluminium / enamel) | Role |
|---|---|---|---|
| `--ground` | `#131312` | `#E9E7E1` | machined body of the instrument |
| `--ground-grain` | `#191917` | `#DEDBD3` | 1px repeating grain line, 55% opacity |
| `--plate` | `#1B1B19` | `#F4F2EC` | readout window + scale frame |
| `--plate-edge` | `#2F2E2A` | `#CFCBC1` | hairline plate bezel (inset ring, no shadow) |
| `--engrave` | `#E9E7E1` | `#1B1A17` | primary engraved marks and numerals |
| `--engrave-muted` | `#A6A29A` | `#55524A` | secondary labels, glosses, sample sizes |
| `--engrave-dim` | `#8A867C` | `#605D56` | tick legends, caveats, provenance |
| `--rule` | `#2C2B28` | `#C9C5BB` | hairline rules and row separators |
| `--rule-strong` | `#45433D` | `#A8A49A` | section rules, minor scale ticks, bars |
| `--needle` | `#E9E7E1` | `#1B1A17` | the hairline needle at the median |
| `--lamp` | `#E8A33D` | `#8A4F06` | **the one colour** — stale-state warning lamp |
| `--lamp-ground` | `#33250F` | `#F5E3C4` | lamp banner field |
| `--lamp-edge` | `#7A5417` | `#C98A2A` | lamp bezel / banner rule |

Contrast: `--engrave-dim` is the lightest text used at small sizes and clears 4.5:1 against `--ground` in both themes; `--engrave` on `--plate` clears 13:1 dark and 15:1 light. The lamp colour is never load-bearing on its own — the stale banner also carries the age as text.

## Type pairing

- **Instrument Sans** (400 / 500 / 600) — labels, body, glosses, table headers. Chosen deliberately over the grotesques: it is a slightly narrow, low-contrast workhorse whose flat terminals and tight apertures read like lettering cut into a plate rather than set on a page, and it stays legible at the 11px letterspaced uppercase used for the engraved small-caps labels (`letter-spacing: .14em`, `text-transform: uppercase` — a synthetic small-caps treatment, since the family ships no true SC).
- **Archivo** (variable `wdth` axis) — every numeral, set condensed at `wdth 74–88` depending on size: 74 for the 8.25rem primary readout, 76–80 for the secondary figures and table values, 88 for the factory address. The width axis lets one family behave as a stamped condensed numeral face at display size and a compact tabular face in the tables, so the page keeps two families total. `font-variant-numeric: tabular-nums` and `font-feature-settings: "tnum" 1` are set on `body` and re-asserted on every numeral class, so digits stay in register across rows and between refreshes of the same figure.

Neither Inter, Roboto, Space Grotesk, nor a system stack appears anywhere; the fallbacks are Arial Narrow / Helvetica Neue / Arial only.
