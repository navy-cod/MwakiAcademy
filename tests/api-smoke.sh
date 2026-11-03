#!/usr/bin/env bash
#
# tests/api-smoke.sh  -  quick automated checks for the PHP back end.
#
#     bash tests/api-smoke.sh
#
# What it does: seeds a THROW-AWAY database in a temp folder, starts a throw-away server on
# port 8765, sends real HTTP requests with curl, and compares the answers with what we expect.
# Your real data in storage/ is never touched. Needs: bash, curl, php.
#
# This is a "smoke test": it will not catch every bug, but if basic things are broken you
# find out in seconds. (Phases 2 and 3 add more checks to this file.)

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8765}"
BASE="http://127.0.0.1:$PORT"
TMP="$(mktemp -d)"
JAR="$TMP/cookies.txt"

# Environment variables: config/config.php reads MWAKI_DB_PATH, seed.php reads the passwords.
export MWAKI_DB_PATH="$TMP/test.sqlite"
export MWAKI_ADMIN_PASSWORD='Admin-pass-1234'
export MWAKI_STAFF_PASSWORD='Staff-pass-1234'

php "$ROOT/database/seed.php" > /dev/null || { echo "Seeding failed"; exit 1; }

php -S "127.0.0.1:$PORT" -t "$ROOT/public" "$ROOT/router.php" > "$TMP/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; rm -rf "$TMP"' EXIT      # always clean up, even on error
for _ in $(seq 1 40); do curl -s -o /dev/null "$BASE/api/session" && break; sleep 0.2; done

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s   (%s)\n' "$1" "$2"; }
expect() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected '$2' but got '$3'"; fi; }

# jget a.b.c  : read one value out of JSON on stdin (uses PHP so no extra tools are needed)
jget() {
  php -r '$v = json_decode(stream_get_contents(STDIN), true);
          foreach (explode(".", $argv[1]) as $k) { $v = (is_array($v) && array_key_exists($k, $v)) ? $v[$k] : null; }
          echo is_bool($v) ? ($v ? "true" : "false") : (is_array($v) ? json_encode($v) : ($v ?? "null"));' "$1"
}

# Every request shares one cookie jar, just like one browser.
req() { curl -s -b "$JAR" -c "$JAR" "$@"; }
csrf() { req "$BASE/api/session" | jget csrfToken; }

# send METHOD PATH JSON TOKEN  ->  sets $CODE (status) and $JSON (body)
send() {
  local out
  out="$(req -X "$1" -H 'Content-Type: application/json' -H "X-CSRF-Token: $4" -d "$3" -w '\n%{http_code}' "$BASE$2")"
  CODE="${out##*$'\n'}"; JSON="${out%$'\n'*}"
}

echo "Static files and routing"
expect "/ redirects to /home.html"                 "302 /home.html" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE/" | sed "s#http://127.0.0.1:$PORT##")"
expect "home.html is served"                        "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/home.html")"
curl -s -D - -o /dev/null "$BASE/home.html" | grep -qi '^content-security-policy:.*script-src' && ok "HTML pages carry a Content-Security-Policy" || bad "CSP header on HTML" "header missing"
csp_of() { curl -s -D - -o /dev/null "$BASE$1" | grep -i '^content-security-policy:' | tr -d '\r'; }
case "$(csp_of /login.html)" in
  *"script-src 'self' https://cdnjs.cloudflare.com;"*) ok "site pages use the STRICT script policy (no inline scripts)";;
  *) bad "strict CSP on login.html" "script-src is not strict";; esac
case "$(csp_of /e_students/students.html)" in
  *"script-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline'"*) ok "old student page keeps the TEMPORARY relaxed policy (removed in Phase 3)";;
  *) bad "relaxed CSP on students page" "unexpected policy";; esac
if grep -lE ' on(error|click|load|change|submit)=' "$ROOT"/public/*.html >/dev/null 2>&1; then
  bad "no inline event handlers in site pages" "$(grep -lE ' on(error|click|load|change|submit)=' "$ROOT"/public/*.html | tr '\n' ' ')"
else ok "no inline event handlers in site pages (the strict CSP would block them)"; fi
expect "style.css is served"                        "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/style.css")"
expect "src/bootstrap.php is NOT reachable"         "404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/src/bootstrap.php")"
expect "config/config.php is NOT reachable"         "404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/config/config.php")"
expect "database/students.json is NOT reachable"    "404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/database/students.json")"
expect "path traversal ../ is refused"              "404" "$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "$BASE/../config/config.php")"
expect "encoded traversal %2e%2e is refused"        "404" "$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "$BASE/%2e%2e/config/config.php")"

echo "Session and public data"
expect "GET /api/session works"                     "200" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/session")"
expect "anonymous session has no user"              "null" "$(req "$BASE/api/session" | jget user)"
curl -s -D - -o /dev/null "$BASE/api/session" | grep -i '^set-cookie:' | grep -qi 'httponly' && ok "session cookie is HttpOnly" || bad "cookie flags" "HttpOnly missing"
curl -s -D - -o /dev/null "$BASE/api/session" | grep -i '^set-cookie:' | grep -qi 'samesite=lax' && ok "session cookie is SameSite=Lax" || bad "cookie flags" "SameSite missing"
expect "GET /api/programs lists 7 programs"         "7" "$(req "$BASE/api/programs" | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo count($d["programs"]);')"
expect "tuition for BSc Computer Science"           "645650" "$(req "$BASE/api/programs" | php -r '$d=json_decode(stream_get_contents(STDIN),true); foreach($d["programs"] as $p){ if($p["name"]==="BSc Computer Science") echo $p["annualTuitionKes"]; }')"
expect "programs without tuition give null"         "null" "$(req "$BASE/api/programs" | php -r '$d=json_decode(stream_get_contents(STDIN),true); foreach($d["programs"] as $p){ if($p["name"]==="BSc Mathematics") echo var_export($p["annualTuitionKes"], true); }' | tr 'A-Z' 'a-z')"

echo "Protection of private data"
expect "GET /api/stats is refused when signed out"  "401" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/stats")"
expect "unknown API route gives 404"                "404" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/nope")"

echo "Sign-in rules"
BEFORE="$(csrf)"
cookie_value() { awk '$6 == "mwaki_session" { print $7 }' "$JAR"; }
SESSION_BEFORE="$(cookie_value)"
send POST /api/auth/login '{"username":"admin","password":"x"}' "wrong-token"
expect "POST without a valid CSRF token is refused" "403 csrf" "$CODE $(echo "$JSON" | jget code)"
expect "login over GET is not allowed (405)"        "405" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/auth/login?username=admin&password=$MWAKI_ADMIN_PASSWORD")"
send POST /api/auth/login '{}' "$BEFORE"
expect "empty login gives 422 + field errors"       "422" "$CODE"
expect "  ... naming the username field"            "Username is required." "$(echo "$JSON" | jget errors.username)"
send POST /api/auth/login '{"username":"admin","password":"wrong-password"}' "$BEFORE"
expect "wrong password gives 401"                   "401" "$CODE"
MSG_WRONG_PASS="$(echo "$JSON" | jget message)"
send POST /api/auth/login '{"username":"ghost-user","password":"wrong-password"}' "$BEFORE"
expect "unknown user gives 401 with the SAME message" "$MSG_WRONG_PASS" "$(echo "$JSON" | jget message)"
send POST /api/auth/login "{\"username\":\"admin' OR '1'='1\",\"password\":\"x\"}" "$BEFORE"
expect "SQL-injection attempt is just a failed login" "401" "$CODE"
send POST /api/auth/login "{\"username\":\"admin\",\"password\":\"$MWAKI_ADMIN_PASSWORD\"}" "$BEFORE"
expect "correct admin login gives 200"              "200" "$CODE"
expect "  ... as role admin"                         "admin" "$(echo "$JSON" | jget user.role)"
AFTER="$(echo "$JSON" | jget csrfToken)"
[ -n "$AFTER" ] && [ "$AFTER" != "$BEFORE" ] && ok "CSRF token is renewed at sign-in" || bad "CSRF renewal" "token unchanged"
expect "session now reports the user"               "admin" "$(req "$BASE/api/session" | jget user.username)"
SESSION_AFTER="$(cookie_value)"
[ -n "$SESSION_AFTER" ] && [ "$SESSION_AFTER" != "$SESSION_BEFORE" ] && ok "session id is replaced at sign-in (no fixation)" || bad "session fixation defence" "cookie value did not change"

echo "Protected data after sign-in"
expect "GET /api/stats works for admin"             "200" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/stats")"
expect "  ... 10 seeded students"                    "10" "$(req "$BASE/api/stats" | jget students.total)"
expect "  ... 7 program rows"                        "7" "$(req "$BASE/api/stats" | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo count($d["students"]["byProgram"]);')"
send DELETE /api/programs '' "$AFTER"
expect "wrong HTTP method on a real URL gives 405"  "405" "$CODE"
send POST /api/auth/logout '{}' "$AFTER"
expect "logout gives 200"                           "200" "$CODE"
expect "after logout /api/stats is 401 again"       "401" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/stats")"

echo "Staff role"
T="$(csrf)"
send POST /api/auth/login "{\"username\":\"staff\",\"password\":\"$MWAKI_STAFF_PASSWORD\"}" "$T"
expect "staff login works"                          "staff" "$(echo "$JSON" | jget user.role)"

echo "Brute-force throttling"
rm -f "$JAR"; T="$(csrf)"
for i in 1 2 3 4 5; do send POST /api/auth/login '{"username":"nobody","password":"guess"}' "$T"; done
expect "5th wrong guess is still a normal 401"      "401" "$CODE"
send POST /api/auth/login '{"username":"nobody","password":"guess"}' "$T"
expect "6th attempt is throttled (429)"             "429" "$CODE"
expect "  ... with code 'throttled'"                 "throttled" "$(echo "$JSON" | jget code)"

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
