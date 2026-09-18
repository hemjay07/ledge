#!/usr/bin/env bash
# scripts/vercel-ignore.sh -- Vercel's "ignored build step" (vercel.json
# ignoreCommand). Exit 1 = build this commit, exit 0 = skip it.
#
# 2026-09-18: the crawl commits data/ every 10 minutes, 144 deploys a day,
# and the free plan allows 100. Vercel rate-limited every second deploy all
# day, which also stranded every code push until the next data commit got
# through. A data-only commit now builds only when its crawl minute falls in
# the first half of each 20-minute slot (:00-:09, :20-:29, :40-:49): 72
# data builds a day, and the site is never more than ~20 minutes behind the
# record, under the 30-minute stale line (METHOD.md, staleAfterSeconds).
#
# Anything that touches a file outside data/ always builds. Any error here
# also builds: a skipped deploy is the worse failure.

set -u

changed="$(git diff --name-only HEAD~1 HEAD 2>/dev/null)" || exit 1
[ -z "$changed" ] && exit 1

if printf '%s\n' "$changed" | grep -qvE '^data/'; then
  exit 1 # code, docs or config changed: build
fi

minute="$(git log -1 --format=%cd --date=format:%M HEAD 2>/dev/null)" || exit 1
case "$minute" in
  0[0-9]|2[0-9]|4[0-9]) exit 1 ;; # build
  *) echo "data-only commit at minute $minute: skipped (next slot builds)"; exit 0 ;;
esac
