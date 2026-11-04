const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const BASE = process.env.BASE;
const jar = new Map();
let requestLog = [];

function storeCookies(res) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    const name = pair.slice(0, i), val = pair.slice(i + 1);
    if (/expires=thu, 01 jan 1970/i.test(c) || val === '') jar.delete(name); else jar.set(name, val);
  }
}
async function bridgeFetch(url, init = {}) {          // what the browser's fetch would do, plus cookies
  const full = new URL(url, BASE).href;
  const headers = { ...(init.headers || {}) };
  if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(full, { ...init, headers, redirect: 'manual' });
  storeCookies(res);
  requestLog.push(`${init.method || 'GET'} ${new URL(full).pathname}${new URL(full).search} -> ${res.status}`);
  return res;
}
class SameOriginOnly extends ResourceLoader {         // never touch the internet (CDNs etc.)
  fetch(url, o) { return url.startsWith(BASE) ? super.fetch(url, o) : Promise.resolve(Buffer.from('')); }
}

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('  PASS ', n); };
const bad = (n, d) => { fail++; console.log('  FAIL ', n, '->', d); };
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
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });   // jsdom lacks it
      w.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) };            // jsdom lacks it
      if (pre) pre(w);
    },
  });
  if (dom.window.document.readyState !== 'complete') await new Promise((r) => dom.window.addEventListener('load', r));
  await sleep(150);
  return { dom, w: dom.window, d: dom.window.document, errors, navs };
}
const setVal = (w, id, v) => { w.document.getElementById(id).value = v; };
async function signIn(user, pass) {                    // sign in the shared cookie jar via the page's own client code
  const p = await open('/login.html');
  await p.w.MwakiApi.login(user, pass); p.dom.window.close();
}

(async () => {
  console.log('Navigation (about.html, signed out)');
  let p = await open('/about.html');
  const btn = p.d.querySelector('.nav-toggle'), nav = p.d.getElementById('site-nav');
  check('page scripts ran without errors', p.errors.length === 0, p.errors.join(' | '));
  btn.click();
  check('menu button opens the menu', nav.classList.contains('is-open') && btn.getAttribute('aria-expanded') === 'true');
  p.d.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape closes it', !nav.classList.contains('is-open') && btn.getAttribute('aria-expanded') === 'false');
  btn.click(); p.d.body.click();
  check('clicking outside closes it', !nav.classList.contains('is-open'));
  check('signed-out link still says Login', p.d.querySelector('[data-auth-link]').textContent.trim() === 'Login');
  p.w.close();

  console.log('Login page');
  p = await open('/login.html');
  check('page scripts ran without errors', p.errors.length === 0, p.errors.join(' | '));
  const form = p.d.getElementById('loginForm'), submit = form.querySelector('[type=submit]');
  setVal(p.w, 'username', 'admin'); setVal(p.w, 'password', 'definitely-wrong');
  form.requestSubmit();
  await until(() => !p.d.querySelector('[data-form-error]').hidden);
  check('wrong password shows the message at the top', p.d.querySelector('[data-form-error]').textContent === 'Invalid username or password.');
  check('  ... password box is emptied, button usable again', form.elements.password.value === '' && !submit.disabled);
  check('  ... no navigation happened', p.navs.length === 0);

  form.noValidate = true; setVal(p.w, 'username', ''); setVal(p.w, 'password', 'x');
  p.w.MwakiUi.clearFieldErrors(form); form.requestSubmit();
  await until(() => !p.d.querySelector('[data-error-for=username]').hidden);
  check('server 422 appears beside the field', p.d.querySelector('[data-error-for=username]').textContent === 'Username is required.');
  check('  ... input marked aria-invalid and focused', form.elements.username.getAttribute('aria-invalid') === 'true' && p.d.activeElement === form.elements.username);
  form.noValidate = false;

  const tgl = p.d.querySelector('.password-toggle');
  tgl.click(); check('show-password button reveals the password', form.elements.password.type === 'text' && tgl.getAttribute('aria-pressed') === 'true');
  tgl.click(); check('  ... and hides it again', form.elements.password.type === 'password');

  setVal(p.w, 'username', 'admin'); setVal(p.w, 'password', process.env.ADMIN_PW); form.elements.rememberUsername.checked = true;
  form.requestSubmit();
  await until(() => p.navs.length > 0);
  check('correct sign-in navigates onward', p.navs.length > 0);
  check('"remember username" stored in localStorage', p.w.localStorage.getItem('mwaki.username') === 'admin');
  check('password was never stored', !Object.values(p.w.localStorage).some((v) => String(v).includes(process.env.ADMIN_PW)));
  check('session cookie now in the jar', jar.has('mwaki_session'));
  p.w.close();

  p = await open('/login.html');
  await until(() => p.navs.length > 0);
  check('visiting login while signed in skips the form', p.navs.length > 0);
  p.w.close();

  p = await open('/login.html', { pre: (w) => w.localStorage.setItem('mwaki.username', 'staff') });
  check('remembered username prefills the form', p.d.getElementById('username').value === 'staff' && p.d.getElementById('rememberUsername').checked);
  p.w.close();

  console.log('?next= redirect allow-list (open-redirect defence)');
  const src = require('fs').readFileSync(process.env.ROOT + '/public/login.js', 'utf8');
  const fnText = src.match(/function destinationAfterLogin\(\) \{[\s\S]*?\n  \}/)[0];
  const dest = (search) => new Function('window', fnText + '; return destinationAfterLogin();')({ location: { search } });
  check('allows details.html', dest('?next=details.html') === 'details.html');
  check('allows e_students/students.html', dest('?next=e_students/students.html') === 'e_students/students.html');
  for (const evil of ['https://evil.example/x.html', '//evil.example/x.html', '/etc/x.html', 'javascript:alert(1).html', '..%2f..%2fx.html', 'a.html?x=1', 'x.php']) {
    check(`rejects ${evil}`, dest('?next=' + evil) === 'details.html', dest('?next=' + evil));
  }

  console.log('Account page');
  p = await open('/details.html');                                         // signed in (jar has the cookie)
  await until(() => !p.d.getElementById('statsSection').hidden);
  check('shows the username and role', p.d.getElementById('accountName').textContent === 'admin' && p.d.getElementById('accountRole').textContent === 'admin');
  check('shows a readable member-since date', /20\d\d/.test(p.d.getElementById('accountSince').textContent));
  const cards = [...p.d.querySelectorAll('.stat-card')];
  check('four stat cards, 10 students', cards.length === 4 && cards[0].querySelector('.stat-value').textContent === '10', cards.map((c) => c.textContent).join('|'));
  check('table lists 7 programs', p.d.querySelectorAll('#programRows tr').length === 7);
  check('no script errors', p.errors.length === 0, p.errors.join(' | '));
  p.w.close();

  console.log('Tuition page');
  p = await open('/tuition.html');
  await until(() => p.d.querySelectorAll('#tuitionBody tr').length === 7);
  const rows = [...p.d.querySelectorAll('#tuitionBody tr')];
  check('static rows replaced by 7 live rows', rows.length === 7);
  check('CS tuition formatted', rows.some((r) => r.textContent.includes('BSc Computer Science') && r.textContent.includes('KSh 645,650') && r.textContent.includes('KSh 64,565')));
  const math = rows.find((r) => r.textContent.includes('BSc Mathematics'));
  check('program without a fee shows a message (colspan 2)', math && math.children[1].colSpan === 2 && /confirmed/.test(math.textContent));
  p.w.close();
  p = await open('/tuition.html', { fetchImpl: () => Promise.reject(new TypeError('network down')) });
  await sleep(200);
  check('offline: saved rows are kept', p.d.querySelectorAll('#tuitionBody tr').length === 5);
  check('offline: notice is shown', !p.d.getElementById('tuitionStatus').hidden);
  p.w.close();

  console.log('Logout link (signed in)');
  p = await open('/about.html');
  await until(() => p.d.querySelector('[data-auth-link]').textContent.trim() === 'Logout');
  const links = [...p.d.querySelectorAll('#site-nav a')].map((a) => a.textContent.trim());
  check('Login became Logout, Account link added', links.includes('Logout') && links.includes('Account'), links.join(','));
  p.d.querySelector('[data-auth-link]').click();
  await until(() => p.navs.length > 0);
  check('clicking Logout signs out and navigates', p.navs.length > 0);
  check('server session is really gone', (await bridgeFetch('/api/stats')).status === 401);
  p.w.close();

  p = await open('/details.html');
  await until(() => p.navs.length > 0);
  check('account page redirects a signed-out visitor', p.navs.length > 0 && p.d.getElementById('accountCard').hidden);
  p.w.close();

  console.log('Home page sidebar (signed in, no duplicate Account link)');
  await signIn('staff', process.env.STAFF_PW);
  p = await open('/home.html');
  await until(() => p.d.querySelector('[data-auth-link]').textContent.trim() === 'Logout');
  const sidebar = p.d.getElementById('site-sidebar');
  check('sidebar Login -> Logout with icon kept', p.d.querySelector('[data-auth-link] i') !== null);
  check('no extra Account item (Details already there)', [...sidebar.querySelectorAll('a')].filter((a) => a.getAttribute('href') === 'details.html').length === 1);
  p.d.querySelector('.nav-toggle').click();
  check('hamburger opens the sidebar', sidebar.classList.contains('is-open'));
  p.w.close();

  console.log('API client behaviour');
  p = await open('/login.html');
  requestLog = [];
  jar.clear();                                          // server forgets us: our stored CSRF token is now stale
  const result = await p.w.MwakiApi.post('/api/auth/logout');
  check('stale CSRF token is renewed and the request retried', result && result.ok === true, JSON.stringify(result));
  check('  ... exactly: 403, session GET, then 200', requestLog.slice(-3).map((x) => x.split(' -> ')[1]).join(',') === '403,200,200', requestLog.join(' ; '));
  requestLog = [];
  await p.w.MwakiApi.get('/api/programs', { q: 'a b&c', empty: '', nothing: null, page: 2 });
  check('query strings are escaped, empty values dropped', requestLog[0].startsWith('GET /api/programs?q=a+b%26c&page=2'), requestLog[0]);
  p.w.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  try { await p.w.MwakiApi.get('/api/programs'); bad('network failure', 'did not throw'); }
  catch (e) { check('network failure becomes ApiError(status 0)', e instanceof p.w.MwakiApi.ApiError && e.status === 0 && /Cannot reach/.test(e.message)); }
  p.w.fetch = bridgeFetch;
  try { await p.w.MwakiApi.get('/api/stats'); bad('401', 'did not throw'); }
  catch (e) { check('HTTP errors carry status + message', e.status === 401 && /sign in/i.test(e.message), e.status + ' ' + e.message); }

  console.log('Safe rendering (XSS)');
  const evil = '<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>';
  const node = p.w.MwakiUi.h('p', { class: 'x' }, evil);
  p.d.body.append(node);
  check('h() keeps markup as plain text', node.textContent === evil && node.querySelector('img,script') === null);
  const f = p.d.getElementById('loginForm'); p.w.MwakiUi.showFieldErrors(f, { username: evil });
  check('error messages are text, not HTML', p.d.querySelector('[data-error-for=username]').querySelector('img,script') === null && !p.w.pwned);
  check('escapeHtml neutralises tags', !/[<>]/.test(p.w.MwakiUi.escapeHtml(evil)));
  p.w.MwakiUi.toast(evil, 'error');
  check('toast text is not parsed as HTML', p.d.querySelector('.site-toast').querySelector('img,script') === null);
  p.w.close();

  console.log('Logo fallback cannot loop');
  p = await open('/about.html');
  const logo = p.d.querySelector('.logo-area img');
  logo.dispatchEvent(new p.w.Event('error'));           // first failure: swap to placeholder
  check('first error swaps to the fallback', logo.src.startsWith('https://placehold.co/') && !logo.hasAttribute('data-fallback'));
  const swapped = logo.src; logo.dispatchEvent(new p.w.Event('error'));
  check('second error does nothing (no endless loop)', logo.src === swapped);
  p.w.close();

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH', e); process.exit(2); });
