const { H, jar, bridgeFetch, open, check, sleep, until, choose } = require('./harness');
const NEXT = new Date().getFullYear() + 1;

(async () => {
  console.log('Admission page: programs and dependent selects');
  let p = await open('/admission.html');
  const f = p.d.getElementById('admissionForm');
  const program = f.elements.programId, year = f.elements.intakeYear, period = f.elements.intakePeriod, grade = f.elements.kcseGrade;
  check('page scripts ran without errors', p.errors.length === 0, p.errors.join(' | '));
  await until(() => program.options.length > 1);
  const groups = [...program.querySelectorAll('optgroup')].map((g) => g.label);
  check('7 programs loaded under 5 faculty groups', program.querySelectorAll('option[value]:not([value=""])').length === 7 && groups.length === 5, groups.join(','));
  check('year/period start empty', year.options.length === 1 && period.options.length === 1);
  const csId = [...program.options].find((o) => o.textContent === 'BSc Computer Science').value;
  const nurseId = [...program.options].find((o) => o.textContent === 'BSc Nursing').value;
  choose(p, program, csId);
  const years = [...year.options].map((o) => o.value).filter(Boolean);
  check('CS offers only years that still have open intakes', years.length > 0 && years.every((y) => Number(y) >= new Date().getFullYear()) && years.includes(String(NEXT)), years.join(','));
  choose(p, year, NEXT);
  check('CS periods for next year: January then September (chronological)', [...period.options].map((o) => o.textContent).join('|') === '--Select Period--|January Intake|September Intake', [...period.options].map((o) => o.textContent).join('|'));
  choose(p, program, nurseId);
  check('changing program resets year and period', year.options.length > 1 && period.options.length === 1 && year.value === '');
  choose(p, year, NEXT);
  check('Nursing offers March and September', [...period.options].map((o) => o.value).filter(Boolean).join(',') === 'March,September');

  console.log('Admission page: KCSE hint (convenience only)');
  const hint = p.d.getElementById('kcseHint');
  choose(p, program, csId); choose(p, grade, 'C');
  check('grade below the minimum shows a warning naming the program and C+', !hint.hidden && /BSc Computer Science/.test(hint.textContent) && /C\+/.test(hint.textContent), hint.textContent);
  choose(p, grade, 'B');
  check('a sufficient grade hides the warning', hint.hidden);
  choose(p, grade, 'C+');
  check('exactly the minimum is fine', hint.hidden);
  const counter = p.d.getElementById('messageCount');
  f.elements.motivation.value = 'hello'; f.elements.motivation.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  check('character counter updates', counter.textContent === '5 / 1000', counter.textContent);

  console.log('Admission page: server errors beside fields');
  const fill = (o = {}) => {
    f.elements.fullName.value = o.name ?? 'Amina Wanjiru'; f.elements.email.value = o.email ?? 'amina.w@example.com';
    f.elements.phone.value = '0722 111 222'; f.elements.gender.value = 'Female'; f.elements.dob.value = '2004-08-09';
    f.elements.address.value = 'Murang\'a Town'; choose(p, program, csId); choose(p, grade, o.grade ?? 'B');
    choose(p, year, NEXT); choose(p, period, 'January');
    f.elements.motivation.value = 'I enjoy solving problems and want to study computing.'; f.elements.howHeard.value = 'Social Media';
  };
  f.noValidate = true;                                   // skip browser checks so the SERVER's answer is what we see
  fill({ grade: 'C' }); f.requestSubmit();
  await until(() => !p.d.querySelector('[data-error-for=kcseGrade]').hidden);
  check('below-minimum grade: server message appears under the grade field', /requires a KCSE mean grade of C\+/.test(p.d.querySelector('[data-error-for=kcseGrade]').textContent));
  check('  ... field is aria-invalid and focused', grade.getAttribute('aria-invalid') === 'true' && p.d.activeElement === grade);
  check('  ... no receipt shown, button usable again', p.d.getElementById('applicationReceipt').hidden && !f.querySelector('[type=submit]').disabled);
  p.w.MwakiUi.clearFieldErrors(f);
  f.elements.email.value = 'not-an-email'; f.requestSubmit();
  await until(() => !p.d.querySelector('[data-error-for=email]').hidden);
  check('malformed email shows beside the email field', /valid email/.test(p.d.querySelector('[data-error-for=email]').textContent));

  console.log('Admission page: successful submission and receipt');
  p.w.MwakiUi.clearFieldErrors(f);
  const evilName = 'Amina <img src=x onerror="window.pwned=1"> Wanjiru';
  fill({ name: evilName, grade: 'B' }); f.requestSubmit();
  await until(() => !p.d.getElementById('applicationReceipt').hidden);
  const receipt = p.d.getElementById('applicationReceipt');
  check('receipt appears and the form is hidden', !receipt.hidden && p.d.getElementById('applicationFormCard').hidden);
  check('success banner is visible and mentions the reference', p.d.getElementById('successMessage').classList.contains('is-visible') && /MU-\d{4}-[A-Z0-9]{6}/.test(p.d.getElementById('successText').textContent));
  const ref = p.d.querySelector('.receipt-list .reference').textContent;
  check('reference has the MU-YYYY-XXXXXX shape', /^MU-\d{4}-[A-HJ-NP-Z2-9]{6}$/.test(ref), ref);
  const dd = [...p.d.querySelectorAll('.receipt-list dd')].map((e) => e.textContent);
  check('receipt shows program, intake and status in plain words', dd.some((t) => t.startsWith('BSc Computer Science')) && dd.includes(`January ${NEXT}`) && dd.includes('Under review'), dd.join(' | '));
  check('XSS: the name is shown as TEXT, no <img> was created', receipt.querySelector('img') === null && dd.includes(evilName.trim()) && !p.w.pwned);

  console.log('Admission page: PDF button');
  let printed = 0; p.w.print = () => { printed++; };
  p.d.getElementById('downloadPDFBtn').click(); await sleep(50);
  check('html2pdf unavailable -> falls back to the print dialog', printed === 1);
  const saved = [];
  p.w.html2pdf = () => ({ set(o) { this.o = o; return this; }, from(el) { this.el = el; return this; }, save() { saved.push({ o: this.o, el: this.el }); return Promise.resolve(); } });
  p.d.getElementById('downloadPDFBtn').click(); await sleep(50);
  check('html2pdf available -> PDF is made from the receipt, named by reference', saved.length === 1 && saved[0].el.id === 'applicationSummary' && saved[0].o.filename === `Mwaki-Application-${ref}.pdf`, JSON.stringify(saved[0] && saved[0].o));
  check('  ... print dialog not opened this time', printed === 1);
  p.w.html2pdf = () => ({ set() { return this; }, from() { return this; }, save() { return Promise.reject(new Error('boom')); } });
  p.d.getElementById('downloadPDFBtn').click(); await sleep(80);
  check('html2pdf failing -> falls back to print and tells the user', printed === 2 && !!p.d.querySelector('.site-toast'));

  console.log('Admission page: duplicate and starting again');
  p.d.getElementById('newApplicationBtn').click();
  check('"Start another application" restores a clean form', !p.d.getElementById('applicationFormCard').hidden && p.d.getElementById('applicationReceipt').hidden && f.elements.fullName.value === '' && year.options.length === 1 && !p.d.getElementById('successMessage').classList.contains('is-visible'));
  fill({ name: 'Amina Wanjiru', grade: 'B' }); f.requestSubmit();
  await until(() => !p.d.querySelector('[data-form-error]').hidden);
  check('resubmitting the same application shows the 409 message at the top', /already applied/.test(p.d.querySelector('[data-form-error]').textContent), p.d.querySelector('[data-form-error]').textContent);
  check('  ... still no receipt', p.d.getElementById('applicationReceipt').hidden);

  console.log('Admission page: tracking');
  const tf = p.d.getElementById('trackForm');
  const track = async (r, e) => { tf.elements.ref.value = r; tf.elements.email.value = e; p.w.MwakiUi.clearFieldErrors(tf); p.d.getElementById('trackResult').hidden = true; tf.requestSubmit(); await sleep(400); };
  await track(ref.toLowerCase(), 'AMINA.W@example.com');
  const res = p.d.getElementById('trackResult');
  check('lower-case reference + mixed-case email finds it', !res.hidden && /Under review/.test(res.textContent) && res.textContent.includes(ref) && /BSc Computer Science/.test(res.textContent), res.textContent);
  check('  ... result does not show phone/address/date of birth', !/0722|Murang|2004/.test(res.textContent));
  await track(ref, 'someone.else@example.com');
  check('wrong email: generic "could not find" message, no result', res.hidden && /could not find/.test(tf.querySelector('[data-form-error]').textContent));
  await track('', '');
  tf.noValidate = true; tf.elements.ref.value = ''; tf.elements.email.value = ''; tf.requestSubmit(); await sleep(300);
  check('empty lookup: 422 shown beside the fields', /required/.test(p.d.querySelector('#trackForm [data-error-for=ref]').textContent));
  check('no script errors during the whole flow', p.errors.length === 0, p.errors.join(' | '));
  p.w.close();

  console.log('Admission page: server unreachable');
  p = await open('/admission.html', { fetchImpl: () => Promise.reject(new TypeError('network down')) });
  await sleep(200);
  check('program list failure is explained and Submit is disabled', /could not load the list of programs/i.test(p.d.querySelector('#admissionForm [data-form-error]').textContent) && p.d.querySelector('#admissionForm [type=submit]').disabled);
  p.w.close();

  console.log('Contact page');
  p = await open('/contact.html');
  const cf = p.d.getElementById('contactForm');
  check('scripts ran without errors', p.errors.length === 0, p.errors.join(' | '));
  check('counter starts at 0 / 2000', p.d.getElementById('messageCount').textContent === '0 / 2000');
  const hp = p.d.getElementById('website');
  check('honeypot is inside an aria-hidden, off-screen wrapper and skipped by Tab', hp.closest('.hp-field').getAttribute('aria-hidden') === 'true' && hp.tabIndex === -1);
  check('form still has its no-JS action', cf.getAttribute('action') === 'submit_inquiry.php' && cf.method === 'post');
  cf.noValidate = true; cf.elements.name.value = 'J'; cf.elements.email.value = 'bad'; cf.elements.message.value = 'hi'; cf.requestSubmit();
  await until(() => !p.d.querySelector('[data-error-for=message]').hidden);
  check('422: name, email and message errors appear beside their fields', ['name', 'email', 'message'].every((n) => !p.d.querySelector(`[data-error-for=${n}]`).hidden));
  p.w.MwakiUi.clearFieldErrors(cf);
  cf.elements.name.value = 'Peter Kamau'; cf.elements.email.value = 'peter.k@example.com'; cf.elements.phone.value = '0733 000 111';
  cf.elements.message.value = 'Could you tell me when the next nursing intake opens?';
  cf.elements.message.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  H.requestLog = []; cf.requestSubmit();
  await until(() => p.d.getElementById('contactSuccess').classList.contains('is-visible'));
  check('valid message: POST /api/inquiries -> 201 and thank-you shown', H.requestLog.some((l) => l === 'POST /api/inquiries -> 201') && p.d.getElementById('contactSuccess').classList.contains('is-visible'), H.requestLog.join(';'));
  check('  ... form emptied and counter reset', cf.elements.message.value === '' && p.d.getElementById('messageCount').textContent === '0 / 2000');
  for (let i = 0; i < 3; i++) {                                   // 2nd, 3rd (allowed) and 4th (throttled) from the same email
    cf.elements.name.value = 'Peter Kamau'; cf.elements.email.value = 'peter.k@example.com'; cf.elements.message.value = `Follow-up message number ${i + 2} please.`; cf.requestSubmit(); await sleep(350);
  }
  check('4th message in an hour: throttle message shown at the top', /several messages/.test(p.d.querySelector('#contactForm [data-form-error]').textContent), p.d.querySelector('#contactForm [data-form-error]').textContent);
  p.w.close();

  p = await open('/contact.html?sent=1');
  check('?sent=1 (after the no-JS form) shows the thank-you', p.d.getElementById('contactSuccess').classList.contains('is-visible'));
  check('  ... and removes ?sent=1 from the address', p.w.location.search === '', p.w.location.search);
  p.w.close();

  console.log(`\nResult: ${H.pass} passed, ${H.fail} failed`);
  process.exit(H.fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS CRASH', e); process.exit(2); });
