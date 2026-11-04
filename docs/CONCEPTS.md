# Concepts guide: what is new or non-obvious, in the order you meet it

Read the project the way a request travels: **browser page -> JavaScript -> network -> PHP -> database -> back**.
Every concept below is also explained in a comment *at the place it first appears*; this page is the map.

## A. In the browser

1. **Semantic HTML and accessibility** - `public/login.html`, `admission.html`
   Use the element that *means* what it is: `<header>`, `<nav>`, `<main>`, `<label for>`, `<fieldset>/<legend>`,
   `<button>` (not a clickable `<div>`), `<details>`, `<table>` with `scope`. Screen readers, keyboards and search
   engines all rely on that meaning. Extras: the "skip to main content" link, `aria-live` for announcements,
   `aria-invalid` + `aria-describedby` for errors, `hidden` for things that should not exist yet.

2. **CSS layout, the cascade and responsiveness** - `public/style.css`
   Flexbox and Grid arrange content; `@media (max-width: 768px)` changes the layout on small screens. When two rules
   conflict, the more *specific* selector wins, and for equal specificity the *later* one wins. That is why each
   phase *appends* to `style.css` instead of editing old rules. `[hidden]{display:none !important}` makes the
   `hidden` attribute reliable.

3. **Script scope: IIFEs and one namespace** - `public/js/api.js`
   Every file wraps its code in `(function () { ... })();` so its variables stay private, and exposes only one
   object (`window.MwakiApi`, `window.MwakiUi`). Without this, scripts would overwrite each other's variables.

4. **Building the DOM safely (XSS)** - `public/js/ui.js` (`h()`), every page script
   `innerHTML = "<b>" + name + "</b>"` turns text into live HTML, so a name like `<img onerror=...>` *runs*.
   `textContent` and text nodes never do. Rule here: user data enters the page only through `h()`/`textContent`;
   `innerHTML` appears in exactly one audited place (`setBusy` in `ui.js`), and a test enforces that.

5. **Events: preventDefault, bubbling, delegation** - `login.js`, `e_students/students.js`, `admin.js`
   A form's default is to reload the page; `event.preventDefault()` cancels that so we can use `fetch`. Clicks
   *bubble* up from the clicked element to its ancestors, so **one** listener on a container can serve all its
   (re)built children (`event.target.closest('[data-action]')`).

6. **Asynchronous JavaScript: Promises, async/await, fetch** - `public/js/api.js`
   The network is slow, so `fetch()` returns a *Promise* (a placeholder for a future answer). `await` pauses the
   function, not the page. `try/catch` handles failures: `fetch` only *rejects* when no response arrives at all; HTTP
   errors (404, 500) are normal responses you must check (`response.ok`). `api.js` turns both into one `ApiError`.

7. **Debounce and cancelling requests (race conditions)** - `ui.js` (`debounce`), `students.js` (`AbortController`)
   Typing fires an event per keystroke; debounce waits for a pause. Answers can also arrive out of order, so a slow
   old search could overwrite a newer one; aborting the previous request guarantees only the newest may update the screen.

8. **Client-side validation is only a convenience** - every form
   `required`, `type="email"`, `minlength` give instant feedback via the browser's Constraint Validation. Anyone can
   bypass them (DevTools, curl), so the server re-checks everything. *Never trust the client.*

9. **Web Storage** - `login.js`
   `localStorage` keeps small strings in the browser across visits. It is readable by any script on the page, so it
   holds only the *username*, never a password or token; every call is wrapped in `try/catch` because browsers can block it.

10. **Application state and render()** - `students.js`
    Keep what the screen shows in one `state` object; after any change, redraw from it. Frameworks automate this idea.

## B. Across the network

11. **HTTP in practice** - `api/index.php`, `ApplicationController.php`
    A request has a *method* (GET read, POST create, PUT replace, PATCH change part, DELETE remove), a URL, headers and
    an optional body; a response has a *status code* and a body. Codes used here: 200 OK, 201 Created, 204 No Content,
    303 See Other, 400/415/413 bad request, 401 not signed in, 403 not allowed, 404 not found, 405 wrong method,
    409 conflict, 422 invalid data, 429 too many requests, 500 our bug.

12. **JSON as the language between JavaScript and PHP** - `Http.php`
    `JSON.stringify` on one side, `json_decode` on the other. The server caps size and depth and insists on an *object*.

13. **Cookies and sessions** - `Auth.php`
    HTTP forgets you between requests. A *session* gives it memory: a random id in a cookie points to data kept on the
    server. Cookie flags matter: `HttpOnly` (JavaScript cannot read it), `SameSite=Lax` (not sent on cross-site posts),
    `Secure` (HTTPS only).

## C. On the server (PHP)

14. **Dev server, front controller and routing** - `router.php`, `public/api/index.php`, `src/Router.php`
    `php -S` maps URLs to files; our `router.php` hands `/api/*` to one *front controller*, which does the shared work
    (headers, session, CSRF) once and asks the `Router` which controller method matches **method + URL**.
    Why `public/`? Everything under the web root can be requested, so source code, config and the database live *outside* it.

15. **Autoloading, bootstrap, config** - `src/bootstrap.php`, `config/config.php`
    `spl_autoload_register` loads `Mwaki\Foo` from `src/Foo.php` on demand. One bootstrap file does setup once
    (`require_once` stops it running twice - a bug this project really hit). Settings live in one file.

16. **Errors become responses** - `HttpException.php`, `Http::handleException`
    Code `throw`s `new HttpException(404, '...')` from anywhere; one handler turns it into JSON. Unexpected bugs are
    *logged* but shown to users only as a generic message (stack traces tell attackers how your code works).

17. **Server-side validation and mass assignment** - `src/Validator.php`
    Rules like `['required','email','maxlen:120']`. Only the listed fields are copied out of the request, so an extra
    `"role":"admin"` or `"status":"approved"` in the JSON is ignored. Two layers: *field rules*, then *business rules*
    that need the database (does the program exist? is this intake still open?).

18. **PDO, prepared statements, SQL injection** - `src/Database.php`
    Never glue input into SQL. Send the query with `?` placeholders and the values separately, and the database can
    never mistake data for code. Two cases placeholders cannot cover are handled by hand: `ORDER BY` (the URL carries a
    short key; we look up the SQL from an allow-list) and `LIKE` (`%` and `_` are escaped so they are ordinary characters).

19. **Schema, constraints, transactions, 409** - `database/schema.sql`, `StudentController.php`
    `UNIQUE`, `CHECK`, `FOREIGN KEY` make the *database* refuse bad data even if the PHP is wrong. A UNIQUE violation is
    caught and reported as **409 Conflict** beside the right field. A *transaction* makes several statements all-or-nothing.

20. **Passwords, timing and throttling** - `Auth.php`
    Store only `password_hash()` output; check with `password_verify()`. An unknown username still gets a dummy hash
    check so response time does not reveal which usernames exist; the same error text is used for both failures. Five
    failures in 15 minutes lock that username+IP out (429).

21. **Session fixation** - `Auth::attempt`
    `session_regenerate_id(true)` at sign-in guarantees the post-login session id could not have been planted earlier.

22. **CSRF** - `Auth::verifyCsrf`, `api.js`
    Browsers attach cookies even to requests started by *other* sites. A secret token that only our pages know, sent in
    a header on every state-changing request, makes a forged request fail. (`submit_inquiry.php` deliberately skips it:
    an anonymous message depends on no identity, so there is nothing to forge.)

23. **Authentication vs authorization** - `Auth::requireUser`
    *Authentication* = who are you (401). *Authorization* = what may you do (403). Staff can edit students; only admins
    can delete. The UI hides the button from staff, but the **server** enforces it, and a test proves it.

24. **REST, idempotency, PUT vs PATCH** - `StudentController.php`, `AdminController.php`
    URLs name things, verbs say what to do. PUT replaces the whole record; PATCH changes one field. GET, PUT and DELETE
    are *idempotent*: repeating them is harmless, so a retry after a network glitch is safe. POST is not.

25. **Pagination and search** - `StudentController::index`
    Send one page at a time (`LIMIT/OFFSET`), clamp out-of-range pages, report totals so the UI can draw "Page 2 of 5".

## D. Defence in depth

26. **Progressive enhancement, Post/Redirect/Get, honeypots** - `submit_inquiry.php`, `contact.js`
    The form works with no JavaScript (the browser posts it; PHP answers with a 303 redirect, so Refresh cannot resubmit).
    JavaScript then upgrades it. A hidden field that humans leave empty and bots fill in catches spam silently.

27. **Escaping output in PHP** - `submit_inquiry.php` (`e()`)
    When PHP *prints* visitor text into HTML, `htmlspecialchars` turns `<` into `&lt;` so it displays instead of running.
    Escape at the moment of output, every time.

28. **Security headers and Content-Security-Policy** - `Http::securityHeaders`
    CSP is a whitelist of where scripts/styles/images may come from. With no `'unsafe-inline'` for scripts, even an
    injected `<script>` or `onclick=` is refused by the browser. That is why no page contains an inline handler.

29. **Open redirects** - `login.js` (`destinationAfterLogin`)
    "Sign in, then go to `?next=...`" must not accept `https://evil.example`. Only an allow-listed shape is followed.

30. **Data minimisation** - `ApplicationController::status`
    The tracking lookup needs reference **and** email, answers "not found" identically for either mismatch, and never
    returns phone, address or date of birth.

## E. Testing

31. **Smoke tests, mutation testing, simulated browsers** - `tests/`
    `tests/api-smoke.sh` sends real HTTP requests and compares answers. A test suite that never fails proves nothing,
    so while building this project deliberate bugs were planted ("mutants") to confirm the tests catch each one.
    `tests/browser/` drives the real page scripts in jsdom. Neither replaces looking at the page in a real browser.
