const { H, jar, bridgeFetch, open, check, sleep, until, api, signInAs } = require('./harness');
const NEXT = new Date().getFullYear() + 1;
const items = (p) => [...p.d.querySelectorAll('#studentList .student-item')];
const names = (p) => items(p).map((i) => i.querySelector('.student-select').textContent.trim());
const typeInto = (p, el, value) => { el.value = value; el.dispatchEvent(new p.w.Event('input', { bubbles: true })); };

(async () => {
  console.log('Student manager: signed out');
  jar.clear();
  let p = await open('/e_students/students.html');
  await sleep(300);
  check('signed-out visitor is sent to the login page', p.navs.length > 0);
  check('  ... and the Add button stays disabled', p.d.getElementById('addBtn').disabled);
  p.w.close();

  console.log('Student manager: admin, list, paging, search, sort');
  await signInAs('admin', process.env.ADMIN_PW);
  p = await open('/e_students/students.html', { pre: (w) => { w.confirm = () => true; } });
  await until(() => items(p).length === 5);
  check('page scripts ran without errors', p.errors.length === 0, p.errors.join(' | '));
  check('first page shows 5 students, alphabetical by first name', names(p).join(',').startsWith('David Kamau (MU-2024-003),Elizabeth Wambui') && items(p).length === 5, names(p).join(' | '));
  check('header shows total 10 and average 82%', p.d.getElementById('totalStudents').textContent === '10' && p.d.getElementById('avgGrade').textContent === '82%');
  check('pagination says Page 1 of 2, Prev disabled, Next enabled', p.d.getElementById('pageInfo').textContent === 'Page 1 of 2 · 10 students' && p.d.getElementById('prevPage').disabled && !p.d.getElementById('nextPage').disabled);
  check('first student is selected and shown on the right', /David Kamau/.test(p.d.getElementById('studentDetail').textContent) && items(p)[0].classList.contains('selected'));
  check('header shows who is signed in', p.d.getElementById('userName').textContent === 'admin (admin)' && !p.d.getElementById('addBtn').disabled);
  check('course list was loaded into the form', p.d.getElementById('f-programId').options.length === 8);

  p.d.getElementById('nextPage').click();
  await until(() => /John/.test(names(p)[0] || ''));
  check('Next shows page 2 (John, Mary, Michael, Peter, Sarah)', names(p).map((n) => n.split(' ')[0]).join(',') === 'John,Mary,Michael,Peter,Sarah');
  check('  ... Next now disabled, Prev enabled', p.d.getElementById('nextPage').disabled && !p.d.getElementById('prevPage').disabled);

  const search = p.d.getElementById('searchInput');
  H.requestLog = [];
  for (const text of ['g', 'gr', 'gra', 'grac', 'grace']) typeInto(p, search, text);     // five quick keystrokes
  await until(() => items(p).length === 1, 3000);
  check('search "grace" leaves 1 student, back on page 1', names(p).length === 1 && /Grace Wanjiku/.test(names(p)[0]) && p.d.getElementById('pageInfo').textContent === 'Page 1 of 1 · 1 student');
  const searchCalls = H.requestLog.filter((l) => l.startsWith('GET /api/students?'));
  check('debounce: 5 keystrokes caused exactly ONE request', searchCalls.length === 1, searchCalls.join(' ; '));
  check('header stats still describe ALL students (10)', p.d.getElementById('totalStudents').textContent === '10');
  typeInto(p, search, 'zzzz'); await until(() => /No students match/.test(p.d.getElementById('studentList').textContent));
  check('no match: friendly message, pagination hidden, detail panel empty', p.d.getElementById('pagination').hidden && /Select a student/.test(p.d.getElementById('studentDetail').textContent));
  typeInto(p, search, '%'); await until(() => /No students match/.test(p.d.getElementById('studentList').textContent) && H.requestLog.some((l) => l.includes('q=%25')));
  check('typing a lone % does not match everybody', items(p).length === 0);
  typeInto(p, search, ''); await until(() => items(p).length === 5);

  const sort = p.d.getElementById('sortSelect');
  sort.value = 'gradeDesc'; sort.dispatchEvent(new p.w.Event('change', { bubbles: true }));
  await until(() => /Faith/.test(names(p)[0] || ''));
  check('sort "Grade (High to Low)": Faith (95) first', /Faith Akinyi/.test(names(p)[0]));
  sort.value = 'name'; sort.dispatchEvent(new p.w.Event('change', { bubbles: true })); await until(() => /David/.test(names(p)[0] || ''));

  items(p)[2].querySelector('.student-select').click();
  check('clicking a student selects it', /Faith Akinyi/.test(p.d.getElementById('studentDetail').textContent) && items(p)[2].querySelector('.student-select').getAttribute('aria-current') === 'true');
  check('detail shows grade letter, age and course', /95% - A \(Excellent\)/.test(p.d.getElementById('studentDetail').textContent) && /years old/.test(p.d.getElementById('studentDetail').textContent) && /BSc Computer Science/.test(p.d.getElementById('studentDetail').textContent));

  console.log('Student manager: stale responses are ignored (AbortController)');
  p.w.close();
  const slowFirst = async (u, i) => { if (/[?&]q=an(&|$)/.test(String(u))) await sleep(600); return bridgeFetch(u, i); };
  p = await open('/e_students/students.html', { fetchImpl: slowFirst });
  await until(() => items(p).length === 5);
  H.requestLog = [];
  typeInto(p, p.d.getElementById('searchInput'), 'an');       // slow request starts after the 300 ms debounce
  await sleep(450);
  typeInto(p, p.d.getElementById('searchInput'), 'grace');    // newer request replaces it
  await until(() => items(p).length === 1 && /Grace/.test(names(p)[0]));
  await sleep(900);                                            // the slow "an" answer would have landed by now
  check('the slow, OLD search does not overwrite the newer results', items(p).length === 1 && /Grace/.test(names(p)[0]), names(p).join(' | '));
  check('  ... and no error message was shown for the cancelled request', p.d.querySelectorAll('.toast-error').length === 0);
  p.w.close();

  console.log('Student manager: add, edit, delete');
  p = await open('/e_students/students.html', { pre: (w) => { w.confirm = () => true; } });
  await until(() => items(p).length === 5);
  const modal = p.d.getElementById('studentModal'), form = p.d.getElementById('studentForm'), f = form.elements;
  p.d.getElementById('addBtn').focus(); p.d.getElementById('addBtn').click();
  check('Add opens the modal with the right title, focus in the first field', modal.style.display === 'flex' && /Add New Student/.test(p.d.getElementById('modalTitle').textContent) && p.d.activeElement === f.firstName);
  p.d.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('Escape closes it and returns focus to the Add button', modal.style.display === 'none' && p.d.activeElement === p.d.getElementById('addBtn'));

  p.d.getElementById('addBtn').click(); form.noValidate = true;
  f.firstName.value = 'Zed'; f.lastName.value = 'Tester'; f.studentCode.value = 'bad'; f.email.value = 'zed@example.com'; f.phone.value = '0711000222';
  f.grade.value = '150'; f.programId.value = ''; f.address.value = 'Nairobi'; f.dob.value = '2004-04-04';
  form.requestSubmit();
  await until(() => !p.d.querySelector('[data-error-for=grade]').hidden);
  check('server errors appear beside their fields (grade, course, ID)', ['grade', 'programId', 'studentCode'].every((n) => !p.d.querySelector(`[data-error-for=${n}]`).hidden));
  check('  ... modal stays open and Save is usable again', modal.style.display === 'flex' && !p.d.getElementById('saveBtn').disabled);

  f.studentCode.value = 'mu-2026-020'; f.grade.value = '61.5'; f.programId.value = String([...f.programId.options].find((o) => o.textContent === 'BSc Nursing').value);
  f.email.value = 'john.ochieng@mwaki.ac.ke';                    // an email that already exists
  form.requestSubmit();
  await until(() => !p.d.querySelector('[data-error-for=email]').hidden);
  check('duplicate email (409) is shown under the email field', /already belongs/.test(p.d.querySelector('[data-error-for=email]').textContent) && modal.style.display === 'flex');
  f.email.value = 'zed.tester@example.com';
  H.requestLog = []; form.requestSubmit();
  await until(() => modal.style.display === 'none');
  await until(() => p.d.getElementById('totalStudents').textContent === '11');
  check('valid save: POST 201, modal closes, total becomes 11', H.requestLog.some((l) => l === 'POST /api/students -> 201') && p.d.getElementById('totalStudents').textContent === '11');
  check('  ... the new student is shown on the right even though it is on another page', /Zed Tester/.test(p.d.getElementById('studentDetail').textContent) && /MU-2026-020/.test(p.d.getElementById('studentDetail').textContent));
  check('  ... ID was upper-cased, course saved', /BSc Nursing/.test(p.d.getElementById('studentDetail').textContent));
  check('  ... a success toast appeared', [...p.d.querySelectorAll('.toast-success')].some((t) => /Zed Tester added/.test(t.textContent)));

  H.requestLog = [];
  p.d.querySelector('#studentDetail [data-action=edit]').click();
  await until(() => modal.style.display === 'flex');
  check('Edit first fetches the CURRENT record (GET /api/students/{id})', H.requestLog.some((l) => /^GET \/api\/students\/\d+ -> 200$/.test(l)), H.requestLog.join(';'));
  check('  ... and fills the form (title, values)', /Edit Student/.test(p.d.getElementById('modalTitle').textContent) && f.firstName.value === 'Zed' && f.grade.value === '61.5' && f.dob.value === '2004-04-04' && f.studentCode.value === 'MU-2026-020');
  f.grade.value = '77'; f.address.value = 'Kisumu Road'; H.requestLog = []; form.requestSubmit();
  await until(() => modal.style.display === 'none');
  await until(() => /77%/.test(p.d.getElementById('studentDetail').textContent));
  check('edit saved: PUT 200, detail shows the new grade and address', H.requestLog.some((l) => /^PUT \/api\/students\/\d+ -> 200$/.test(l)) && /Kisumu Road/.test(p.d.getElementById('studentDetail').textContent));

  console.log('Student manager: unsafe data is displayed as text');
  const evil = '<img src=x onerror="window.pwned=1">';
  const created = await api('POST', '/api/students', { studentCode: 'MU-2026-021', firstName: evil, lastName: 'Markup', email: 'markup@example.com', phone: '0711999888', grade: 50, programId: 1, address: '<script>window.pwned=2</script>', dob: '2003-03-03', imageUrl: null });
  check('server accepted the markup as plain text (201)', created.status === 201, JSON.stringify(created.json));
  typeInto(p, p.d.getElementById('searchInput'), 'Markup'); await until(() => items(p).length === 1);
  p.d.querySelector('#studentList .student-select').click();
  check('list shows the markup as TEXT (no <img> created)', p.d.querySelector('#studentList img[src="x"]') === null && names(p)[0].includes(evil));
  check('detail shows name and address as TEXT, nothing executed', p.d.querySelector('#studentDetail img[src="x"], #studentDetail script') === null && p.d.getElementById('studentDetail').textContent.includes('<script>window.pwned=2</script>') && !p.w.pwned);
  check('student without a photo gets initials', !!p.d.querySelector('#studentList .initials') && p.d.querySelector('#studentDetail .detail-avatar.initials').textContent === '<M');
  typeInto(p, p.d.getElementById('searchInput'), ''); await until(() => items(p).length === 5);

  console.log('Student manager: photos fall back to initials');
  const firstImg = p.d.querySelector('#studentList img');
  const row = firstImg.closest('.student-item');
  const who = row.querySelector('.student-select').textContent.trim().split(' ');
  check('before the error, that row shows a photo and no initials', !row.querySelector('.initials'));
  firstImg.dispatchEvent(new p.w.Event('error'));
  const swapped = row.querySelector('.initials');
  check('a photo that fails to load is replaced by that student\'s initials', swapped && swapped.textContent === (who[0][0] + who[1][0]).toUpperCase() && !row.querySelector('img'), swapped && swapped.textContent);

  console.log('Student manager: delete (admin)');
  typeInto(p, p.d.getElementById('searchInput'), 'Zed'); await until(() => items(p).length === 1);
  p.w.confirm = () => false; H.requestLog = [];
  p.d.querySelector('#studentList [data-action=delete]').click(); await sleep(150);
  check('declining the confirmation deletes nothing', !H.requestLog.some((l) => l.startsWith('DELETE')) && items(p).length === 1);
  p.w.confirm = () => true;
  p.d.querySelector('#studentList [data-action=delete]').click();
  await until(() => H.requestLog.some((l) => l.startsWith('DELETE')));
  await until(() => p.d.getElementById('totalStudents').textContent === '11');   // 12 - 1  (Zed + Markup were both added)
  check('confirming sends DELETE (204) and the total drops by one', H.requestLog.some((l) => /^DELETE \/api\/students\/\d+ -> 204$/.test(l)) && p.d.getElementById('totalStudents').textContent === '11');
  check('  ... a warning toast says it was deleted', [...p.d.querySelectorAll('.toast-warning')].some((t) => /deleted/.test(t.textContent)));
  check('no script errors during the whole admin session', p.errors.length === 0, p.errors.join(' | '));

  console.log('Student manager: sign out');
  p.d.getElementById('logoutBtn').click();
  await until(() => p.navs.length > 0);
  check('Sign out navigates away and ends the session', p.navs.length > 0 && (await bridgeFetch('/api/students')).status === 401);
  p.w.close();

  console.log('Student manager: staff cannot delete');
  await signInAs('staff', process.env.STAFF_PW);
  p = await open('/e_students/students.html', { pre: (w) => { w.confirm = () => true; } });
  await until(() => items(p).length === 5);
  check('staff see the "staff (staff)" label', p.d.getElementById('userName').textContent === 'staff (staff)');
  check('staff get Edit buttons but NO Delete buttons (list or detail)', p.d.querySelectorAll('[data-action=edit]').length > 0 && p.d.querySelectorAll('[data-action=delete]').length === 0);
  const forbidden = await p.w.MwakiApi.delete('/api/students/1').then(() => null, (e) => e);
  check('and the SERVER refuses a forged delete anyway (403)', forbidden && forbidden.status === 403 && forbidden.code === 'forbidden', forbidden && `${forbidden.status} ${forbidden.code}`);
  p.w.close();

  console.log(`\nResult: ${H.pass} passed, ${H.fail} failed`);
  process.exit(H.fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH', e); process.exit(2); });
