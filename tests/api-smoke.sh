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
# find out in seconds.

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
  *"script-src 'self' https://cdnjs.cloudflare.com;"*) ok "the student manager ALSO uses the strict script policy (Phase 1 exception is gone)";;
  *) bad "strict CSP on the student manager" "script-src is not strict";; esac
# Lines that are only comments (// ..., * ..., <!-- ...) may MENTION onclick= when explaining XSS; code may not use it.
NOT_COMMENT='^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*|<!--)'
HANDLERS="$(grep -rnE " on(error|click|load|change|submit|input|focus|blur|mouseover)=" "$ROOT"/public --include='*.html' --include='*.js' 2>/dev/null | grep -vE "$NOT_COMMENT" || true)"
[ -z "$HANDLERS" ] && ok "no inline event handlers (onclick=...) in any page or script" || bad "inline event handlers" "$(echo "$HANDLERS" | cut -c1-120 | tr '\n' ' ')"
INNER="$(grep -rn "innerHTML" "$ROOT"/public --include='*.js' | grep -v 'public/js/ui.js' | grep -vE "$NOT_COMMENT" || true)"
[ -z "$INNER" ] && ok "innerHTML is only used in js/ui.js (one audited place)" || bad "innerHTML outside ui.js" "$(echo "$INNER" | cut -c1-120 | tr '\n' ' ')"
[ ! -e "$ROOT/public/e_students/students.json" ] && ok "no public copy of students.json any more (seed data lives in database/)" || bad "public students.json" "file still exists"
expect "/e_students/students.json is not served"    "404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/e_students/students.json")"
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


# =====================================================================================
# PHASE 2: admission applications, application tracking, contact messages
# =====================================================================================
dbq() { php -r '$p = new PDO("sqlite:" . getenv("MWAKI_DB_PATH")); echo $p->query($argv[1])->fetchColumn();' "$1"; }
rm -f "$JAR"; T="$(csrf)"
PROGRAMS="$(req "$BASE/api/programs")"
pid() { echo "$PROGRAMS" | php -r '$d = json_decode(stream_get_contents(STDIN), true); foreach ($d["programs"] as $p) { if ($p["name"] === $argv[1]) echo $p["id"]; }' "$1"; }
CS_ID="$(pid 'BSc Computer Science')"; BBA_ID="$(pid 'BBA Business Administration')"
THIS_YEAR="$(date +%Y)"; NEXT_YEAR=$((THIS_YEAR + 1))
DOB_OK="2003-04-12"; DOB_YOUNG="$(php -r 'echo date("Y-m-d", strtotime("-10 years"));')"
# app PROGRAM GRADE YEAR PERIOD EMAIL DOB [ADDRESS]  ->  a complete, valid JSON body unless you break one part
app() {
  printf '{"fullName":"Test Applicant","email":"%s","phone":"0712 345 678","gender":"Female","dob":"%s","address":"%s","programId":%s,"kcseGrade":"%s","intakeYear":%s,"intakePeriod":"%s","motivation":"I want to study here because it is a great place to learn.","howHeard":"Friend/Family"}' "$5" "$6" "${7:-Nairobi}" "$1" "$2" "$3" "$4"
}

echo "Phase 2: upcoming intakes"
expect "no listed intake has already started"    "0" "$(echo "$PROGRAMS" | php -r '$d = json_decode(stream_get_contents(STDIN), true); $n = 0; foreach ($d["programs"] as $p) foreach ($p["upcomingIntakes"] as $i) if ($i["starts"] <= date("Y-m-d")) $n++; echo $n;')"
expect "CS offers January $NEXT_YEAR"            "yes" "$(echo "$PROGRAMS" | php -r '$d = json_decode(stream_get_contents(STDIN), true); foreach ($d["programs"] as $p) if ($p["name"] === "BSc Computer Science") foreach ($p["upcomingIntakes"] as $i) if ($i["year"] == '$NEXT_YEAR' && $i["period"] === "January") echo "yes";')"

echo "Phase 2: submitting applications"
send POST /api/applications "$(app $CS_ID B $NEXT_YEAR January Applicant1@Example.COM $DOB_OK)" "$T"
expect "valid application gives 201"            "201" "$CODE"
REF="$(echo "$JSON" | jget application.reference)"
[[ "$REF" =~ ^MU-[0-9]{4}-[A-HJ-NP-Z2-9]{6}$ ]] && ok "reference looks like MU-YYYY-XXXXXX ($REF)" || bad "reference format" "$REF"
expect "new applications start as pending"      "pending" "$(echo "$JSON" | jget application.status)"
expect "email is stored in lower case"          "applicant1@example.com" "$(dbq "SELECT email FROM applications WHERE reference = '$REF'")"
expect "phone is normalised to +254 form"       "+254712345678" "$(dbq "SELECT phone FROM applications WHERE reference = '$REF'")"
send POST /api/applications "$(app $CS_ID B $NEXT_YEAR January applicant1@example.com $DOB_OK)" "$T"
expect "same email + program + intake gives 409" "409 duplicate" "$CODE $(echo "$JSON" | jget code)"
send POST /api/applications "$(app $CS_ID C $NEXT_YEAR January applicant2@example.com $DOB_OK)" "$T"
expect "KCSE grade below the program minimum gives 422" "422" "$CODE"
expect "  ... error is attached to the grade field"    "yes" "$(echo "$JSON" | jget errors.kcseGrade | grep -q 'requires a KCSE' && echo yes)"
send POST /api/applications "$(app $CS_ID B $THIS_YEAR January applicant2@example.com $DOB_OK)" "$T"
expect "an intake that already started is refused"       "422" "$CODE"
send POST /api/applications "$(app $BBA_ID B $NEXT_YEAR January applicant2@example.com $DOB_OK)" "$T"
expect "an intake the program does not offer is refused" "422" "$CODE"
send POST /api/applications "$(app 99999 B $NEXT_YEAR January applicant2@example.com $DOB_OK)" "$T"
expect "unknown program id gives 422 on programId"       "yes" "$([ "$CODE" = 422 ] && echo "$JSON" | jget errors.programId | grep -q 'choose a program' && echo yes)"
send POST /api/applications "$(app $CS_ID B $NEXT_YEAR January not-an-email $DOB_OK)" "$T"
expect "malformed email gives 422 on email"              "yes" "$([ "$CODE" = 422 ] && [ "$(echo "$JSON" | jget errors.email)" != null ] && echo yes)"
send POST /api/applications "$(app $CS_ID B $NEXT_YEAR January applicant2@example.com $DOB_YOUNG)" "$T"
expect "applicant under 15 gives 422 on dob"             "yes" "$([ "$CODE" = 422 ] && [ "$(echo "$JSON" | jget errors.dob)" != null ] && echo yes)"
send POST /api/applications '{}' "$T"
expect "empty body: several field errors at once"        "yes" "$([ "$CODE" = 422 ] && [ "$(echo "$JSON" | php -r '$d = json_decode(stream_get_contents(STDIN), true); echo count($d["errors"]);')" -ge 8 ] && echo yes)"
J="$(app $CS_ID B $NEXT_YEAR January applicant3@example.com $DOB_OK)"
send POST /api/applications "${J%\}},\"status\":\"approved\",\"id\":999}" "$T"
expect "extra fields (status, id) are accepted but ignored" "201 pending" "$CODE $(dbq "SELECT status FROM applications WHERE email = 'applicant3@example.com'")"
expect "  ... and no row got id 999"                         "0" "$(dbq "SELECT COUNT(*) FROM applications WHERE id = 999")"
send POST /api/applications "$(app $CS_ID B $NEXT_YEAR January applicant4@example.com $DOB_OK "x'); DROP TABLE applications;--")" "$T"
expect "SQL injection in a text field is stored as plain text" "201" "$CODE"
expect "  ... table still exists, text stored literally"        "x'); DROP TABLE applications;--" "$(dbq "SELECT address FROM applications WHERE email = 'applicant4@example.com'")"
send POST /api/applications "$(app $CS_ID B $NEXT_YEAR January applicant5@example.com $DOB_OK)" "wrong-token"
expect "missing/wrong CSRF token gives 403"     "403" "$CODE"
expect "non-JSON content type gives 415"        "415" "$(req -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: text/plain' -H "X-CSRF-Token: $T" -d 'hello' "$BASE/api/applications")"
php -r 'echo json_encode(["x" => str_repeat("a", 70000)]);' > "$TMP/big.json"
expect "oversized body gives 413"               "413" "$(req -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-CSRF-Token: $T" --data-binary @"$TMP/big.json" "$BASE/api/applications")"

echo "Phase 2: tracking an application"
status_of() { req -g -w '\n%{http_code}' "$BASE/api/applications/status?$1"; }
OUT="$(status_of "ref=$REF&email=applicant1@example.com")"; CODE="${OUT##*$'\n'}"; JSON="${OUT%$'\n'*}"
expect "correct reference + email gives 200"    "200 pending" "$CODE $(echo "$JSON" | jget application.status)"
expect "  ... program name is returned"         "BSc Computer Science" "$(echo "$JSON" | jget application.program)"
expect "  ... no phone/address/dob leaked"      "clean" "$(echo "$JSON" | grep -qiE 'phone|address|dob|motivation' && echo LEAK || echo clean)"
OUT="$(status_of "ref=$(echo "$REF" | tr 'A-Z' 'a-z')&email=APPLICANT1@EXAMPLE.COM")"; CODE="${OUT##*$'\n'}"
expect "lower-case ref and UPPER-case email still match" "200" "$CODE"
OUT="$(status_of "ref=$REF&email=someone-else@example.com")"; CODE="${OUT##*$'\n'}"; JSON="${OUT%$'\n'*}"; MSG_A="$(echo "$JSON" | jget message)"
expect "right reference, wrong email gives 404"  "404" "$CODE"
OUT="$(status_of "ref=MU-2026-ZZZZZZ&email=applicant1@example.com")"; CODE="${OUT##*$'\n'}"; JSON="${OUT%$'\n'*}"
expect "wrong reference gives 404 with the SAME message" "$MSG_A" "$(echo "$JSON" | jget message)"
OUT="$(status_of "ref=&email=")"; expect "missing values give 422" "422" "${OUT##*$'\n'}"
OUT="$(status_of "ref[]=a&email=a@b.co")"; expect "array parameter gives 422, not a crash" "422" "${OUT##*$'\n'}"

echo "Phase 2: contact messages (JSON API)"
send POST /api/inquiries '{"name":"Jane Doe","email":"jane@example.com","phone":"","message":"Hello, I have a question about fees.","website":""}' "$T"
expect "valid message gives 201"                 "201" "$CODE"
expect "  ... and is stored"                     "1" "$(dbq "SELECT COUNT(*) FROM inquiries")"
send POST /api/inquiries '{"name":"Bot","email":"bot@example.com","message":"Buy cheap watches now please","website":"http://spam.example"}' "$T"
expect "honeypot: bot is told 'success'"         "201" "$CODE"
expect "  ... but nothing is stored"             "1" "$(dbq "SELECT COUNT(*) FROM inquiries")"
send POST /api/inquiries '{"name":"J","email":"nope","message":"short"}' "$T"
expect "invalid fields give 422 with details"    "yes" "$([ "$CODE" = 422 ] && [ "$(echo "$JSON" | jget errors.message)" != null ] && [ "$(echo "$JSON" | jget errors.email)" != null ] && echo yes)"
send POST /api/inquiries '{"name":"Jane Doe","email":"jane@example.com","message":"A second message from Jane."}' "$T"; S2="$CODE"
send POST /api/inquiries '{"name":"Jane Doe","email":"jane@example.com","message":"A third message from Jane."}' "$T"; S3="$CODE"
send POST /api/inquiries '{"name":"Jane Doe","email":"jane@example.com","message":"A fourth message from Jane."}' "$T"
expect "3 messages per email per hour, the 4th is throttled" "201 201 429" "$S2 $S3 $CODE"

echo "Phase 2: contact messages (classic form, no JavaScript)"
HDRS="$(curl -s -D - -o /dev/null --data-urlencode 'name=Joe Bloggs' --data-urlencode 'email=joe@example.com' --data-urlencode 'phone=' --data-urlencode 'message=Hello there, I need some help please.' --data-urlencode 'website=' "$BASE/submit_inquiry.php" | tr -d '\r')"
expect "form POST redirects (303 See Other)"     "303" "$(echo "$HDRS" | head -1 | awk '{print $2}')"
expect "  ... to contact.html?sent=1"            "/contact.html?sent=1" "$(echo "$HDRS" | grep -i '^location:' | awk '{print $2}')"
expect "  ... and the message is stored"         "1" "$(dbq "SELECT COUNT(*) FROM inquiries WHERE email = 'joe@example.com'")"
BODY="$(curl -s -w '\n%{http_code}' --data-urlencode 'name=<script>alert(1)</script>' --data-urlencode 'email=bad' --data-urlencode 'message=x' "$BASE/submit_inquiry.php")"
expect "invalid form POST gives 422"             "422" "${BODY##*$'\n'}"
case "$BODY" in
  *'&lt;script&gt;alert(1)&lt;/script&gt;'*) ok "echoed name is HTML-escaped in the error page";;
  *) bad "output escaping" "escaped text not found";; esac
case "$BODY" in
  *'<script>alert(1)'*) bad "output escaping" "RAW <script> appears in the page";;
  *) ok "no raw <script> reaches the page";; esac
expect "opening submit_inquiry.php with GET gives 405" "405" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/submit_inquiry.php")"
curl -s -D - -o /dev/null "$BASE/submit_inquiry.php" | grep -qi '^content-security-policy:' && ok "PHP-generated page carries security headers" || bad "headers on submit_inquiry.php" "CSP missing"

echo "Phase 2: staff statistics see the new data"
rm -f "$JAR"; T="$(csrf)"
send POST /api/auth/login "{\"username\":\"admin\",\"password\":\"$MWAKI_ADMIN_PASSWORD\"}" "$T"
expect "stats: pending applications match the database" "$(dbq "SELECT COUNT(*) FROM applications WHERE status = 'pending'")" "$(req "$BASE/api/stats" | jget applications.pending)"
expect "stats: unhandled inquiries match the database"  "$(dbq "SELECT COUNT(*) FROM inquiries WHERE handled = 0")" "$(req "$BASE/api/stats" | jget inquiries.unhandled)"


# =====================================================================================
# PHASE 3: student manager (CRUD), staff review of applications and messages
# =====================================================================================
JAR_ADMIN="$TMP/admin.jar"; JAR_STAFF="$TMP/staff.jar"; JAR_ANON="$TMP/anon.jar"
as_admin() { JAR="$JAR_ADMIN"; }; as_staff() { JAR="$JAR_STAFF"; }; as_anon() { JAR="$JAR_ANON"; }
sign_in() { # jar user password
  JAR="$1"; rm -f "$JAR"; send POST /api/auth/login "{\"username\":\"$2\",\"password\":\"$3\"}" "$(csrf)"
  [ "$CODE" = 200 ] || bad "Phase 3 set-up: sign in as $2" "got $CODE"
}
sign_in "$JAR_ADMIN" admin "$MWAKI_ADMIN_PASSWORD"; sign_in "$JAR_STAFF" staff "$MWAKI_STAFF_PASSWORD"; as_anon; rm -f "$JAR"
stu() { # code first last email phone grade programId address dob [imageUrl]
  local img="null"; [ -n "${10:-}" ] && img="\"${10}\""
  printf '{"studentCode":"%s","firstName":"%s","lastName":"%s","email":"%s","phone":"%s","grade":%s,"programId":%s,"address":"%s","dob":"%s","imageUrl":%s}' "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" "$9" "$img"
}
list() { req -g -G "$BASE/api/students" "$@"; }

echo "Phase 3: who may do what"
as_anon
expect "list students while signed out -> 401"         "401" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/students")"
expect "list applications while signed out -> 401"     "401" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/applications")"
expect "list messages while signed out -> 401"         "401" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/inquiries")"
send POST /api/students "$(stu MU-2026-901 A B a@b.co 0712000000 50 $CS_ID x 2005-01-01)" "$(csrf)"
expect "create student while signed out -> 401 (not 403, not 422)" "401" "$CODE"
send PATCH /api/applications/1 '{"status":"approved"}' "$(csrf)"
expect "review an application while signed out -> 401" "401" "$CODE"
expect "read ONE student while signed out -> 401"       "401" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/students/1")"
send PUT /api/students/1 '{}' "$(csrf)"
expect "update a student while signed out -> 401"       "401" "$CODE"
send DELETE /api/students/1 '' "$(csrf)"
expect "delete a student while signed out -> 401"       "401" "$CODE"
send PATCH /api/inquiries/1 '{"handled":true}' "$(csrf)"
expect "mark a message handled while signed out -> 401" "401" "$CODE"

echo "Phase 3: listing, searching, sorting, paging"
as_admin
expect "default page: 5 of 10 students"             "5/10" "$(list | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo count($d["students"])."/".$d["meta"]["total"];')"
expect "  ... 2 pages, perPage 5"                    "2/5" "$(list | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo $d["meta"]["pages"]."/".$d["meta"]["perPage"];')"
expect "  ... sorted by first name: David first"     "David" "$(list | jget students.0.firstName)"
expect "page 2 starts with John"                     "John" "$(list -d page=2 | jget students.0.firstName)"
expect "page 99 is clamped to the last page (2)"     "2" "$(list -d page=99 | jget meta.page)"
expect "perPage=3, page 4 holds the last student"    "1" "$(list -d perPage=3 -d page=4 | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo count($d["students"]);')"
expect "sort=gradeDesc: Faith (95) first"            "Faith" "$(list -d sort=gradeDesc | jget students.0.firstName)"
expect "sort=age: youngest (Faith, b. 2006) first"   "Faith" "$(list -d sort=age | jget students.0.firstName)"
expect "sort=ageDesc: oldest (James, b. 2001) first" "James" "$(list -d sort=ageDesc | jget students.0.firstName)"
expect "header stats: total of ALL students"         "10" "$(list -d q=grace | jget stats.total)"
expect "header stats: average grade (82.3)"          "82.3" "$(list | jget stats.averageGrade)"
expect "search 'grace' finds 1"                      "1" "$(list -d q=grace | jget meta.total)"
expect "search is case-insensitive ('GRACE')"        "1" "$(list -d q=GRACE | jget meta.total)"
expect "search by FULL name 'Grace Wanjiku'"         "1" "$(list --data-urlencode 'q=Grace Wanjiku' | jget meta.total)"
expect "search by student ID 'mu-2024-007'"          "James" "$(list -d q=mu-2024-007 | jget students.0.firstName)"
expect "search by email part 'ochieng'"              "John" "$(list -d q=ochieng | jget students.0.firstName)"
expect "a lone % does NOT match everything"          "0" "$(list --data-urlencode 'q=%' | jget meta.total)"
expect "a lone _ does NOT match everything"          "0" "$(list --data-urlencode 'q=_' | jget meta.total)"
expect "SQL injection in the search box matches nothing" "0" "$(list --data-urlencode "q=' OR 1=1 --" | jget meta.total)"
expect "bad sort value (SQL text) is refused: 422"   "422" "$(list --data-urlencode 'sort=name;DROP TABLE students' -o /dev/null -w '%{http_code}')"
expect "perPage=100 is refused: 422"                 "422" "$(list -d perPage=100 -o /dev/null -w '%{http_code}')"
expect "page=0 is refused: 422"                      "422" "$(list -d page=0 -o /dev/null -w '%{http_code}')"
expect "perPage=abc is refused: 422"                 "422" "$(list -d perPage=abc -o /dev/null -w '%{http_code}')"
as_staff
expect "staff may list students too"                 "200" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/students")"

echo "Phase 3: creating students"
AGE_EXPECTED="$(php -r 'echo (new DateTime("2005-03-04"))->diff(new DateTime("today"))->y;')"
as_admin; T="$(csrf)"
send POST /api/students "$(stu MU-2026-011 Test Student test.student@example.com '0722 000 111' 71.5 $CS_ID Nairobi 2005-03-04)" "$T"
expect "valid student -> 201"                        "201" "$CODE"
NEW_ID="$(echo "$JSON" | jget student.id)"
expect "  ... phone normalised to +254"              "+254722000111" "$(echo "$JSON" | jget student.phone)"
expect "  ... age calculated from date of birth"     "$AGE_EXPECTED" "$(echo "$JSON" | jget student.age)"
expect "  ... program name joined in"                "BSc Computer Science" "$(echo "$JSON" | jget student.program)"
expect "  ... grade kept as 71.5"                    "71.5" "$(echo "$JSON" | jget student.grade)"
send POST /api/students "$(stu mu-2026-012 Low Case low.case@example.com 0711111111 60 $CS_ID Nairobi 2004-01-01)" "$T"
expect "lower-case student ID accepted and stored upper-case" "MU-2026-012" "$(echo "$JSON" | jget student.studentCode)"
send POST /api/students "$(stu MU-2026-013 Dup Email TEST.STUDENT@example.com 0711111112 60 $CS_ID Nairobi 2004-01-01)" "$T"
expect "duplicate email (any case) -> 409 on the email field" "409 duplicate" "$CODE $(echo "$JSON" | jget code)"
expect "  ... error names the email field"           "yes" "$([ "$(echo "$JSON" | jget errors.email)" != null ] && echo yes)"
send POST /api/students "$(stu MU-2026-011 Dup Code dup.code@example.com 0711111113 60 $CS_ID Nairobi 2004-01-01)" "$T"
expect "duplicate student ID -> 409 on studentCode"  "409" "$CODE"
expect "  ... error names the studentCode field"     "yes" "$([ "$(echo "$JSON" | jget errors.studentCode)" != null ] && echo yes)"
send POST /api/students "$(stu XX-1 Bad Code bad.code@example.com 0711111114 60 $CS_ID Nairobi 2004-01-01)" "$T"
expect "malformed student ID -> 422"                 "422" "$CODE"
send POST /api/students "$(stu MU-2026-014 Too High too.high@example.com 0711111115 150 $CS_ID Nairobi 2004-01-01)" "$T"
expect "grade 150 -> 422 on grade"                   "yes" "$([ "$CODE" = 422 ] && [ "$(echo "$JSON" | jget errors.grade)" != null ] && echo yes)"
send POST /api/students "$(stu MU-2026-014 Neg Grade neg@example.com 0711111115 -1 $CS_ID Nairobi 2004-01-01)" "$T"
expect "grade -1 -> 422"                             "422" "$CODE"
send POST /api/students "$(stu MU-2026-014 Not Number nan@example.com 0711111115 '"abc"' $CS_ID Nairobi 2004-01-01)" "$T"
expect "grade 'abc' -> 422"                          "422" "$CODE"
send POST /api/students "$(stu MU-2026-014 No Course nocourse@example.com 0711111115 60 99999 Nairobi 2004-01-01)" "$T"
expect "unknown course -> 422 on programId"          "yes" "$([ "$CODE" = 422 ] && [ "$(echo "$JSON" | jget errors.programId)" != null ] && echo yes)"
send POST /api/students "$(stu MU-2026-014 Too Young young@example.com 0711111115 60 $CS_ID Nairobi $DOB_YOUNG)" "$T"
expect "student under 15 -> 422 on dob"              "yes" "$([ "$CODE" = 422 ] && [ "$(echo "$JSON" | jget errors.dob)" != null ] && echo yes)"
send POST /api/students "$(stu MU-2026-014 Js Image js@example.com 0711111115 60 $CS_ID Nairobi 2004-01-01 'javascript:alert(1)')" "$T"
expect "image address javascript:... -> 422"         "422" "$CODE"
send POST /api/students "$(stu MU-2026-014 Http Image http@example.com 0711111115 60 $CS_ID Nairobi 2004-01-01 'http://example.com/a.png')" "$T"
expect "image address over plain http -> 422 (https only)" "422" "$CODE"
send POST /api/students "$(stu MU-2026-014 Https Image https@example.com 0711111115 60 $CS_ID Nairobi 2004-01-01 'https://example.com/a.png')" "$T"
expect "https image address accepted"                "201" "$CODE"
J="$(stu MU-2026-015 Mass Assign mass@example.com 0711111116 60 $CS_ID Nairobi 2004-01-01)"
send POST /api/students "${J%\}},\"id\":1,\"createdAt\":\"2000-01-01T00:00:00Z\"}" "$T"
expect "client cannot choose id or createdAt (mass assignment)" "201 no" "$CODE $([ "$(echo "$JSON" | jget student.id)" = 1 ] || echo "$JSON" | jget student.createdAt | grep -q '^2000' && echo YES || echo no)"
send POST /api/students "$(stu MU-2026-016 '<script>alert(1)</script>' Markup markup@example.com 0711111117 60 $CS_ID Nairobi 2004-01-01)" "$T"
expect "HTML in a name is stored as plain text, unchanged (escaping happens on OUTPUT)" "<script>alert(1)</script>" "$(echo "$JSON" | jget student.firstName)"
send POST /api/students "$(stu MU-2026-017 No Token notoken@example.com 0711111118 60 $CS_ID Nairobi 2004-01-01)" "wrong-token"
expect "create without a valid CSRF token -> 403"    "403" "$CODE"
as_staff
send POST /api/students "$(stu MU-2026-018 By Staff bystaff@example.com 0711111119 60 $CS_ID Nairobi 2004-01-01)" "$(csrf)"
expect "staff may create students"                   "201" "$CODE"

echo "Phase 3: reading, updating, deleting"
as_admin; T="$(csrf)"
expect "GET one student -> 200"                      "MU-2026-011" "$(req "$BASE/api/students/$NEW_ID" | jget student.studentCode)"
expect "GET unknown id -> 404"                       "404" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/students/99999")"
expect "GET /api/students/abc -> 404 (route needs digits)" "404" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/students/abc")"
send PUT "/api/students/$NEW_ID" "$(stu MU-2026-011 Test Student test.student@example.com '0722 000 111' 80 $CS_ID 'New Address' 2005-03-04)" "$T"
expect "PUT updates the student -> 200"              "200 80 New Address" "$CODE $(echo "$JSON" | jget student.grade) $(echo "$JSON" | jget student.address)"
send PUT "/api/students/$NEW_ID" "$(stu MU-2026-011 Test Student john.ochieng@mwaki.ac.ke '0722 000 111' 80 $CS_ID Nairobi 2005-03-04)" "$T"
expect "PUT with another student's email -> 409"     "409" "$CODE"
expect "  ... and nothing was changed by the failed PUT" "New Address" "$(req "$BASE/api/students/$NEW_ID" | jget student.address)"
send PUT "/api/students/$NEW_ID" '{"grade":99}' "$T"
expect "PUT with a partial body -> 422 (PUT replaces everything)" "422" "$CODE"
send PUT "/api/students/99999" "$(stu MU-2026-099 No One noone@example.com 0711111120 60 $CS_ID Nairobi 2004-01-01)" "$T"
expect "PUT on an unknown id -> 404"                 "404" "$CODE"
BEFORE_COUNT="$(dbq "SELECT COUNT(*) FROM students")"
as_staff; send DELETE "/api/students/$NEW_ID" '' "$(csrf)"
expect "staff trying to DELETE -> 403 forbidden"     "403 forbidden" "$CODE $(echo "$JSON" | jget code)"
expect "  ... the student is still there"            "$BEFORE_COUNT" "$(dbq "SELECT COUNT(*) FROM students")"
as_admin; send DELETE "/api/students/$NEW_ID" '' "wrong-token"
expect "DELETE without a valid CSRF token -> 403"    "403" "$CODE"
send DELETE "/api/students/$NEW_ID" '' "$(csrf)"
expect "admin DELETE -> 204 and an empty body"       "204 EMPTY" "$CODE $([ -z "$JSON" ] && echo EMPTY || echo NOT-EMPTY)"
expect "  ... one fewer student"                     "$((BEFORE_COUNT - 1))" "$(dbq "SELECT COUNT(*) FROM students")"
expect "  ... fetching it now gives 404"             "404" "$(req -o /dev/null -w '%{http_code}' "$BASE/api/students/$NEW_ID")"
send DELETE "/api/students/$NEW_ID" '' "$(csrf)"
expect "deleting it AGAIN gives 404"                 "404" "$CODE"
expect "stats endpoint matches the database"         "$(dbq "SELECT COUNT(*) FROM students")" "$(req "$BASE/api/stats" | jget students.total)"

echo "Phase 3: staff review of applications"
APP_ID="$(dbq "SELECT id FROM applications WHERE reference = '$REF'")"
as_staff
expect "list applications -> 200, counts match the database" "$(dbq "SELECT COUNT(*) FROM applications WHERE status = 'pending'")" "$(req "$BASE/api/applications" | jget counts.pending)"
expect "  ... staff see the full details (phone)"     "+254712345678" "$(req -g "$BASE/api/applications?q=$REF" | jget applications.0.phone)"
expect "filter status=approved -> none yet"           "0" "$(req -g "$BASE/api/applications?status=approved" | jget meta.total)"
expect "search by applicant email part"               "1" "$(req -g "$BASE/api/applications?q=applicant4" | jget meta.total)"
expect "a lone % in the search matches nothing"       "0" "$(req -g "$BASE/api/applications?q=%25" | jget meta.total)"
expect "bad status filter -> 422"                     "422" "$(req -g -o /dev/null -w '%{http_code}' "$BASE/api/applications?status=banana")"
send PATCH "/api/applications/$APP_ID" '{"status":"approved"}' "$(csrf)"
expect "PATCH status=approved -> 200"                 "200 approved" "$CODE $(echo "$JSON" | jget application.status)"
expect "  ... stored in the database"                 "approved" "$(dbq "SELECT status FROM applications WHERE id = $APP_ID")"
as_anon
expect "  ... and the applicant's tracking page now says approved" "approved" "$(req -g "$BASE/api/applications/status?ref=$REF&email=applicant1@example.com" | jget application.status)"
as_staff
expect "filter status=approved now finds it"          "1" "$(req -g "$BASE/api/applications?status=approved" | jget meta.total)"
send PATCH "/api/applications/$APP_ID" '{"status":"banana"}' "$(csrf)"
expect "PATCH with an invalid status -> 422"          "422" "$CODE"
send PATCH "/api/applications/99999" '{"status":"approved"}' "$(csrf)"
expect "PATCH on an unknown application -> 404"       "404" "$CODE"
send PATCH "/api/applications/$APP_ID" '{"status":"approved"}' "wrong-token"
expect "PATCH without a valid CSRF token -> 403"      "403" "$CODE"
send PATCH "/api/applications/$APP_ID" '{"status":"rejected"}' "$(csrf)"
as_anon; send POST /api/applications "$(app $CS_ID B $NEXT_YEAR January applicant1@example.com $DOB_OK)" "$(csrf)"
expect "after a REJECTION the same person may apply again (Phase 2 rule)" "201" "$CODE"

echo "Phase 3: staff handling of contact messages"
as_staff
INQ_ID="$(dbq "SELECT id FROM inquiries ORDER BY id LIMIT 1")"
expect "list messages: 'new' count matches the database" "$(dbq "SELECT COUNT(*) FROM inquiries WHERE handled = 0")" "$(req "$BASE/api/inquiries" | jget counts.new)"
expect "  ... message text is included"               "yes" "$(req "$BASE/api/inquiries" | grep -q 'question about fees' && echo yes)"
expect "bad handled filter -> 422"                    "422" "$(req -g -o /dev/null -w '%{http_code}' "$BASE/api/inquiries?handled=2")"
NEW_BEFORE="$(req -g "$BASE/api/inquiries?handled=0" | jget meta.total)"
send PATCH "/api/inquiries/$INQ_ID" '{"handled":true}' "$(csrf)"
expect "PATCH handled=true -> 200"                    "200" "$CODE"
expect "  ... stored as 1"                            "1" "$(dbq "SELECT handled FROM inquiries WHERE id = $INQ_ID")"
expect "  ... fewer messages are 'new' now"           "$((NEW_BEFORE - 1))" "$(req -g "$BASE/api/inquiries?handled=0" | jget meta.total)"
send PATCH "/api/inquiries/$INQ_ID" '{"handled":false}' "$(csrf)"
expect "handled=false puts it back (a real boolean)"  "0" "$(dbq "SELECT handled FROM inquiries WHERE id = $INQ_ID")"
send PATCH "/api/inquiries/$INQ_ID" '{"handled":"maybe"}' "$(csrf)"
expect "handled='maybe' -> 422"                       "422" "$CODE"
send PATCH "/api/inquiries/99999" '{"handled":true}' "$(csrf)"
expect "unknown message -> 404"                       "404" "$CODE"

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
