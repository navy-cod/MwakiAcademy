/*
 * login.js  -  behaviour of login.html: sign in through the API.
 */
(function () {
  'use strict';

  const form = document.getElementById('loginForm');
  if (!form) return;

  const { setBusy, clearFieldErrors, showFieldErrors, showFormError, toast } = MwakiUi;
  const submitButton = form.querySelector('button[type="submit"]');
  const STORAGE_KEY = 'mwaki.username';

  // ------------------------------------------------------------ "remember my username"
  // CONCEPT: Web Storage. localStorage keeps small strings in the browser, per website, and
  // they survive closing the browser. It is NOT secure storage (any script on the page can
  // read it), so we store only the username, NEVER the password.
  // The try/catch is needed because some browsers (private mode, strict settings) throw
  // when storage is blocked. The page must keep working anyway.
  function readRemembered() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function writeRemembered(username, shouldRemember) {
    try {
      if (shouldRemember) localStorage.setItem(STORAGE_KEY, username);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* storage blocked: nothing to do, remembering is only a convenience */ }
  }

  // ------------------------------------------------------------ where to go after sign-in
  /*
   * Other pages send visitors here as  login.html?next=details.html  so we can return them
   * to where they were heading. SECURITY: "open redirect". If we blindly did
   * location = params.get('next'), a link such as ?next=https://evil.example would bounce a
   * freshly signed-in user to a look-alike site. So we ALLOW-LIST the shape: letters, digits,
   * "_", "-", "/" and a final ".html", nothing else (no colon, no leading slash, no "//").
   */
  function destinationAfterLogin() {
    const next = new URLSearchParams(window.location.search).get('next');
    const looksSafe = next !== null
      && /^[A-Za-z0-9_\-/]+\.html$/.test(next)
      && !next.startsWith('/')
      && !next.includes('//');
    return looksSafe ? next : 'details.html';
  }

  // ------------------------------------------------------------ show/hide password button
  const passwordInput = form.elements.password;
  const toggle = form.querySelector('.password-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const show = passwordInput.type === 'password';
      passwordInput.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      toggle.querySelector('i').className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
    });
  }

  // ------------------------------------------------------------ submit
  form.addEventListener('submit', async (event) => {
    // By default a form submit makes the browser load a new page. We cancel that and send
    // the data ourselves with fetch(), so the page never reloads and we control the result.
    event.preventDefault();
    clearFieldErrors(form);

    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;      // not trimmed: spaces may be part of it

    setBusy(submitButton, true, 'Signing in…');
    try {
      await MwakiApi.login(username, password);
      writeRemembered(username, form.elements.rememberUsername.checked);
      window.location.assign(destinationAfterLogin());
    } catch (error) {
      setBusy(submitButton, false);
      if (!(error instanceof MwakiApi.ApiError)) {
        toast('Something unexpected happened.', 'error');
        console.error(error);
        return;
      }
      // 422 = a field problem (e.g. empty username): show it beside the field.
      // 401 / 429 / network = a general problem: show it at the top of the form.
      const shownOnField = error.status === 422 && showFieldErrors(form, error.errors);
      if (!shownOnField) showFormError(form, error.message);
      if (error.status === 401) {
        form.elements.password.value = '';
        form.elements.password.focus();
      }
    }
  });

  form.addEventListener('reset', () => clearFieldErrors(form));

  // ------------------------------------------------------------ on page load
  const remembered = readRemembered();
  if (remembered) {
    form.elements.username.value = remembered;
    form.elements.rememberUsername.checked = true;
  }

  // Already signed in? Skip the form.
  MwakiApi.session()
    .then((session) => { if (session.user) window.location.replace(destinationAfterLogin()); })
    .catch(() => { /* server unreachable: the form still shows and reports the error on submit */ });
})();
