#!/usr/bin/env bash
#
# tests/browser/run.sh  -  OPTIONAL: tests of the JavaScript behaviour (clicks, typing, forms, drag-free UI).
#
#     bash tests/browser/run.sh        (needs Node 18+ and npm; the app itself does NOT need Node)
#
# Each suite gets a brand-new throw-away database and its own PHP server, loads the REAL pages in jsdom
# (a simulated browser written in JavaScript), and drives them like a user would.
#
# HONEST LIMITS: jsdom is not a real browser. It does not draw anything, so it cannot tell you whether a page
# LOOKS right, and it does not enforce the Content-Security-Policy or real cookie rules. Use it for behaviour;
# keep checking layout by eye with the manual checklist in the README.

set -u
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
[ -d node_modules ] || npm install --no-audit --no-fund --loglevel=error || { echo "npm install failed"; exit 1; }

export MWAKI_ADMIN_PASSWORD='Admin-pass-1234' MWAKI_STAFF_PASSWORD='Staff-pass-1234'
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FAILED=0; PORT=8810

for suite in phase1 phase2 phase3-students phase3-admin; do
  PORT=$((PORT + 1))
  export MWAKI_DB_PATH="$TMP/$suite.sqlite"
  php "$ROOT/database/seed.php" > /dev/null || exit 1
  php -S "127.0.0.1:$PORT" -t "$ROOT/public" "$ROOT/router.php" > "$TMP/$suite.log" 2>&1 &
  SERVER=$!
  for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/api/session" && break; sleep 0.2; done

  OUT="$(BASE="http://127.0.0.1:$PORT" ROOT="$ROOT" ADMIN_PW="$MWAKI_ADMIN_PASSWORD" STAFF_PW="$MWAKI_STAFF_PASSWORD" node "$suite.js" 2>&1)"
  CODE=$?
  kill "$SERVER" 2>/dev/null
  echo "$OUT" | grep -E "FAIL|CRASH" | head -10
  printf '%-18s %s\n' "$suite" "$(echo "$OUT" | grep -E '^Result' | tail -1)"
  [ "$CODE" -eq 0 ] || FAILED=1
done
[ "$FAILED" -eq 0 ] && echo "All browser suites passed." || echo "Some browser suites FAILED."
exit "$FAILED"
