/*
 * js/api.js  -  the ONE place where the browser talks to the PHP back end.
 *
 * Why wrap fetch()? Every request needs the same chores: send/receive JSON, attach the
 * CSRF token, turn HTTP errors into JavaScript errors, cope with the network being down.
 * Writing that once here keeps every page script short and consistent.
 *
 * Usage from any page script:
 *     const data = await MwakiApi.get('/api/programs');
 *     await MwakiApi.post('/api/auth/login', { username, password });
 */
(function () {
  'use strict';

  /**
   * An Error that also carries what the server said. Pages can inspect:
   *   err.status  (HTTP code; 0 means "could not reach the server at all")
   *   err.errors  (per-field messages for 422 validation errors)
   *   err.code    (short label such as 'throttled')
   */
  class ApiError extends Error {
    constructor(status, message, errors = {}, code = '') {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.errors = errors || {};
      this.code = code || '';
    }
  }

  // CSRF token (see src/Auth.php for what it is). Fetched lazily, before the first
  // state-changing request, and cached here.
  let csrfToken = null;
  let sessionPromise = null;

  /**
   * CONCEPT: async/await and Promises.
   * fetch() does not return the answer; it returns a PROMISE: a placeholder for an answer
   * that will arrive later (the network is slow compared to the CPU). `await` pauses THIS
   * function until the promise settles, while the rest of the page keeps running.
   * `async` marks a function that uses await; it always returns a promise itself.
   */
  async function request(method, path, body, options = {}) {
    const { signal, isRetry = false } = options;
    const headers = { Accept: 'application/json' };
    const init = {
      method,
      headers,
      signal,                       // lets the caller cancel this request (see AbortController in students.js)
      credentials: 'same-origin',   // send our session cookie (same-origin only)
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);          // JS object -> JSON text
    }
    if (method !== 'GET') {
      if (!csrfToken) await fetchSession();
      headers['X-CSRF-Token'] = csrfToken;
    }

    let response;
    try {
      response = await fetch(path, init);
    } catch (networkError) {
      // A request the CALLER cancelled is not a failure: pass it up unchanged so the caller can ignore it.
      if (networkError.name === 'AbortError') throw networkError;
      // fetch() only REJECTS when the request could not be made at all (offline, server down).
      // An HTTP error such as 404 or 500 is a normal response and does not throw.
      throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
    }

    let data = null;
    if (response.status !== 204) {              // 204 = "success, no body"
      try { data = await response.json(); } catch (e) { data = null; }
    }

    if (!response.ok) {                          // ok = status 200-299
      // A stale CSRF token (for example the session expired in another tab): fetch a fresh
      // one and try the SAME request once more, invisibly.
      if (response.status === 403 && data && data.code === 'csrf' && !isRetry) {
        csrfToken = null;
        await fetchSession(true);
        return request(method, path, body, { signal, isRetry: true });
      }
      throw new ApiError(
        response.status,
        (data && data.message) || `Request failed (${response.status}).`,
        data && data.errors,
        data && data.code
      );
    }
    return data;
  }

  /** GET /api/session once, remember the answer (user + CSRF token) for the whole page. */
  function fetchSession(force = false) {
    if (!sessionPromise || force) {
      sessionPromise = request('GET', '/api/session').then((data) => {
        csrfToken = data.csrfToken;
        return data;
      });
      // If it failed, forget the failure so a later call can try again.
      sessionPromise.catch(() => { sessionPromise = null; });
    }
    return sessionPromise;
  }

  /** Build "/api/x?a=1&b=2". URLSearchParams escapes values safely (spaces, &, ... in user text). */
  function withQuery(path, params) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== '') query.set(key, value);
    }
    const text = query.toString();
    return text ? `${path}?${text}` : path;
  }

  async function login(username, password) {
    const data = await request('POST', '/api/auth/login', { username, password });
    // The server issued a NEW CSRF token when it regenerated the session; use it from now on.
    csrfToken = data.csrfToken;
    sessionPromise = Promise.resolve({ user: data.user, csrfToken });
    return data.user;
  }

  async function changePassword(currentPassword, newPassword) {
    const data = await request('POST', '/api/auth/password', { currentPassword, newPassword });
    // The server started a fresh session when the password changed, so use the NEW CSRF token from now on.
    csrfToken = data.csrfToken;
    return data;
  }

  async function logout() {
    await request('POST', '/api/auth/logout', {});
    csrfToken = null;
    sessionPromise = null;
  }

  // The public face of this file. Everything above stays private inside the function.
  window.MwakiApi = {
    ApiError,
    get:    (path, params, options) => request('GET', withQuery(path, params), undefined, options),
    post:   (path, body)   => request('POST', path, body ?? {}),
    put:    (path, body)   => request('PUT', path, body ?? {}),
    patch:  (path, body)   => request('PATCH', path, body ?? {}),
    delete: (path)         => request('DELETE', path),
    session: () => fetchSession(),
    login,
    logout,
    changePassword,
  };
})();
