# Mwaki University web app - Phase 2

Your static site, extended with a PHP back end and a JavaScript front end.

* **Phase 1** (delivered): server foundation, SQLite database, sign-in (sessions + CSRF), programs catalogue,
  responsive navigation, Login / Account / Tuition pages.
* **Phase 2** (this delivery): **Admission** form, **application tracking**, and the **Contact** form
  (with and without JavaScript).
* **Phase 3** (next): Student manager (full CRUD) and the staff Admin page.

## 1. Requirements

* **PHP 8.1 or newer** with the `pdo_sqlite` and `mbstring` extensions.
  Check: `php -v` and `php -m` (look for `pdo_sqlite` and `mbstring`).
  * XAMPP on Windows: in `php.ini` make sure `extension=pdo_sqlite`, `extension=sqlite3` and
    `extension=mbstring` have no leading `;`. Use the full path, e.g. `C:\xampp\php\php.exe`.
* No Composer, no Node, no database server. SQLite is a single file.

## 2. Setup and run

```bash
# 1. Put your own media next to the pages (they were not part of the upload):
#       public/multimedia/   (mwaki_logo.png, college.mp4, tuition_block.jpg, exam_prep.mp3, ...)
#       public/fee-structure.pdf

# 2. Create the database and the two staff accounts. Passwords are printed ONCE - copy them.
#    (Already did this in Phase 1? You do NOT need to repeat it: the database is kept and this
#     delivery changes no tables. Running it again is harmless.)
php database/seed.php

# 3. Start the development server. -t public makes /public the web root.
php -S localhost:8000 -t public router.php
```

Open <http://localhost:8000>. Stop the server with Ctrl+C.

**Upgrading from Phase 1:** replace your project files with this delivery's, keep your `storage/mwaki.sqlite`
and your `public/multimedia/` folder. No database change is needed.

## 3. Folder map

```
router.php              dev-server helper (routes /api/*, serves .html with security headers)
config/config.php       every setting in one place
src/                    PHP classes (private: NOT inside the web root)
  Intakes.php             which intakes are still open (calculated from today's date)       [Phase 2]
  InquiryService.php      contact-message rules shared by the JSON API and the classic form [Phase 2]
  Controllers/            AuthController, ProgramController, StatsController,
                          ApplicationController, InquiryController                          [last two: Phase 2]
database/               schema.sql, seed.php, students.json (seed data)
storage/                mwaki.sqlite appears here (private)
tests/api-smoke.sh      90 automated checks for the back end
public/                 the web root: everything the browser may request
  api/index.php         front controller for /api/*
  submit_inquiry.php    the "classic" form handler for contact.html                       [Phase 2]
  js/                   api.js (fetch wrapper), ui.js (helpers), nav.js (menu + login link)
  admission.html/.js    application form, receipt/PDF, tracking                          [Phase 2]
  contact.html/.js      contact form                                                      [Phase 2]
  login / details / tuition .html + .js           (Phase 1)
  e_students/           the student manager (unchanged until Phase 3)
```

## 4. What Phase 2 changed

New files: `src/Intakes.php`, `src/InquiryService.php`, `src/Controllers/ApplicationController.php`,
`src/Controllers/InquiryController.php`, `public/submit_inquiry.php`, `public/contact.js`.

Rewritten: `public/admission.html` and `public/admission.js` (the JS file was empty in your upload),
and the form part of `public/contact.html`.

Edited Phase 1 files (please replace yours):

| File | Change |
|---|---|
| `config/config.php` | added `intake_months` (when each intake starts) |
| `src/Controllers/ProgramController.php` | each program now carries `upcomingIntakes`; the old top-level `intakeYears` list was removed because it could list years with nothing left to apply for |
| `public/api/index.php` | three new routes |
| `public/style.css` | a "PHASE 2 ADDITIONS" block appended; nothing above it edited |
| `tests/api-smoke.sh` | 47 new checks |

Changes to the forms you had:

* Admission: the program list, intake years and periods now come from the server, so the page can no longer offer
  intakes that already started. Field `name` attributes became the API's names (`fullName`, `programId`,
  `intakeYear`, `motivation`); the `id`s (used by the labels) are unchanged. The two PDF buttons became one.
  The KCSE grade options and their labels are exactly as you had them.
* Contact: gained a hidden spam-trap field, per-field error messages and a character counter.
  `action="submit_inquiry.php" method="post"` is kept, so it works with JavaScript switched off.

## 5. The rules the server enforces on an application

Browser checks are a convenience; these are the real rules (`ApplicationController.php`):

1. Every field is well-formed (email, Kenyan phone number, real calendar date, lengths ...).
2. The program must exist; the KCSE grade must be **at least the program's minimum** (C+ for all programs today).
3. The intake must be one the program offers **and must not have started** (an intake is open until its first day).
4. The applicant must be **at least 15 years old**. (My assumption, to catch typos such as a 2025 birth year. Change `MIN_AGE`.)
5. The same email may not apply to the same program + intake twice, unless the earlier application was rejected (HTTP 409).
6. The applicant cannot choose their own status; new applications are always `pending`.

## 6. Where data lives, and how to look at it

`storage/mwaki.sqlite`. Open it with <https://sqlitebrowser.org/> or:

```bash
sqlite3 storage/mwaki.sqlite "SELECT reference, full_name, status, intake_period, intake_year FROM applications;"
sqlite3 storage/mwaki.sqlite "SELECT name, email, handled, created_at FROM inquiries;"
```

(Phase 3 adds an admin page for this.) To start over: stop the server, delete the file, run `php database/seed.php`.

## 7. Testing

Automated (Mac, Linux, WSL, or Git Bash). It uses a throw-away database and port 8765:

```bash
bash tests/api-smoke.sh        # expect: Result: 90 passed, 0 failed
```

Manual checklist, Phase 2 (server running):

**Admission**
1. Open `admission.html`. The program drop-down lists 7 programs grouped by faculty.
2. Choose *BSc Computer Science*: "Select Intake Year" offers only future years; choosing a year offers only that
   year's remaining periods. Choose *BSc Nursing* instead: March and September appear (not January).
3. Choose *BSc Computer Science* and KCSE grade *C*: a yellow warning appears. Pick *B*: it disappears.
4. Leave a required box empty and submit: the browser points at it. Submit with grade *C* anyway: the **server's**
   message appears under the grade field.
5. Fill everything correctly and submit: a green banner, a receipt with a reference like `MU-2027-K7F3QA`, and the form is hidden.
6. Click "Download your application (PDF)": a PDF named after your reference (or, if it cannot be made, the browser's
   print window opens: choose "Save as PDF").
7. Click "Start another application", enter the same email, program and intake: you are told you already applied.
8. Under "Track your application" enter the reference and email: you see "Under review". Change one letter of the
   email: you get the same "could not find" message as for a wrong reference.

**Contact**
9. Open `contact.html`, type in the message box: the counter changes. Submit it empty-ish ("hi"): messages appear beside the fields.
10. Send a real message: the thank-you appears without a page reload. Send 4 within an hour using the same email: the 4th is refused.
11. **No-JavaScript path:** in your browser's developer tools turn JavaScript off (or use `curl`), submit the form:
    you are redirected to `contact.html?sent=1` and see the thank-you. Press Refresh: nothing is sent twice.
12. Check the database (section 6): your messages are there; a message sent with the hidden "website" field filled is not.

**Staff statistics:** sign in (Phase 1) and open `details.html`: "Applications pending" and "New inquiries" now count what you submitted.

## 8. Known limits (so nothing is a surprise)

* **PDF download** uses the third-party html2pdf library from a CDN. It was tested here with a stand-in, not in a
  real browser. If it is blocked or fails, the page falls back to the print dialog. The CDN `<script>` has no integrity
  (SRI) hash because it could not be fetched here to compute one.
* **Duplicate applications** are prevented by a check inside a transaction, not by a database rule. Two submissions in
  the same instant could, rarely, both succeed. The bullet-proof fix is a UNIQUE index, which changes the schema, so it
  is **not** applied without your say-so.
* **Contact throttle** limits per email (3/hour) and in total (60/hour) because the table has no IP column. Someone
  using many different emails could use up the total. An `ip` column would fix that (also a schema change).
* **No emails are sent.** Applicants see their reference on screen and in the PDF; staff review comes in Phase 3.
* **Reference lookups** are not rate-limited; guessing needs a valid reference AND the matching email.
* The KCSE option labels ("A (80+ points)" ...) are kept as you wrote them, although real KCSE mean grades are
  worked out from points out of 12. That is a content question for you, not a code one.

## 9. Troubleshooting

* `could not find driver` - the `pdo_sqlite` extension is not enabled (see Requirements).
* `Address already in use` - use another port: `php -S localhost:8080 -t public router.php`.
* Program list on the admission page says it could not load - is the server running? Open `/api/programs` directly.
* "No intakes are currently open" - every intake for that program has already started; the list is calculated from today's date.
* Developer error details: `MWAKI_DEBUG=1 php -S localhost:8000 -t public router.php` (never on a real server).
