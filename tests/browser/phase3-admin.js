const { H, jar, bridgeFetch, open, check, sleep, until, api, signInAs } = require('./harness');
const NEXT = new Date().getFullYear() + 1;
const rows = (p) => [...p.d.querySelectorAll('#appRows tr[data-id]')];
const cards = (p) => [...p.d.querySelectorAll('#messageList .message-card')];
const pick = (p, id, value) => { const el = p.d.getElementById(id); el.value = value; el.dispatchEvent(new p.w.Event('change', { bubbles: true })); };

(async () => {
  // ---- seed the database through the PUBLIC endpoints, exactly as visitors would
  const programs = (await (await bridgeFetch('/api/programs')).json()).programs;
  const cs = programs.find((x) => x.name === 'BSc Computer Science').id;
  const evilText = '<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>';
  const app = (name, email, motivation) => api('POST', '/api/applications', { fullName: name, email, phone: '0712 000 111', gender: 'Female', dob: '2003-05-05', address: 'Murang\'a Town', programId: cs, kcseGrade: 'B', intakeYear: NEXT, intakePeriod: 'January', motivation, howHeard: 'Social Media' }, { anonymous: true });
  const refs = {};
  for (const [name, email, mot] of [['Alice Alpha', 'alice@example.com', 'I love mathematics and computing a lot.'], ['Bob Beta', 'bob@example.com', evilText + ' and I want to study.'], ['Cara Gamma', 'cara@example.com', 'I want to build software for farmers here.']]) {
    const r = await app(name, email, mot); refs[name] = r.json.application.reference;
    if (r.status !== 201) { console.log('SEED FAILED', JSON.stringify(r)); process.exit(2); }
  }
  for (const [name, email, message] of [['Dan', 'dan@example.com', 'When does the January intake start?'], ['Eve', 'eve@example.com', evilText + ' please call me back'], ['Fay', 'fay@example.com', 'Line one\nLine two of my question.']]) {
    const r = await api('POST', '/api/inquiries', { name: name + ' Visitor', email, phone: '', message, website: '' }, { anonymous: true });
    if (r.status !== 201) { console.log('SEED FAILED', JSON.stringify(r)); process.exit(2); }
  }

  console.log('Admin page: signed out');
  jar.clear();
  let p = await open('/admin.html');
  await sleep(300);
  check('signed-out visitor is sent to the login page and sees no data', p.navs.length > 0 && p.d.getElementById('adminApp').hidden);
  p.w.close();

  console.log('Admin page: applications');
  await signInAs('staff', process.env.STAFF_PW);
  p = await open('/admin.html');
  await until(() => rows(p).length === 3);
  check('page scripts ran without errors', p.errors.length === 0, p.errors.join(' | '));
  check('subtitle names the signed-in user', /Signed in as staff \(staff\)/.test(p.d.getElementById('adminSubtitle').textContent));
  check('three applications listed, newest first', rows(p).length === 3 && /Cara Gamma/.test(rows(p)[0].textContent) && /Alice Alpha/.test(rows(p)[2].textContent));
  check('badge and summary count the pending ones', p.d.getElementById('pendingCount').textContent === '3 pending' && /Under review: 3 · Approved: 0 · Not successful: 0/.test(p.d.getElementById('appSummary').textContent), p.d.getElementById('appSummary').textContent);
  check('messages badge is filled in too, before opening the tab', p.d.getElementById('newCount').textContent === '3 new');
  const bob = rows(p).find((r) => /Bob Beta/.test(r.textContent));
  check('applicant details sit inside a <details> element', !!bob.querySelector('details > summary') && /0712|\+254712000111/.test(bob.textContent) && /Murang'a Town/.test(bob.textContent));
  check('XSS: a malicious motivation is shown as TEXT only', bob.textContent.includes('<script>window.pwned=2</script>') && p.d.querySelector('#appRows img, #appRows script') === null && !p.w.pwned);
  check('action buttons say which application they act on (aria-label)', !!rows(p)[0].querySelector(`button[aria-label="Approve application ${refs['Cara Gamma']}"]`));

  H.requestLog = [];
  const approveBtn = rows(p)[0].querySelector('[data-status=approved]');
  approveBtn.click();
  check('buttons are disabled while the request runs (no double clicks)', approveBtn.disabled);
  await until(() => /Approved/.test(rows(p)[0].querySelector('.status-pill').textContent));
  check('Approve: PATCH 200 and the row now says Approved', H.requestLog.some((l) => /^PATCH \/api\/applications\/\d+ -> 200$/.test(l)) && rows(p)[0].querySelector('.status-pill').textContent === 'Approved');
  check('  ... summary and badge updated from the server', /Under review: 2 · Approved: 1/.test(p.d.getElementById('appSummary').textContent) && p.d.getElementById('pendingCount').textContent === '2 pending');
  check('  ... an approved row offers Reject and Reopen', [...rows(p)[0].querySelectorAll('button')].map((b) => b.textContent).join(',') === 'Reject,Reopen');
  const seenByApplicant = await (await bridgeFetch(`/api/applications/status?ref=${refs['Cara Gamma']}&email=cara@example.com`)).json();
  check('the APPLICANT\'s tracking page now reports "approved"', seenByApplicant.application.status === 'approved');

  rows(p).find((r) => /Bob Beta/.test(r.textContent)).querySelector('[data-status=rejected]').click();
  await until(() => /Not successful: 1/.test(p.d.getElementById('appSummary').textContent));
  check('Reject works: summary shows 1 not successful', /Under review: 1 · Approved: 1 · Not successful: 1/.test(p.d.getElementById('appSummary').textContent));

  pick(p, 'appStatus', 'approved'); await until(() => rows(p).length === 1);
  check('filter "Approved" shows only Cara', /Cara Gamma/.test(rows(p)[0].textContent));
  pick(p, 'appStatus', 'rejected'); await until(() => rows(p).length === 1 && /Bob/.test(rows(p)[0].textContent));
  check('filter "Not successful" shows only Bob', rows(p).length === 1);
  pick(p, 'appStatus', ''); await until(() => rows(p).length === 3);
  const search = p.d.getElementById('appSearch');
  const type = (v) => { search.value = v; search.dispatchEvent(new p.w.Event('input', { bubbles: true })); };
  type('alice'); await until(() => rows(p).length === 1 && /Alice/.test(rows(p)[0].textContent));
  check('search by name finds Alice', rows(p).length === 1);
  type('%'); await until(() => /No applications match/.test(p.d.getElementById('appRows').textContent));
  check('a lone % matches nothing and the pager hides', p.d.getElementById('appPager').hidden);
  type(refs['Bob Beta'].toLowerCase()); await until(() => rows(p).length === 1 && /Bob/.test(rows(p)[0].textContent));
  check('search by reference number works (case-insensitive)', rows(p).length === 1);
  type(''); await until(() => rows(p).length === 3);

  console.log('Admin page: tabs');
  const tabApps = p.d.getElementById('tab-applications'), tabMsgs = p.d.getElementById('tab-messages');
  tabMsgs.click();
  check('clicking "Messages" shows its panel and hides the other', !p.d.getElementById('panel-messages').hidden && p.d.getElementById('panel-applications').hidden);
  check('  ... aria-selected and roving tabindex follow', tabMsgs.getAttribute('aria-selected') === 'true' && tabApps.getAttribute('aria-selected') === 'false' && tabMsgs.tabIndex === 0 && tabApps.tabIndex === -1);
  tabMsgs.focus(); tabMsgs.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  check('ArrowLeft moves to the Applications tab and focuses it', tabApps.getAttribute('aria-selected') === 'true' && p.d.activeElement === tabApps && !p.d.getElementById('panel-applications').hidden);
  tabApps.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  check('ArrowRight moves back to Messages', tabMsgs.getAttribute('aria-selected') === 'true');

  console.log('Admin page: messages');
  await until(() => cards(p).length === 3);
  check('three NEW messages shown', cards(p).length === 3 && /3 shown · New: 3 · Handled: 0/.test(p.d.getElementById('msgSummary').textContent), p.d.getElementById('msgSummary').textContent);
  const eve = cards(p).find((c) => /Eve Visitor/.test(c.textContent));
  check('XSS: a malicious message is shown as TEXT only', eve.textContent.includes('<script>window.pwned=2</script>') && p.d.querySelector('#messageList img, #messageList script') === null && !p.w.pwned);
  check('line breaks in a message are kept (CSS pre-wrap on a text node)', cards(p).some((c) => c.querySelector('.message-body').textContent === 'Line one\nLine two of my question.'));
  check('sender email is a mailto: link', eve.querySelector('a').getAttribute('href') === 'mailto:eve@example.com');

  H.requestLog = [];
  cards(p)[0].querySelector('button').click();
  await until(() => cards(p).length === 2);
  check('Mark as handled: PATCH 200, card leaves the "New" list, badge drops to 2', H.requestLog.some((l) => /^PATCH \/api\/inquiries\/\d+ -> 200$/.test(l)) && p.d.getElementById('newCount').textContent === '2 new');
  pick(p, 'msgFilter', '1'); await until(() => cards(p).length === 1);
  check('filter "Handled" shows the one handled message with a Handled pill', cards(p).length === 1 && !!cards(p)[0].querySelector('.status-pill') && cards(p)[0].querySelector('button').textContent === 'Mark as new');
  cards(p)[0].querySelector('button').click();
  await until(() => /No messages here/.test(p.d.getElementById('messageList').textContent));
  check('Mark as new puts it back (Handled list is empty again)', cards(p).length === 0 && p.d.getElementById('newCount').textContent === '3 new');
  pick(p, 'msgFilter', ''); await until(() => cards(p).length === 3);
  check('filter "All messages" shows all three', cards(p).length === 3);
  check('no script errors during the whole session', p.errors.length === 0, p.errors.join(' | '));
  p.w.close();

  console.log('Admin page: admin role works too');
  await signInAs('admin', process.env.ADMIN_PW);
  p = await open('/admin.html');
  await until(() => rows(p).length === 3);
  check('an admin sees the same data', rows(p).length === 3 && /Signed in as admin \(admin\)/.test(p.d.getElementById('adminSubtitle').textContent));
  p.w.close();

  console.log(`\nResult: ${H.pass} passed, ${H.fail} failed`);
  process.exit(H.fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH', e); process.exit(2); });
