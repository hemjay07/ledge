#!/usr/bin/env bash
# scripts/lint-copy.sh
#
# Greps site source, README.md, and pipeline/ copy strings for phrases and
# words the CONSTRAINTS.md NOT-THIS list bans from LEDGE's public surface.
# Exits 1 and prints the offending lines if anything matches.
#
# Excludes CONSTRAINTS.md itself (which quotes the banned phrases in order
# to ban them) and node_modules.
#
# A trailing `# lint-copy:allow` comment on a line is the only escape hatch,
# and using it requires a reviewer note in the PR.
#
# Self-test (run manually, expect a non-zero exit and one match):
#   printf 'this page has alpha in it\n' > /tmp/lint-copy-selftest.txt && \
#   grep -riE '\balpha\b' /tmp/lint-copy-selftest.txt && rm /tmp/lint-copy-selftest.txt
#
# Word-boundary note: \bedge\b does NOT match "LEDGE" or "ledge" — the
# character before the "e" of "edge" in "ledge" is "l", a word character,
# so \b (a transition between \w and \W) does not fire there. Verified:
#   echo "the LEDGE number" | grep -iE '\bedge\b'   # no match, exit 1
#   echo "no edge here"     | grep -iE '\bedge\b'   # match, exit 0

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Phrase / word patterns (case-insensitive), from CONSTRAINTS.md's NOT-THIS
# list plus the explicit word list.
PATTERN='trade smarter'
PATTERN+='|know before you ape'
PATTERN+='|data.driven insights?'
PATTERN+='|\balpha\b'
PATTERN+='|\bedge\b'
PATTERN+='|\bsignals?\b'
PATTERN+='|we believe'
PATTERN+='|our mission'
PATTERN+="|in today's"
PATTERN+='|fast.moving'
PATTERN+='|\bDYOR\b'
PATTERN+='|not financial advice'
PATTERN+='|risk warning'
PATTERN+='|\bpro\b'
PATTERN+='|premium'
PATTERN+='|coming soon'
PATTERN+='|join the waitlist'
PATTERN+='|\bwaitlist\b'
PATTERN+='|\bsubscribe\b'
PATTERN+='|connect wallet'
PATTERN+='|gradient'
PATTERN+='|\bglow'
PATTERN+='|purple'
PATTERN+='|violet'
PATTERN+='|hero illustration'
PATTERN+='|mascot'
PATTERN+='|should (buy|sell|avoid|wait)'
PATTERN+='|you should'


# Targets: site source, README, and pipeline copy strings.
TARGETS=()
[ -d site/app ] && TARGETS+=("site/app")
[ -d site/components ] && TARGETS+=("site/components")
[ -d site/lib ] && TARGETS+=("site/lib")
[ -f README.md ] && TARGETS+=("README.md")
[ -d pipeline ] && TARGETS+=("pipeline")

if [ "${#TARGETS[@]}" -eq 0 ]; then
  echo "lint-copy: no targets present yet, nothing to check"
  exit 0
fi

EXCLUDES=(--exclude=CONSTRAINTS.md --exclude-dir=node_modules --exclude-dir=.venv \
          --exclude-dir=__pycache__ --exclude-dir=.next --exclude-dir=out \
          --exclude-dir=tests "--exclude=*.json" "--exclude=*.lock" "--exclude=*.sol")

FAIL=0
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Phrase / word matches — allow a trailing `# lint-copy:allow` escape hatch.
if grep -rnIE "${EXCLUDES[@]}" "$PATTERN" "${TARGETS[@]}" 2>/dev/null \
     | grep -v 'lint-copy:allow' > "$TMP"; then
  if [ -s "$TMP" ]; then
    echo "lint-copy: banned phrase(s) found:"
    cat "$TMP"
    FAIL=1
  fi
fi

# Emoji matches. Done in Python (not grep -P) so this works the same way
# whether the local `grep` is GNU grep (Linux runners) or BSD grep (macOS),
# which does not support \x{...} Unicode escapes at all.
TMP2="$(mktemp)"
trap 'rm -f "$TMP" "$TMP2"' EXIT
PY="$(command -v python3 || command -v python)"
if [ -n "$PY" ]; then
  "$PY" - "${TARGETS[@]}" > "$TMP2" <<'PYEOF'
import re, sys, os

EMOJI_RE = re.compile(
    "[" +
    "\U0001F000-\U0001FAFF" +  # symbols, pictographs, emoticons, supplemental
    "\U00002600-\U000027BF" +  # misc symbols, dingbats
    "\U00002190-\U000021FF" +  # arrows
    "\U00002B00-\U00002BFF" +  # misc symbols and arrows
    "\U0000FE0F" +             # variation selector-16 (emoji presentation)
    "]"
)

EXCLUDE_NAMES = {"CONSTRAINTS.md"}
EXCLUDE_DIRS = {"node_modules", ".venv", "__pycache__", ".next", "out", "tests", ".git"}
EXCLUDE_SUFFIXES = (".json", ".lock", ".sol")

def iter_files(target):
    if os.path.isfile(target):
        yield target
        return
    for root, dirs, files in os.walk(target):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for fn in files:
            if fn in EXCLUDE_NAMES or fn.endswith(EXCLUDE_SUFFIXES):
                continue
            yield os.path.join(root, fn)

for target in sys.argv[1:]:
    for path in iter_files(target):
        try:
            with open(path, encoding="utf-8", errors="ignore") as fh:
                for lineno, line in enumerate(fh, start=1):
                    if "lint-copy:allow" in line:
                        continue
                    if EMOJI_RE.search(line):
                        print(f"{path}:{lineno}:{line.rstrip()}")
        except (IsADirectoryError, PermissionError):
            continue
PYEOF
  if [ -s "$TMP2" ]; then
    echo "lint-copy: emoji found:"
    cat "$TMP2"
    FAIL=1
  fi
else
  echo "lint-copy: warning: no python3/python found, skipping emoji check" >&2
fi

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "lint-copy: clean"
exit 0
