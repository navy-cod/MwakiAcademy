const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const BASE = process.env.BASE;
const jar = new Map();
const H = { requestLog: [], pass: 0, fail: 0 };

function storeCookies(res) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    const name = pair.slice(0, i), val = pair.slice(i + 1);
    if (/expires=thu, 01 jan 1970/i.test(c) || val === '') jar.delete(name); else jar.set(name, val);
  }
}
async function bridgeFetch(url, init = {}) {
  const { signal, ...rest } = init;                      // Node's fetch rejects jsdom's AbortSignal, so honour it ourselves
  const abortError = () => { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; return e; };
  if (signal && signal.aborted) throw abortError();
  const full = new URL(url, BASE).href;
  const headers = { ...(rest.headers || {}) };
  if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const pending = fetch(full, { ...rest, headers, redirect: 'manual' });
  pending.catch(() => {});                               // an aborted request may still fail later: nobody is listening
  const res = signal
    ? await Promise.race([pending, new Promise((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }))])
    : await pending;
  storeCookies(res);
  H.requestLog.push(`${init.method || 'GET'} ${new URL(full).pathname}${new URL(full).search} -> ${res.status}`);
  return res;
}
class SameOriginOnly extends ResourceLoader {
  fetch(url, o) { return url.startsWith(BASE) ? super.fetch(url, o) : Promise.resolve(Buffer.from('')); }
}
const ok = (n) => { H.pass++; console.log('  PASS ', n); };
const bad = (n, d) => { H.fail++; console.log('  FAIL ', n, '->', d); };
const check = (n, cond, detail = '') => cond ? ok(n) : bad(n, detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(25); } return false; }

async function open(path, { pre, fetchImpl } = {}) {
  const errors = [], navs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { (/navigation/i.test(e.message) ? navs : errors).push(e.message); });
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = await JSDOM.fromURL(BASE + path, {
    runScripts: 'dangerously', resources: new SameOriginOnly(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = fetchImpl || bridgeFetch;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) };
      if (pre) pre(w);
    },
  });
  if (dom.window.document.readyState !== 'complete') await new Promise((r) => dom.window.addEventListener('load', r));
  await sleep(150);
  return { dom, w: dom.window, d: dom.window.document, errors, navs };
}
// jsdom does not fire 'change' when .value is assigned from code, so we do it like a user would.
function choose(p, el, value) { el.value = String(value); el.dispatchEvent(new p.w.Event('change', { bubbles: true })); }
async function api(method, path, body, { anonymous = false } = {}) {   // talk to the API directly, like curl would
  if (anonymous) jar.clear();
  const session = await (await bridgeFetch('/api/session')).json();
  const res = await bridgeFetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function signInAs(username, password) { jar.clear(); return api('POST', '/api/auth/login', { username, password }); }
module.exports = { BASE, jar, H, bridgeFetch, open, ok, bad, check, sleep, until, choose, api, signInAs };
