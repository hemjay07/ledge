"""The stall alert to the owner.

On 2026-09-15 the live index failed every pass from 18:03Z and the crawl
with it, for seven hours, and nobody was told: the site showed the stale
state, the room stayed quiet, and the owner found out the next day. This
script runs on the box every five minutes (ops/ledge-watch.timer), reads
three things anyone can read, and sends the owner one Telegram message
when one of them goes wrong and one more when it comes back.

  1. /api/health on the Worker: the live index's cursor (last_success_at,
     consecutive_failures, last_error, last_indexed_block).
  2. number.json on the site: when the crawl last published.
  3. The gateway's /metrics on loopback: the chain head it last saw, so a
     cursor far behind the head is named as "catching up", not as fine.

Nothing here is a statistic about pons; it is about our own machinery.
The message is sent once per stall, repeated every six hours while it
lasts, and once on recovery. State lives in a small JSON file so a run
knows what it already said. No owner chat id, no message: the script then
prints what it would have sent and exits 0.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TICK_STALE_SECONDS = 20 * 60
CRAWL_STALE_SECONDS = 90 * 60
FAILURES_LIMIT = 10
LAG_BLOCKS = 30_000
REMIND_SECONDS = 6 * 3600

HEALTH_URL = "https://ledge-api.ledge-worker.workers.dev/api/health"
METRICS_URL = "http://127.0.0.1:8545/metrics"


def _parse_iso(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def _age(seconds: int) -> str:
    if seconds < 90:
        return f"{seconds} s"
    if seconds < 5400:
        return f"{round(seconds / 60)} min"
    if seconds < 172_800:
        h = seconds // 3600
        m = round((seconds - h * 3600) / 60)
        return f"{h} h" if m == 0 else f"{h} h {m} min"
    return f"{round(seconds / 86400)} days"


def _stamp(unix: int) -> str:
    return datetime.fromtimestamp(unix, tz=timezone.utc).strftime("%-d %b %H:%M UTC")


def conditions(health: dict | None, number: dict | None, metrics: dict | None, now: int) -> dict[str, str]:
    """Every current stall, keyed by name, with the sentence that describes it.
    An unreadable source is itself a condition: silence is not health."""
    out: dict[str, str] = {}

    if health is None:
        out["health"] = "The Worker's /api/health could not be read."
    else:
        last = _parse_iso(health.get("lastSuccessAt"))
        failures = int(health.get("consecutiveFailures") or 0)
        error = health.get("lastError")
        if last is None:
            out["tick"] = "The live index has never completed a pass."
        elif now - last > TICK_STALE_SECONDS:
            detail = f" Last error: {error}." if error else ""
            out["tick"] = (
                f"The live index has not completed a pass since {_stamp(last)} ({_age(now - last)} ago), "
                f"{failures} failures in a row.{detail}"
            )
        elif failures >= FAILURES_LIMIT:
            out["failures"] = f"The live index is failing: {failures} passes in a row. Last error: {error}."
        head = (metrics or {}).get("head")
        cursor = health.get("lastIndexedBlock")
        if isinstance(head, int) and isinstance(cursor, int) and head - cursor > LAG_BLOCKS:
            out["lag"] = f"The live index is {head - cursor:,} blocks behind the chain head (catching up)."

    if number is None:
        out["number"] = "number.json on the site could not be read."
    else:
        crawled = _parse_iso(number.get("crawledAt"))
        if crawled is None:
            out["crawl"] = "number.json carries no crawledAt."
        elif now - crawled > CRAWL_STALE_SECONDS:
            out["crawl"] = f"The crawl last published {_stamp(crawled)} ({_age(now - crawled)} ago)."

    return out


def decide(current: dict[str, str], state: dict, now: int) -> tuple[str | None, dict]:
    """The message to send, if any, and the state to keep. Sends on a new
    stall, every REMIND_SECONDS while it lasts, and once on recovery."""
    previous: dict[str, str] = state.get("active", {})
    sent_at = int(state.get("sentAt") or 0)

    new = {k: v for k, v in current.items() if k not in previous}
    cleared = [k for k in previous if k not in current]
    due = current and now - sent_at >= REMIND_SECONDS

    lines: list[str] = []
    if new or due:
        lines.append("LEDGE stall" if not previous else "LEDGE stall, still")
        lines.extend(current.values())
    elif cleared and not current:
        lines.append("LEDGE recovered.")
        lines.append(f"Cleared: {', '.join(cleared)}.")
    elif cleared:
        lines.append(f"LEDGE: cleared {', '.join(cleared)}; still open:")
        lines.extend(current.values())

    if not lines:
        return None, {"active": current, "sentAt": sent_at}
    return "\n".join(lines), {"active": current, "sentAt": now}


def _fetch_json(url: str, timeout: int = 20) -> dict | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ledge-watch/1.0"}), timeout=timeout) as r:
            return json.load(r)
    except Exception:  # noqa: BLE001 -- any failure to read is reported as a condition
        return None


def _send(token: str, chat_id: str, text: str) -> bool:
    body = json.dumps({"chat_id": chat_id, "text": text, "disable_web_page_preview": True}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def main() -> int:
    now = int(datetime.now(tz=timezone.utc).timestamp())
    state_path = Path(os.environ.get("WATCH_STATE_PATH", "/home/ledge/stall-watch.json"))
    try:
        state = json.loads(state_path.read_text())
    except (OSError, ValueError):
        state = {}

    health = _fetch_json(os.environ.get("HEALTH_URL", HEALTH_URL))
    number = _fetch_json(os.environ.get("NUMBER_JSON_URL", "https://ledge.tools/number.json"))
    metrics = _fetch_json(os.environ.get("GATEWAY_METRICS_URL", METRICS_URL), timeout=5)

    current = conditions(health, number, metrics, now)
    message, next_state = decide(current, state, now)
    print(f"ledge-watch: {len(current)} condition(s): {', '.join(current) or 'none'}")
    if message is None:
        state_path.write_text(json.dumps(next_state))
        return 0

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_OWNER_CHAT_ID")
    if not token or not chat_id:
        print("ledge-watch: no TELEGRAM_OWNER_CHAT_ID; would have sent:\n" + message)
        state_path.write_text(json.dumps(next_state))
        return 0
    if _send(token, chat_id, message):
        state_path.write_text(json.dumps(next_state))
        print("ledge-watch: sent")
    else:
        print("ledge-watch: Telegram refused; will retry next run")
    return 0


if __name__ == "__main__":
    sys.exit(main())
