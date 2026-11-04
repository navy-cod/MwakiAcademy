# Mwaki University web app

Your static university site, extended into a full web app: PHP back end, SQLite database, JavaScript front end,
built as a **learning artifact**. Read `docs/CONCEPTS.md` for a guided tour of every idea in the code; the code
itself explains each concept in comments where it first appears.

| What | Where |
|---|---|
| Public site, responsive navigation | `home.html`, `about.html`, `history.html`, `faculties.html` |
| Programs and tuition from the database | `tuition.html`, `GET /api/programs` |
| Online admission, PDF receipt, application tracking | `admission.html` |
| Contact form (works with and without JavaScript) | `contact.html`, `submit_inquiry.php` |
| Staff sign-in, account page and statistics | `login.html`, `details.html` |
| Student manager (search, sort, pages, add, edit, delete) | `e_students/students.html` |
| Staff admin: review applications, handle messages | `admin.html` |

## 1. Requirements

* **PHP 8.1 or newer** with `pdo_sqlite` and `mbstring`. Check: `php -v` and `php -m`.
  * XAMPP on Windows: in `php.ini` remove the `;` before `extension=pdo_sqlite`, `extension=sqlite3`, `extension=mbstring`.
    Use the full path to PHP, e.g. `C:\xampp\php\php.exe`.
* No Composer, no database server. (Node is needed **only** for the optional browser tests.)

## 2. Setup and run

```bash
# 1. Copy your own media next to the pages (they were not part of the upload):
#       public/multimedia/        public/fee-structure.pdf

# 2. Create the database and two staff accounts. Passwords are printed ONCE - copy them.
php database/seed.php

# 3. Start the development server (-t public makes /public the web root)
php -S localhost:8000 -t public router.php
```

Open <http://localhost:8000>. Sign in at `/login.html` as `admin` or `staff` with the printed passwords.
Upgrading from Phase 2? Replace the files, keep `storage/mwaki.sqlite` and `public/multimedia/`. **No database change.**

## 3. Who can do what

| | Visitor | Staff | Admin |
|---|:-:|:-:|:-:|
| Browse the site, see programs and tuition | yes | yes | yes |
| Apply for admission, track an application, send a message | yes | yes | yes |
| View the Account page and statistics | | yes | yes |
| List / search / add / edit students | | yes | yes |
| Review applications, handle messages | | yes | yes |
| **Delete a student** | | | **yes** |

These rules are enforced by the **server** on every request. Hiding a button is only a courtesy.
There is no in-app user management: the two accounts come from `database/seed.php` (see Known limits).

## 4. API reference

All bodies are JSON. Every request that changes data (POST/PUT/PATCH/DELETE) needs the `X-CSRF-Token` header (get it from `GET /api/session`; `public/js/api.js` does this for you).

| Method and URL | Who | What it does |
|---|---|---|
| `GET /api/session` | anyone | the signed-in user (or null) and the CSRF token |
| `POST /api/auth/login`, `POST /api/auth/logout` | anyone | sign in / out (5 failed tries per 15 min are throttled) |
| `GET /api/programs` | anyone | programs with fees, minimum KCSE grade and **upcoming** intakes |
| `GET /api/stats` | staff | counts and averages for the Account page |
| `POST /api/applications` | anyone | submit an application (201 + reference number) |
| `GET /api/applications/status?ref=&email=` | anyone with both | status of one application |
| `GET /api/applications?status=&q=&page=&perPage=` | staff | review list with counts |
| `PATCH /api/applications/{id}` | staff | `{"status": "pending" \| "approved" \| "rejected"}` |
| `POST /api/inquiries` | anyone | send a contact message |
| `GET /api/inquiries?handled=0\|1&page=&perPage=` | staff | messages with counts |
| `PATCH /api/inquiries/{id}` | staff | `{"handled": true \| false}` |
| `GET /api/students?q=&sort=&page=&perPage=` | staff | one page of students + header statistics |
| `POST /api/students` | staff | create (201) |
| `GET /api/students/{id}`, `PUT /api/students/{id}` | staff | read one / replace one |
| `DELETE /api/students/{id}` | **admin only** | delete (204) |
| `POST /submit_inquiry.php` | anyone | the no-JavaScript contact form (answers with a 303 redirect) |

`sort` is one of `name`, `nameDesc`, `grade`, `gradeDesc`, `age`, `ageDesc`. Errors look like
`{"message": "...", "code": "duplicate", "errors": {"email": "..."}}`.

## 5. Folder map

```
router.php              dev-server helper (routes /api/*, serves .html with security headers)
config/config.php      every setting in one place
src/                   PHP classes (private: NOT inside the web root)
  bootstrap.php, Http.php, HttpException.php, Router.php, Database.php, Validator.php, Auth.php
  Intakes.php, InquiryService.php
  Controllers/         Auth, Program, Stats, Application, Inquiry, Student, Admin
database/              schema.sql, seed.php, students.json (seed data; no longer public)
storage/               mwaki.sqlite appears here (private)
docs/CONCEPTS.md       guided tour of the ideas in the code
tests/api-smoke.sh     188 automated back-end checks (needs only bash, curl, php)
tests/browser/         OPTIONAL 180 front-end behaviour checks (needs Node)
public/                the web root: everything the browser may request
  api/index.php        front controller for /api/*
  submit_inquiry.php   no-JavaScript contact form handler
  js/                  api.js (fetch wrapper), ui.js (safe DOM helpers), nav.js (menu, login link)
  *.html, *.js         one script per page (login.js, details.js, tuition.js, admission.js, contact.js, admin.js)
  style.css            site styles (each phase appended a block; originals untouched)
  e_students/          students.html / .js / .css : the student manager
```

## 6. Everything that changed from your original upload

* **Moved:** every page, `style.css` and `admission.js` into `public/`; the student files into `public/e_students/`.
  `students.json` is now only `database/students.json` (the seed); the public copy was **deleted** because a browser
  no longer needs it and it exposed personal data.
* **`login.html`:** posts through the API (no password in the URL); the "Skin Complexion" box and the unused email box were
  removed; "Remember my username" (localStorage) added. **`details.html`:** now "My Account". **`tuition.html`:** repaired
  `<head>`, table filled from the database. **Every page:** shared header + menu button, skip link, no inline handlers.
* **`admission.html` / `admission.js`:** rebuilt on the API (the JS file was empty). **`contact.html`:** form upgraded; `submit_inquiry.php` written.
* **`e_students/students.html` / `.js`:** rewritten on the API. Your look (`students.css`) is kept; a block was appended.
  The data now **persists**, requires sign-in, searches/sorts/pages on the server, and no longer uses `innerHTML` or inline handlers.
* **Left untouched on purpose:** the 2010 vs 1978 founding-year contradiction between `about.html` and `history.html`, the marquee
  text, the dated news items, the demo table on the login page, `faculties.html` copy, and the KCSE option labels. Those are content decisions for you.

## 7. Where data lives

`storage/mwaki.sqlite`. Inspect with <https://sqlitebrowser.org/> or:

```bash
sqlite3 storage/mwaki.sqlite "SELECT reference, full_name, status FROM applications;"
sqlite3 storage/mwaki.sqlite ".tables"
```

Tables: `users`, `programs`, `students`, `applications`, `inquiries`, `login_attempts` (see `database/schema.sql`).
To start over: stop the server, delete that file, run `php database/seed.php`.

## 8. Testing

```bash
bash tests/api-smoke.sh              # back end: expect "Result: 188 passed, 0 failed"
bash tests/browser/run.sh            # OPTIONAL front end (Node 18+): expect "All browser suites passed."
```

Both use throw-away databases and never touch `storage/`. The automated tests do **not** check how pages *look*,
the PDF in a real browser, or Windows/XAMPP: use the manual checklist for those.

### Manual verification checklist (all features)

Server running. Tick each box.

**1. Responsive shell**
- [ ] `http://localhost:8000/` redirects to `home.html`; styles load; narrow the window below 768 px: a menu button appears, opens/closes the menu, Esc closes it.
- [ ] `about.html`, `faculties.html`: content is centred, no empty strip on the left.

**2. Programs and tuition**
- [ ] `tuition.html` lists 7 programs; BSc Information Technology and BSc Mathematics say the fee is to be confirmed.
- [ ] DevTools > Network > right-click the `programs` request > *Block request URL*, reload: the saved rows stay and a notice says live data could not be loaded.

**3. Sign-in, account, roles**
- [ ] `details.html` while signed out sends you to `login.html?next=details.html`.
- [ ] Wrong password: red message, box empties. Five wrong tries: "wait about 15 minutes".
- [ ] Sign in as `admin`: Account page shows role, member-since date, four statistics, a program table; the menu now shows **Account** and **Logout**.
- [ ] DevTools > Network: login is `POST /api/auth/login`, the password is in the body (never the URL), the cookie has `HttpOnly` and `SameSite=Lax`.
- [ ] "Remember my username", sign out, return: the username is filled in. Logout makes `details.html` protected again.

**4. Admission**
- [ ] Choose *BSc Computer Science*: only future years/periods appear; *BSc Nursing* offers March and September.
- [ ] Grade *C* for Computer Science shows a yellow warning; submit anyway and the **server's** message appears under the grade.
- [ ] A correct application shows a green banner and a reference like `MU-2027-K7F3QA`; the PDF button gives a PDF (or opens print: choose "Save as PDF").
- [ ] "Start another application" with the same email/program/intake: told you already applied.

**5. Tracking**
- [ ] Reference + email shows "Under review". A wrong email gives the same "could not find" message as a wrong reference.

**6. Contact**
- [ ] The character counter changes; "hi" shows errors beside fields; a valid message shows a thank-you with no reload; the 4th in an hour with one email is refused.
- [ ] With JavaScript off (DevTools > Settings > Disable JavaScript) the form still works and redirects to `contact.html?sent=1`; Refresh does not resend.

**7. Student manager** (`e_students/students.html`)
- [ ] Signed out: sent to login. Signed in: 5 students per page, "Page 1 of 2", Next/Prev work.
- [ ] Type in the search box: results update after a short pause; typing `%` finds nobody; sorting changes the order.
- [ ] **Add** a student with an existing email: the message appears under the email field; with valid data the student is added and shown on the right.
- [ ] **Edit** it, change the grade; refresh the browser: the change is still there (it is stored).
- [ ] As `staff`: no Delete buttons. As `admin`: Delete asks for confirmation, then removes the student.

**8. Admin page** (`admin.html`)
- [ ] After submitting a few applications and messages: the tabs show counts; Approve/Reject change a row's status and the totals.
- [ ] The applicant's tracking page now shows the new status. Messages can be marked handled and moved between the *New* and *Handled* lists. Arrow keys move between the two tabs.

**9. Security spot checks**
- [ ] Visit `/src/bootstrap.php`, `/config/config.php`, `/database/students.json`, `/storage/mwaki.sqlite`: all 404.
- [ ] Add a student whose first name is `<b>Bold</b>`: it appears as literal text, not bold.

## 9. Known limits

* **PDF download** uses the third-party html2pdf library from a CDN, tested only with a stand-in; if it fails the print dialog opens.
  The CDN scripts and stylesheets have no integrity (SRI) hashes (they could not be fetched here to compute them).
* **Duplicate applications** are blocked by a check inside a transaction, not by a database rule; two submissions in the same
  instant could both succeed. A UNIQUE index would fix it (a schema change, not applied without your approval).
* **Contact throttle** is per email and in total (no IP column). A `ip` column would improve it (also a schema change).
* **No user management or password change** in the app: accounts exist only from the seed script. If a password is lost, delete
  `storage/mwaki.sqlite` and re-seed (this erases all data), or change the hash by hand in the `users` table.
* **Lost updates:** if two staff edit the same student at once, the last save wins (no version check).
* **Audit trail** is a line in the server log, not a table. **No emails** are sent anywhere.
* **Approving an application does not create a student.** **Reference lookups** are not rate-limited.
* `public/multimedia/` and `fee-structure.pdf` are yours to supply. Apache/Nginx/XAMPP configuration is not included
  (the project targets `php -S`); on Windows/XAMPP nothing here was tested.

## 10. Troubleshooting

* `could not find driver`: enable the `pdo_sqlite` extension (Requirements).
* `Address already in use`: `php -S localhost:8080 -t public router.php`.
* Student manager or admin page sends you to the login page: you are signed out or the session expired (30 minutes idle).
* Developer error details: `MWAKI_DEBUG=1 php -S localhost:8000 -t public router.php` (never on a real server).

## 11. Exercises (stretch)

1. Add a `UNIQUE` index to stop duplicate applications, and an `ip` column to throttle the contact form.
2. Turn an approved application into a student with one click (a transaction across two tables).
3. Add a "change password" page and a user-management screen for admins.
4. Add a `version` column and reject an update if someone else saved first (optimistic locking, HTTP 409/412).
5. Write a new smoke test, then break the code on purpose and watch it fail.
