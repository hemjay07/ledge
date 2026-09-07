"""The weekly dispatch: one email composed from the published record.

ARCHITECTURE-PHASE2-4.md section 11, day 9. Stdlib only -- `urllib` for the
one HTTP call, nothing else.

CLASS A ONLY (ARCHITECTURE-PHASE2-4.md section 0). Every figure in the
message is a count or a rate that came out of `pipeline/stats.py`, over a
window `stats.window` selected, carrying the n and the window it was
computed on. This module chooses which of those figures to say and in what
words. It derives nothing: there is no division, no ranking by a quantity
this file computed, no percentage that stats.py did not produce. The
printing rules are imported from `pipeline/vectors.py`, which already holds
the Python port of the Worker's `format.ts`, so the dispatch, the site, the
API and the bot cannot disagree about when a number may be printed.

THE WINDOW IS min(7 days, the indexed record). LEDGE's record starts at its
first indexed launch, so a dispatch sent before seven days are indexed
measures the record, not seven days. The window is clamped to it and every
label -- subject, heading, the number line, the cohort lines -- names the
span that was actually measured ("the indexed record so far: 29 h to
6 Sep 2026"), because a figure labelled with a window nobody measured is a
figure without its window (CONSTRAINTS.md #3).

WHY THE 7-DAY WINDOW IS NOT IN number.json. `stats.window` takes an
arbitrary `[since, until)` and `stats._window_block` assembles the same
object the file publishes for `h24` and `allTime`, so a `d7` key would be a
two-line change to `recompute.py`, and `site/lib/schema.ts` is not
`.strict()` -- an extra top-level key parses. It is still not added, for a
reason that outranks both: `data/number.json` is covered byte-for-byte by
`recompute.py --check` and frozen again in `tests/vectors/`, so emitting a
new key means regenerating committed data, and the dispatch is not a good
enough reason to move the file every consumer of the site is pinned to.
The window therefore lives here, computed by the same functions, and the
gate over the published file stays exactly as tight as it was. If a second
consumer ever needs the 7-day window, it belongs in `number.json` and in a
dated /method entry, not copied into a second module.

COPY. The message says what was counted and stops. No sentence tells the
reader what to do with a number, nothing is in the future tense, and no
cohort difference is stated as a cause -- two counts side by side are two
counts. `pipeline/tests/test_dispatch.py` greps the whole rendered message
for the banned list, both renderings.

DELIVERY. Resend Broadcasts: `POST /broadcasts` with the audience id, then
`POST /broadcasts/{id}/send`. Resend's own docs name the audience field
`segment_id` (Audiences are addressed as segments in the current API); the
environment variable stays `RESEND_AUDIENCE_ID` because that is the id the
dashboard shows. `--dry-run` writes the two previews and returns without
opening a socket.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import stats
from pipeline.recompute import load_partitions, resolve_pair_class
from pipeline.vectors import (
    format_count,
    format_duration,
    is_insufficient,
    pair_label,
    rate_text,
    tax_label,
)

SITE = "ledge.tools"
METHOD_URL = "https://ledge.tools/method"
UNSUBSCRIBE_TOKEN = "{{{RESEND_UNSUBSCRIBE_URL}}}"

RESEND_BASE = "https://api.resend.com"
DEFAULT_SENDER = "LEDGE <dispatch@ledge.tools>"
DEFAULT_OUT_DIR = "dispatch"
DEFAULT_DATA_DIR = "data"

WINDOW_DAYS = 7
WINDOW_SECONDS = WINDOW_DAYS * 86400

# The rung the insight line reads. A definition in the same sense every
# other mark is: it is one of stats.LADDER_EDGES and the line prints the
# rung's own count and share, never a figure of its own.
INSIGHT_RUNG_SECONDS = 60

MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# What a window shorter than the cap is called. The record LEDGE holds starts
# at its first indexed launch, so until seven days have been indexed the
# window is the record, and every label in the message says which it is and
# how long it ran. A message that says "last 7 days" over 29 hours of record
# states a window that was never measured.
SHORT_WINDOW_LEAD = "the indexed record so far"


def format_span(seconds: int) -> str:
    """The measured span, in the largest unit it fills exactly.

    Whole days print as days ("7 days"); anything else prints as the hours
    it completed ("29 h"), then minutes. Hours are floored, not rounded: the
    label names a span the window covers, never one it does not.
    """
    if seconds >= 86400 and seconds % 86400 == 0:
        days = seconds // 86400
        return f"{days} day" if days == 1 else f"{days} days"
    if seconds >= 3600:
        return f"{seconds // 3600} h"
    return f"{max(1, seconds // 60)} min"


def window_phrase(seconds: int, full: bool) -> str:
    """The window as a figure's own label: "last 7 days", or the record's
    real span when the record is shorter than the cap."""
    span = format_span(seconds)
    return f"last {span}" if full else f"{SHORT_WINDOW_LEAD}, {span}"


class DispatchError(RuntimeError):
    """A delivery attempt that Resend refused, or a transport that failed."""


# --- loading -----------------------------------------------------------------
def parse_iso(value: str) -> int:
    return int(datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def format_stamp(iso: str) -> str:
    """"Measured 6 Sep 2026 · 00:00 UTC" -- the colophon stamp, the same
    wording the fold and the card carry, so a figure quoted out of the email
    is attributable to the same measurement."""
    d = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return f"Measured {d.day} {MONTHS_SHORT[d.month - 1]} {d.year} · {d:%H:%M} UTC"


def load_inputs(data_dir) -> tuple[dict, list, list]:
    """number.json plus the raw partitions, with pairClass re-derived exactly
    as `recompute.py` derives it. No network, no clock read."""
    data_dir = Path(data_dir)
    number = json.loads((data_dir / "number.json").read_text())

    pair_tokens_path = data_dir / "pair-tokens.json"
    pair_tokens = json.loads(pair_tokens_path.read_text()) if pair_tokens_path.exists() else {}

    launches = load_partitions(data_dir / "launches")
    graduations = load_partitions(data_dir / "graduations")
    for launch in launches:
        launch["pairClass"] = resolve_pair_class(launch, pair_tokens)
    return number, launches, graduations


# --- selection ---------------------------------------------------------------
def _sufficient_rows(rows: list[dict]) -> list[dict]:
    return [r for r in rows if not is_insufficient(r["rate"], r["launches"], r["insufficient"])]


def furthest_apart(rows: list[dict]) -> tuple[dict, dict] | None:
    """The highest and the lowest published rate in a cohort.

    A selection, not a computation: both rows are stats.py's, printed
    unchanged with their own counts. No spread between them is printed --
    a difference of two rates is a figure of this module's own, and this
    module publishes none. Null when fewer than two rows clear the gate,
    because a comparison needs two things to compare.
    """
    usable = _sufficient_rows(rows)
    if len(usable) < 2:
        return None
    ordered = sorted(usable, key=lambda r: r["rate"])
    return ordered[-1], ordered[0]


def _cohort_n(rows: list[dict]) -> int:
    """The bucketed denominator of a cohort: what the buckets hold between
    them. Printed in place of a rate when the cohort cannot be published."""
    return sum(r["launches"] for r in rows)


def _rung(ladder: list[dict], at_seconds: int) -> dict | None:
    for rung in ladder:
        if rung["atSeconds"] == at_seconds:
            return rung
    return None


# --- composition -------------------------------------------------------------
def _number_lines(d7: dict, phrase: str) -> list[str]:
    n = d7["launches"]
    plain = rate_text(d7["rate"], n, d7["insufficient"])
    lines = [
        f"Pons, {phrase}: {format_count(d7['graduations'])} of "
        f"{format_count(n)} launches graduated, {plain}."
    ]

    ef = d7["excludingFast"]
    ef_text = rate_text(ef["rate"], n, ef["insufficient"])
    one_in = ""
    if not is_insufficient(ef["rate"], n, ef["insufficient"]) and ef["oneIn"] is not None:
        one_in = f" (1 in {format_count(ef['oneIn'])})"
    lines.append(
        f"Excluding launches that graduated inside {format_duration(ef['cutoffSeconds'])}: "
        f"{format_count(ef['graduations'])} of {format_count(n)}, {ef_text}{one_in}."
    )
    return lines


def _cohort_line(rows: list[dict], lead: str, label, span: str) -> str:
    pair = furthest_apart(rows)
    if pair is None:
        return f"{lead}: not enough data (n={_cohort_n(rows)})."
    high, low = pair
    return (
        f"{lead}, furthest apart: "
        f"{label(high['bucket'])} {format_count(high['graduations'])} of "
        f"{format_count(high['launches'])} graduated, "
        f"{rate_text(high['rate'], high['launches'], high['insufficient'])}; "
        f"{label(low['bucket'])} {format_count(low['graduations'])} of "
        f"{format_count(low['launches'])}, "
        f"{rate_text(low['rate'], low['launches'], low['insufficient'])}. "
        f"Two counts over the same {span}, not a cause."
    )


def _ttg_line(ttg: dict) -> str:
    if ttg["insufficient"] or ttg["p50"] is None or ttg["p90"] is None:
        return f"Time to graduation: not enough data (n={ttg['n']})."
    return (
        f"Time to graduation, over {format_count(ttg['n'])} graduations measured: "
        f"half within {format_duration(ttg['p50'])}, "
        f"9 in 10 within {format_duration(ttg['p90'])}."
    )


def _insight_line(ttg: dict) -> str | None:
    """One fact from the record, with its n, or nothing.

    The fact is a rung of the published ladder: how many of the graduations
    measured in this window completed inside a fixed mark. It is a count and
    a share stats.py produced, over a denominator the sentence names. When
    the distribution is under the gate there is no fact to state, and the
    line is omitted -- a dispatch with one figure fewer is honest; a
    sentence written to fill the slot is not.
    """
    rung = _rung(ttg.get("ladder", []), INSIGHT_RUNG_SECONDS)
    if rung is None or ttg["insufficient"] or rung["cumulativeShare"] is None:
        return None
    return (
        f"Graduations that completed in under {format_duration(rung['atSeconds'])}: "
        f"{format_count(rung['cumulative'])} of {format_count(ttg['n'])} measured "
        f"({rate_text(rung['cumulativeShare'], ttg['n'], ttg['insufficient'])})."
    )


def _subject(d7: dict, seconds: int, full: bool) -> str:
    lead = format_span(seconds) if full else f"{SHORT_WINDOW_LEAD}, {format_span(seconds)}"
    ef = d7["excludingFast"]
    n = d7["launches"]
    if is_insufficient(ef["rate"], n, ef["insufficient"]) or ef["oneIn"] is None:
        return f"LEDGE — {lead}: not enough data (n={n})"
    return (
        f"LEDGE — {lead}: 1 in {format_count(ef['oneIn'])}, "
        f"excluding graduations inside {format_duration(ef['cutoffSeconds'])}"
    )


def compose(number: dict, launches: list, graduations: list) -> dict:
    """The whole message as data: one block per figure, each a list of
    finished sentences. Both renderings read this and neither writes a
    sentence of its own, so the plain text and the HTML cannot diverge."""
    until = parse_iso(number["crawledAt"])
    # min(7 days, the indexed record). The record begins at its first indexed
    # launch, so before seven days are indexed the window is the record, and
    # every label below says so with the span it actually covers.
    since = until - WINDOW_SECONDS
    first_indexed_at = number.get("firstIndexedAt")
    if first_indexed_at:
        since = max(since, parse_iso(first_indexed_at))
    window_seconds = until - since
    full = window_seconds >= WINDOW_SECONDS
    phrase = window_phrase(window_seconds, full)
    span = format_span(window_seconds)

    # The same assembly `recompute.py` runs for h24 and allTime, over that
    # interval. lowerBound is true for the same reason it is true of h24: a
    # launch near the end of the window may still graduate.
    d7 = stats._window_block(launches, graduations, since, until, lower_bound=True)

    blocks = [
        {"id": "number", "lines": _number_lines(d7, phrase)},
        {
            "id": "cohorts",
            "lines": [
                _cohort_line(d7["cohorts"]["pair"], "Pair token", pair_label, span),
                _cohort_line(d7["cohorts"]["tax"], "Creator tax", tax_label, span),
            ],
        },
        {"id": "ttg", "lines": [_ttg_line(d7["ttg"])]},
    ]
    insight = _insight_line(d7["ttg"])
    if insight is not None:
        blocks.append({"id": "insight", "lines": [insight]})

    stamp = format_stamp(number["crawledAt"])
    measured_on = stamp.removeprefix("Measured ").split(" · ")[0]
    heading_lead = span if full else f"{SHORT_WINDOW_LEAD}: {span}"
    return {
        "crawledAt": number["crawledAt"],
        "definitionsVersion": number.get("definitionsVersion"),
        "windowDays": WINDOW_DAYS,
        "windowSeconds": window_seconds,
        "full": full,
        "since": since,
        "until": until,
        "subject": _subject(d7, window_seconds, full),
        "heading": f"LEDGE — {heading_lead} to {measured_on}",
        "blocks": blocks,
        "footer": [
            f"{stamp}.",
            SITE,
            f"Method and definitions: {METHOD_URL}",
            f"Unsubscribe: {UNSUBSCRIBE_TOKEN}",
        ],
        "d7": d7,
    }


# --- rendering ---------------------------------------------------------------
def render_text(composed: dict) -> str:
    parts = [composed["heading"]]
    for block in composed["blocks"]:
        parts.append("\n".join(block["lines"]))
    parts.append("\n".join(composed["footer"]))
    return "\n\n".join(parts) + "\n"


def escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


# The sheet, in the design's terms and an email client's capabilities:
# bone ground, ink text, printed rules, radius 0, no shadow, no image. The
# faces are named with web-safe fallbacks because a mail client loads
# neither a webfont nor a stylesheet -- IBM Plex Mono then Courier for the
# record, Newsreader then Georgia for the running text.
_MONO = "'IBM Plex Mono', 'Courier New', Courier, monospace"
_SERIF = "Newsreader, Georgia, 'Times New Roman', serif"
_GROUND = "#EFEAE0"
_INK = "#16130F"
_INK_MUTED = "#57503F"
_RULE_HAIR = "#CDC6B3"


def render_html(composed: dict) -> str:
    rows = []
    for block in composed["blocks"]:
        body = "<br>".join(escape_html(line) for line in block["lines"])
        rows.append(
            f'<div style="border-top:1px solid {_RULE_HAIR};padding:18px 0;'
            f'font-family:{_SERIF};font-size:16px;line-height:1.55;color:{_INK};">{body}</div>'
        )
    footer = "<br>".join(escape_html(line) for line in composed["footer"])
    heading = escape_html(composed["heading"])
    return (
        "<!doctype html>\n"
        '<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{heading}</title></head>"
        f'<body style="margin:0;padding:0;background:{_GROUND};">'
        f'<div style="max-width:620px;margin:0 auto;padding:32px 20px;background:{_GROUND};">'
        f'<div style="border-top:7px solid {_INK};padding-top:14px;'
        f'font-family:{_MONO};font-size:12px;letter-spacing:.14em;'
        f'text-transform:uppercase;color:{_INK};">{heading}</div>'
        + "".join(rows)
        + f'<div style="border-top:3px solid {_INK};margin-top:6px;padding-top:14px;'
        f'font-family:{_MONO};font-size:12px;line-height:1.7;color:{_INK_MUTED};">{footer}</div>'
        f'<div style="border-top:7px solid {_INK};margin-top:14px;"></div>'
        "</div></body></html>\n"
    )


# --- delivery ----------------------------------------------------------------
def broadcast_body(composed: dict, audience_id: str, sender: str) -> dict:
    """The `POST /broadcasts` body. `segment_id` is Resend's field name for
    the audience; the id itself is the one the dashboard calls an audience."""
    return {
        "segment_id": audience_id,
        "from": sender,
        "subject": composed["subject"],
        "html": render_html(composed),
        "text": render_text(composed),
    }


def http_transport(url: str, payload: dict, api_key: str, method: str = "POST"):
    """One JSON request. The only socket this module opens."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read() or b"{}"
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, {"message": raw.decode(errors="replace"), "code": "unparseable"}
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise DispatchError(f"transport failed: {exc}") from exc


def _expect_ok(status: int, body: dict, what: str) -> dict:
    if status >= 400:
        code = body.get("code", "unknown")
        message = body.get("message", "")
        raise DispatchError(f"{what} refused ({status}, {code}): {message}")
    return body


def send(
    composed: dict,
    *,
    api_key: str,
    audience_id: str,
    sender: str = DEFAULT_SENDER,
    transport=http_transport,
) -> dict:
    """Create the broadcast, then send it. Two calls, both against the
    audience id; nothing about a recipient ever reaches this repo."""
    status, body = transport(
        f"{RESEND_BASE}/broadcasts", broadcast_body(composed, audience_id, sender), api_key
    )
    created = _expect_ok(status, body, "broadcast create")
    broadcast_id = created.get("id")
    if not broadcast_id:
        raise DispatchError(f"broadcast create returned no id: {created}")

    status, body = transport(f"{RESEND_BASE}/broadcasts/{broadcast_id}/send", {}, api_key)
    return _expect_ok(status, body, "broadcast send")


# --- cli ---------------------------------------------------------------------
def _write_previews(out_dir: Path, composed: dict) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "preview.txt").write_text(render_text(composed))
    (out_dir / "preview.html").write_text(render_html(composed))


def main(argv: list | None = None, transport=http_transport) -> int:
    parser = argparse.ArgumentParser(description="Compose and send the weekly dispatch.")
    parser.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    parser.add_argument("--from", dest="sender", default=os.environ.get("RESEND_FROM") or DEFAULT_SENDER)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="write the previews and return; open no socket",
    )
    args = parser.parse_args(argv)

    composed = compose(*load_inputs(args.data_dir))
    out_dir = Path(args.out_dir)
    _write_previews(out_dir, composed)
    print(render_text(composed))

    if args.dry_run:
        print(f"dispatch: previews written to {out_dir}, nothing sent", file=sys.stderr)
        return 0

    api_key = os.environ.get("RESEND_API_KEY", "")
    audience_id = os.environ.get("RESEND_AUDIENCE_ID", "")
    if not api_key:
        print("dispatch: RESEND_API_KEY is not set; nothing sent", file=sys.stderr)
        return 1
    if not audience_id:
        print("dispatch: RESEND_AUDIENCE_ID is not set; nothing sent", file=sys.stderr)
        return 1

    try:
        result = send(
            composed,
            api_key=api_key,
            audience_id=audience_id,
            sender=args.sender,
            transport=transport,
        )
    except DispatchError as exc:
        print(f"dispatch: {exc}", file=sys.stderr)
        return 1
    print(f"dispatch: broadcast {result.get('id')} sent", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
