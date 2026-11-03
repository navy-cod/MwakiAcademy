# Mwaki University web app - Phase 1

Your static site, extended with a PHP back end and JavaScript front end.
**Phase 1** adds: the server foundation, SQLite database, sign-in (sessions + CSRF), the programs
catalogue, a responsive navigation shell, and the Login, Account (details) and Tuition pages.
Phase 2 adds Admission, Application tracking and Contact. Phase 3 adds the Student manager and Admin page.

## 1. Requirements

* **PHP 8.1 or newer** with the `pdo_sqlite` and `mbstring` extensions.
  Check: `php -v` and `php -m` (look for `pdo_sqlite` and `mbstring` in the list).
  * XAMPP on Windows: open `php.ini`, make sure `extension=pdo_sqlite`, `extension=sqlite3`
    and `extension=mbstring` have no leading `;`. Use the full path, e.g. `C:\xampp\php\php.exe`.
* No Composer, no Node, no database server. SQLite is a single file.

## 2. First-time setup

```bash
# 1. Put your own media next to the pages (they were not part of the upload):
#       public/multimedia/   (mwaki_logo.png, college.mp4, tuition_block.jpg, exam_prep.mp3, ...)
#       public/fee-structure.pdf

# 2. Create the database and the two staff accounts. Passwords are printed ONCE - copy them.
php database/seed.php

# 3. Start the development server. -t public makes /public the web root.
php -S localhost:8000 -t public router.php
```

Open <http://localhost:8000>. Stop the server with Ctrl+C.

## 3. Folder map

```
router.php            dev-server helper (routes /api/*, serves .html with security headers)
config/config.php     every setting in one place
src/                  PHP classes (private: NOT inside the web root)
  Controllers/        one class per area of the API
database/             schema.sql, seed.php, students.json (seed data)
storage/              mwaki.sqlite appears here (private)
tests/api-smoke.sh    automated checks for the back end
public/               the web root: everything the browser may request
  api/index.php       front controller for /api/*
  js/                 api.js (fetch wrapper), ui.js (helpers), nav.js (menu + login link)
  *.html, style.css   your pages (edited as described below)
  login.js details.js tuition.js    page scripts, one per page
  e_students/         the student manager (unchanged until Phase 3)
```

Why `public/`? A web server serves every file under its web root. Keeping `src/`, `config/`,
`database/` and `storage/` OUTSIDE it means a typo in a URL can never download your source
code or your database. This is how production sites are laid out.

## 4. What moved or changed from your upload

| Before | Now | Why |
|---|---|---|
| all pages, `style.css`, `admission.js` in the project root | `public/` | web-root separation (above) |
| `students.html/.css/.js/.json` | `public/e_students/` | your `home.html` already linked to `e_students/students.html` |
| `students.json` | copy in `database/` (seed source) + a temporary copy in `public/e_students/` | the OLD student page still reads its copy until Phase 3 replaces it |
| `login.html` | POST + fetch, no "Skin Complexion", no email box | passwords no longer travel in the URL; see below |
| `details.html` | "My Account" page | shows the signed-in user and statistics |
| `tuition.html` | repaired `<head>`; table filled from the database | was missing doctype/head |
| every page header | shared header + menu button | mobile navigation |
| `style.css` | **appended** "PHASE 1 ADDITIONS" block at the end | nothing above it was edited |

Login page, in detail: the old form sent the password in the address bar (`method="get"`), collected a
"Skin Complexion" checkbox group, and asked for an email that nothing used. The checkbox group was
replaced by "Remember my username on this device" (it demonstrates `localStorage`). The email box was removed
because signing in uses username + password only. To restore either, edit `login.html`.

## 5. Where data lives

`storage/mwaki.sqlite`. Inspect it with <https://sqlitebrowser.org/> or `sqlite3 storage/mwaki.sqlite`.
To start over: stop the server, delete that file, run `php database/seed.php` again.

## 6. Testing Phase 1

Automated (Mac, Linux, WSL, or Git Bash on Windows). It uses a throw-away database and port 8765:

```bash
bash tests/api-smoke.sh
```

Manual checklist (server running, signed out unless stated):

1. `http://localhost:8000/` redirects to `home.html`; the page and its styles load.
2. Narrow the browser below 768 px wide: a menu button appears; it opens/closes the menu; Esc closes it.
3. Open `about.html` or `faculties.html`: content is centred (no big empty strip on the left).
4. `tuition.html` shows 7 programs; BSc Information Technology and BSc Mathematics say the fee is to be confirmed.
5. `details.html` while signed out sends you to `login.html?next=details.html`.
6. On the login page click "Sign in" with empty boxes: the browser asks you to fill them in.
7. Wrong password: a red message appears at the top; the password box empties.
8. Five wrong passwords in a row: the sixth says to wait about 15 minutes (the throttle).
9. Correct admin sign-in: you land on the Account page showing role, member-since date, four statistics, and a table.
10. The menu now says "Account" and "Logout". Click Logout: you return to the login page; `details.html` is protected again.
11. Tick "Remember my username", sign in, sign out, return to the login page: the username is filled in.
12. Open DevTools > Network on the login page. Sign in: the request is `POST /api/auth/login`, the password is in the
    request body (never in the URL), and the response has a `Set-Cookie` with `HttpOnly` and `SameSite=Lax`.

## 7. Troubleshooting

* `could not find driver` - the `pdo_sqlite` extension is not enabled (see Requirements).
* `Address already in use` - another program uses port 8000; try `-S localhost:8080`.
* Logo shows a grey placeholder - your `public/multimedia/mwaki_logo.png` is missing.
* A page shows saved tuition figures and a notice - the API could not be reached; is the server running?
* Want to see error details while developing: `MWAKI_DEBUG=1 php -S localhost:8000 -t public router.php`
  (never on a real server).
