const { H, jar, bridgeFetch, open, check, sleep, until, api, signInAs, BASE } = require('./harness');

const progRows = (p) => [...p.d.querySelectorAll('#programRows tr[data-id]')];
const acctRows = (p) => [...p.d.querySelectorAll('#accountRows tr[data-id]')];
const shownTabs = (p) => [...p.d.querySelectorAll('[role=tab]')].filter((t) => !t.hidden).map((t) => t.id.replace('tab-', ''));
const toastText = (p, cls) => [...p.d.querySelectorAll(`.site-toast${cls ? '--' + cls : ''}`)].map((t) => t.textContent).join(' | ');
// Sign in WITHOUT touching the shared cookie jar (used to prove that a credential works or does not).
async function freshLogin(username, password) {
  const s = await fetch(BASE + '/api/session');
  const cookie = s.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const token = (await s.json()).csrfToken;
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, Cookie: cookie }, body: JSON.stringify({ username, password }) });
  return r.status;
}
const setChecks = (form, months) => form.querySelectorAll('input[name=intakes]').forEach((b) => { b.checked = months.includes(b.value); });

(async () => {
  console.log('Admin page as STAFF: no admin-only tabs');
  await signInAs('staff', process.env.STAFF_PW);
  H.requestLog = [];
  let p = await open('/admin.html');
  await until(() => p.d.querySelectorAll('#appRows tr').length > 0 || /No applications/.test(p.d.getElementById('appRows').textContent));
  check('staff see only Applications and Messages', shownTabs(p).join(',') === 'applications,messages', shownTabs(p).join(','));
  check('the Programs/Accounts panels stay hidden', p.d.getElementById('panel-programs').hidden && p.d.getElementById('panel-accounts').hidden);
  check('the page never even asks the server for accounts or edits programs', !H.requestLog.some((l) => l.includes('/api/users')), H.requestLog.join(';'));
  const tabMsgs = p.d.getElementById('tab-messages'); tabMsgs.click(); tabMsgs.focus();
  tabMsgs.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  check('ArrowRight from the last visible tab wraps to the first (hidden tabs are skipped)', p.d.getElementById('tab-applications').getAttribute('aria-selected') === 'true' && p.d.activeElement.id === 'tab-applications');
  p.w.close();

  console.log('Admin page as ADMIN: tabs and programs');
  await signInAs('admin', process.env.ADMIN_PW);
  H.requestLog = [];
  p = await open('/admin.html', { pre: (w) => { w.confirm = () => true; } });
  await until(() => progRows(p).length === 7);
  check('page scripts ran without errors', p.errors.length === 0, p.errors.join(' | '));
  check('admins see four tabs', shownTabs(p).join(',') === 'applications,messages,programs,accounts', shownTabs(p).join(','));
  const tabApps = p.d.getElementById('tab-applications');
  tabApps.click(); tabApps.focus(); tabApps.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  check('ArrowLeft from the first tab wraps to Accounts', p.d.getElementById('tab-accounts').getAttribute('aria-selected') === 'true');
  p.d.getElementById('tab-programs').click();
  check('Programs panel opens, listing 7 programs with fees formatted', !p.d.getElementById('panel-programs').hidden && progRows(p).some((r) => /BSc Computer Science/.test(r.textContent) && /KSh 645,650 \+ KSh 64,565/.test(r.textContent)));
  check('a program without published fees says so', progRows(p).some((r) => /BSc Mathematics/.test(r.textContent) && /Not published/.test(r.textContent)));
  check('faculty suggestions (datalist) were built from the existing programs', p.d.querySelectorAll('#facultyList option').length === 5);

  const form = p.d.getElementById('programForm'), f = form.elements;
  check('the add form starts hidden', p.d.getElementById('programFormCard').hidden);
  p.d.getElementById('addProgramBtn').click();
  check('Add program opens it, titled "Add program", focus in the name field', !p.d.getElementById('programFormCard').hidden && p.d.getElementById('programFormTitle').textContent === 'Add program' && p.d.activeElement === f.name);
  form.noValidate = true; f.name.value = 'ab'; form.requestSubmit();
  await until(() => !p.d.querySelector('#programForm [data-error-for=faculty]').hidden);
  check('empty/short fields: server messages appear beside name, faculty, grade and intakes', ['name', 'faculty', 'minKcse', 'intakes'].every((n) => !p.d.querySelector(`#programForm [data-error-for=${n}]`).hidden));
  p.w.MwakiUi.clearFieldErrors(form);
  f.name.value = 'BSc Data Science'; f.faculty.value = 'Science and Technology'; f.annualTuitionKes.value = '600000'; f.additionalFeesKes.value = ''; f.minKcse.value = 'C+'; setChecks(form, ['September', 'January']);
  form.requestSubmit();
  await until(() => !p.d.querySelector('#programForm [data-error-for=additionalFeesKes]').hidden);
  check('tuition without fees: the message appears under the fees box', /additional fees/i.test(p.d.querySelector('#programForm [data-error-for=additionalFeesKes]').textContent));
  f.additionalFeesKes.value = '60000'; H.requestLog = []; form.requestSubmit();
  await until(() => progRows(p).length === 8);
  check('valid program: POST 201, form closes, success toast, 8 rows', H.requestLog.includes('POST /api/programs -> 201') && p.d.getElementById('programFormCard').hidden && /BSc Data Science added/.test(toastText(p, 'success')));
  const newRow = progRows(p).find((r) => /BSc Data Science/.test(r.textContent));
  check('the new row shows fees and intakes in calendar order', /KSh 600,000 \+ KSh 60,000/.test(newRow.textContent) && /January, September/.test(newRow.textContent), newRow.textContent);

  console.log('One list, every page: the new program reaches the public pages');
  const tuition = await open('/tuition.html'); await until(() => tuition.d.querySelectorAll('#tuitionBody tr').length === 8);
  check('tuition.html now shows it (8 rows)', [...tuition.d.querySelectorAll('#tuitionBody tr')].some((r) => /BSc Data Science/.test(r.textContent) && /KSh 600,000/.test(r.textContent)));
  tuition.w.close();
  const adm = await open('/admission.html'); await until(() => adm.d.getElementById('program').options.length === 9);
  check('admission.html offers it in the program list', [...adm.d.getElementById('program').options].some((o) => o.textContent === 'BSc Data Science'));
  adm.w.close();

  console.log('Admin page: editing, duplicates, unsafe text');
  newRow.querySelector('[data-action=edit]').click();
  check('Edit opens the form pre-filled (values and ticked intake boxes)', f.name.value === 'BSc Data Science' && f.annualTuitionKes.value === '600000' && f.minKcse.value === 'C+' && form.querySelector('#p-int-Sep').checked && form.querySelector('#p-int-Jan').checked && !form.querySelector('#p-int-May').checked && /Edit BSc Data Science/.test(p.d.getElementById('programFormTitle').textContent));
  f.additionalFeesKes.value = '65000'; setChecks(form, ['May']); H.requestLog = []; form.requestSubmit();
  await until(() => /May/.test(progRows(p).find((r) => /Data Science/.test(r.textContent)).textContent) && /65,000/.test(progRows(p).find((r) => /Data Science/.test(r.textContent)).textContent));
  check('saving an edit: PUT 200 and the row shows the new fees and intake', H.requestLog.some((l) => /^PUT \/api\/programs\/\d+ -> 200$/.test(l)));
  p.d.getElementById('addProgramBtn').click();
  f.name.value = 'BSc Nursing'; f.faculty.value = 'Health Sciences'; f.annualTuitionKes.value = ''; f.additionalFeesKes.value = ''; f.minKcse.value = 'C+'; setChecks(form, ['March']); form.requestSubmit();
  await until(() => !p.d.querySelector('#programForm [data-error-for=name]').hidden);
  check('duplicate name (409): shown under the name field, form stays open', /already exists/.test(p.d.querySelector('#programForm [data-error-for=name]').textContent) && !p.d.getElementById('programFormCard').hidden);
  const evil = '<img src=x onerror="window.pwned=1"> Studies';
  p.w.MwakiUi.clearFieldErrors(form); f.name.value = evil; f.faculty.value = 'Arts and Humanities'; setChecks(form, ['May']); form.requestSubmit();
  await until(() => progRows(p).length === 9);
  check('XSS: a program named with markup is shown as TEXT (no <img> created)', p.d.querySelector('#programRows img') === null && progRows(p).some((r) => r.textContent.includes(evil)) && !p.w.pwned);

  console.log('Admin page: deleting programs');
  const nursing = progRows(p).find((r) => /BSc Nursing/.test(r.textContent));
  H.requestLog = []; nursing.querySelector('[data-action=delete]').click();
  await until(() => /cannot be deleted/.test(toastText(p, 'error')));
  check('deleting a program that has students is refused with an explanation', /BSc Nursing.*cannot be deleted.*2 students/.test(toastText(p, 'error')), toastText(p, 'error'));
  check('  ... the row is still listed', progRows(p).some((r) => /BSc Nursing/.test(r.textContent)));
  p.w.confirm = () => false; H.requestLog = [];
  progRows(p).find((r) => r.textContent.includes('Studies')).querySelector('[data-action=delete]').click(); await sleep(150);
  check('declining the confirmation sends nothing', !H.requestLog.some((l) => l.startsWith('DELETE')));
  p.w.confirm = () => true;
  progRows(p).find((r) => r.textContent.includes('Studies')).querySelector('[data-action=delete]').click();
  await until(() => progRows(p).length === 8);
  check('an unused program is deleted: DELETE 204, 8 rows left', H.requestLog.some((l) => /^DELETE \/api\/programs\/\d+ -> 204$/.test(l)) && progRows(p).length === 8);

  console.log('Admin page: accounts');
  p.d.getElementById('tab-accounts').click();
  await until(() => acctRows(p).length === 2);
  const adminRow = acctRows(p).find((r) => r.dataset.username === 'admin'), staffRow = acctRows(p).find((r) => r.dataset.username === 'staff');
  check('both accounts listed; yours is marked "(you)"', /\(you\)/.test(adminRow.textContent) && !/\(you\)/.test(staffRow.textContent));
  check('your own row offers NO delete / role / reset buttons', adminRow.querySelectorAll('button').length === 0 && /Change my password/.test(adminRow.textContent));
  check('other rows offer Make admin, Reset password, Delete', [...staffRow.querySelectorAll('button')].map((b) => b.textContent).join(',') === 'Make admin,Reset password,Delete');
  check('roles are shown as badges; no password hash is anywhere on the page', staffRow.querySelector('.badge--staff') && !/\$2y\$|hash/i.test(p.d.getElementById('panel-accounts').textContent));

  const aform = p.d.getElementById('accountForm'), af = aform.elements;
  p.d.getElementById('addAccountBtn').click();
  check('Add account opens the form with username, role and password', !p.d.getElementById('accountFormCard').hidden && !p.d.getElementById('accountUsernameField').hidden && p.d.activeElement === af.username);
  aform.noValidate = true; af.username.value = 'bad name'; af.password.value = 'short'; aform.requestSubmit();
  await until(() => !p.d.querySelector('#accountForm [data-error-for=password]').hidden);
  check('bad username and short password: errors beside the fields', /letters, digits/.test(p.d.querySelector('#accountForm [data-error-for=username]').textContent) && !p.d.querySelector('#accountForm [data-error-for=password]').hidden);
  p.w.MwakiUi.clearFieldErrors(aform);
  const PW = 'Front-desk-pass-12';
  af.username.value = 'frontdesk'; af.role.value = 'staff'; af.password.value = PW; H.requestLog = []; aform.requestSubmit();
  await until(() => acctRows(p).length === 3);
  check('valid account: POST 201, toast, 3 rows, form closed and emptied', H.requestLog.includes('POST /api/users -> 201') && /frontdesk created/.test(toastText(p, 'success')) && p.d.getElementById('accountFormCard').hidden && af.password.value === '');
  check('  ... the new person can really sign in', await freshLogin('frontdesk', PW) === 200);
  p.d.getElementById('addAccountBtn').click(); af.username.value = 'FRONTDESK'; af.password.value = PW; aform.requestSubmit();
  await until(() => !p.d.querySelector('#accountForm [data-error-for=username]').hidden);
  check('duplicate username: "already taken" beside the username field', /already taken/.test(p.d.querySelector('#accountForm [data-error-for=username]').textContent));
  p.d.getElementById('accountCancelBtn').click();

  const fd = () => acctRows(p).find((r) => r.dataset.username === 'frontdesk');
  fd().querySelector('[data-action=reset]').click();
  check('Reset password reuses the form: title names the person, username and role hidden', /Reset password for frontdesk/.test(p.d.getElementById('accountFormTitle').textContent) && p.d.getElementById('accountUsernameField').hidden && af.username.disabled && !p.d.getElementById('accountResetNote').hidden);
  const PW2 = 'Reset-from-admin-pass-77'; af.password.value = PW2; H.requestLog = []; aform.requestSubmit();
  await until(() => H.requestLog.some((l) => /^PATCH \/api\/users\/\d+ -> 200$/.test(l)) && p.d.getElementById('accountFormCard').hidden);
  check('reset sent as PATCH 200; the OLD password stops working, the NEW one works', await freshLogin('frontdesk', PW) === 401 && await freshLogin('frontdesk', PW2) === 200);
  p.d.getElementById('addAccountBtn').click();
  check('opening "Add account" again restores username and role fields', !p.d.getElementById('accountUsernameField').hidden && !af.username.disabled && p.d.getElementById('accountFormTitle').textContent === 'Add account');
  p.d.getElementById('accountCancelBtn').click();

  H.requestLog = []; fd().querySelector('[data-action=toggle-role]').click();
  await until(() => fd() && fd().querySelector('.badge--admin'));
  check('Make admin: PATCH 200 and the badge changes to admin', H.requestLog.some((l) => /^PATCH \/api\/users\/\d+ -> 200$/.test(l)) && !!fd().querySelector('.badge--admin') && /Make staff/.test(fd().textContent));
  fd().querySelector('[data-action=toggle-role]').click();
  await until(() => fd() && fd().querySelector('.badge--staff'));
  p.w.confirm = () => false; H.requestLog = []; fd().querySelector('[data-action=delete]').click(); await sleep(120);
  check('declining the delete confirmation changes nothing', !H.requestLog.some((l) => l.startsWith('DELETE')) && acctRows(p).length === 3);
  p.w.confirm = () => true; fd().querySelector('[data-action=delete]').click();
  await until(() => acctRows(p).length === 2);
  check('confirmed delete: DELETE 204, row gone, and that person can no longer sign in', await freshLogin('frontdesk', PW2) === 401);
  check('no script errors during the whole admin session', p.errors.length === 0, p.errors.join(' | '));
  p.w.close();

  console.log('Account page: change my password');
  await signInAs('staff', process.env.STAFF_PW);
  p = await open('/details.html');
  await until(() => !p.d.getElementById('passwordCard').hidden);
  const pf = p.d.getElementById('passwordForm'), pe = pf.elements; pf.noValidate = true;
  check('the change-password card appears for any signed-in user', !p.d.getElementById('passwordCard').hidden);
  pe.currentPassword.value = process.env.STAFF_PW; pe.newPassword.value = 'Brand-new-staff-pass-1'; pe.confirmPassword.value = 'Brand-new-staff-pass-X';
  H.requestLog = []; pf.requestSubmit(); await sleep(150);
  check('mismatched repeat is caught IN THE BROWSER (no request sent)', /do not match/.test(p.d.querySelector('#passwordForm [data-error-for=confirmPassword]').textContent) && !H.requestLog.some((l) => l.includes('/api/auth/password')));
  p.w.MwakiUi.clearFieldErrors(pf);
  pe.currentPassword.value = 'not-my-password-123'; pe.confirmPassword.value = 'Brand-new-staff-pass-1'; pf.requestSubmit();
  await until(() => !p.d.querySelector('#passwordForm [data-error-for=currentPassword]').hidden);
  check('wrong current password: message beside that field, box cleared, still signed in', /not your current password/.test(p.d.querySelector('#passwordForm [data-error-for=currentPassword]').textContent) && pe.currentPassword.value === '' && p.d.getElementById('accountName').textContent === 'staff');
  p.w.MwakiUi.clearFieldErrors(pf);
  pe.currentPassword.value = process.env.STAFF_PW; H.requestLog = []; pf.requestSubmit();
  await until(() => /Password changed/.test(toastText(p, 'success')));
  check('correct change: POST 200, success toast, all three boxes emptied', H.requestLog.includes('POST /api/auth/password -> 200') && pe.currentPassword.value === '' && pe.newPassword.value === '' && pe.confirmPassword.value === '');
  check('  ... old password rejected, new one accepted', await freshLogin('staff', process.env.STAFF_PW) === 401 && await freshLogin('staff', 'Brand-new-staff-pass-1') === 200);
  pe.currentPassword.value = 'Brand-new-staff-pass-1'; pe.newPassword.value = 'Brand-new-staff-pass-1'; pe.confirmPassword.value = 'Brand-new-staff-pass-1'; pf.requestSubmit();
  await until(() => !p.d.querySelector('#passwordForm [data-error-for=newPassword]').hidden);
  check('re-using the same password is refused beside the new-password field', /different/.test(p.d.querySelector('#passwordForm [data-error-for=newPassword]').textContent));
  check('after the change the page still works (new CSRF token in use): a follow-up API call succeeds', (await p.w.MwakiApi.get('/api/stats')).students.total === 10);
  check('no script errors', p.errors.length === 0, p.errors.join(' | '));
  p.w.close();

  console.log(`\nResult: ${H.pass} passed, ${H.fail} failed`);
  process.exit(H.fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH', e); process.exit(2); });
