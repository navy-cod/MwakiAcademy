/*
 * admission.js  -  behaviour of admission.html (this file used to be empty).
 *
 * Three jobs:
 *   1. Fill the program list from the API, and make Year / Period depend on the chosen program.
 *   2. Submit the application with fetch(), show server errors beside the right fields,
 *      then show a receipt that can be downloaded as a PDF.
 *   3. "Track your application": look an application up by reference + email.
 */
(function () {
  'use strict';

  const form = document.getElementById('admissionForm');
  if (!form) return;

  const { h, toast, setBusy, clearFieldErrors, showFieldErrors, showFormError, formatDate } = MwakiUi;

  // Grab the elements we use repeatedly ONCE, instead of searching the page every time.
  const submitButton  = form.querySelector('button[type="submit"]');
  const programSelect = form.elements.programId;
  const yearSelect    = form.elements.intakeYear;
  const periodSelect  = form.elements.intakePeriod;
  const gradeSelect   = form.elements.kcseGrade;
  const gradeHint     = document.getElementById('kcseHint');
  const intakeHint    = document.getElementById('intakeHint');
  const formCard      = document.getElementById('applicationFormCard');
  const receipt       = document.getElementById('applicationReceipt');
  const successBox    = document.getElementById('successMessage');

  let programs = [];          // filled from the API
  let lastApplication = null; // the receipt on screen, needed for the PDF file name

  // =============================================================== 1. programs and intakes

  /** Build the <option> list for a <select>. `items` are {value, label} objects. */
  function options(placeholder, items) {
    return [h('option', { value: '' }, placeholder), ...items.map((i) => h('option', { value: i.value }, i.label))];
  }

  function selectedProgram() {
    const id = Number(programSelect.value);
    return programs.find((program) => program.id === id) || null;
  }

  /*
   * CONCEPT: async/await with error handling. `await` pauses until the server answers.
   * If it fails (server down, 500...) the code jumps into `catch`, so the page can explain
   * the problem instead of silently showing an empty list.
   */
  async function loadPrograms() {
    try {
      const data = await MwakiApi.get('/api/programs');
      programs = data.programs;

      // Group programs under their faculty with <optgroup>. A Map remembers insertion order.
      const byFaculty = new Map();
      for (const program of programs) {
        if (!byFaculty.has(program.faculty)) byFaculty.set(program.faculty, []);
        byFaculty.get(program.faculty).push(program);
      }
      const groups = [...byFaculty].map(([faculty, list]) =>
        h('optgroup', { label: faculty }, list.map((p) => h('option', { value: p.id }, p.name)))
      );
      programSelect.replaceChildren(h('option', { value: '' }, '--Select Program--'), ...groups);
    } catch (error) {
      showFormError(form, `We could not load the list of programs. ${error.message}`);
      submitButton.disabled = true;
    }
  }

  function resetIntakeSelects() {
    yearSelect.replaceChildren(...options('--Select Year--', []));
    periodSelect.replaceChildren(...options('--Select Period--', []));
    intakeHint.hidden = true;
  }

  /*
   * CONCEPT: dependent drop-downs. Choosing a program changes which years are offered, and
   * choosing a year changes which periods are offered. We listen for the 'change' event and
   * rebuild the next <select>. The lists come from the server (upcomingIntakes), so they can
   * never offer an intake that has already started.
   */
  programSelect.addEventListener('change', () => {
    resetIntakeSelects();
    const program = selectedProgram();
    if (program) {
      const years = [...new Set(program.upcomingIntakes.map((intake) => intake.year))];
      if (years.length === 0) {
        intakeHint.textContent = 'No intakes are currently open for this program. Please check back later.';
        intakeHint.hidden = false;
      } else {
        yearSelect.replaceChildren(...options('--Select Year--', years.map((y) => ({ value: y, label: String(y) }))));
      }
    }
    updateGradeHint();
  });

  yearSelect.addEventListener('change', () => {
    const program = selectedProgram();
    const year = Number(yearSelect.value);
    const open = program && year ? program.upcomingIntakes.filter((intake) => intake.year === year) : [];
    periodSelect.replaceChildren(...options('--Select Period--', open.map((i) => ({ value: i.period, label: `${i.period} Intake` }))));
  });

  /*
   * A friendly early warning. This check is ONLY a convenience: the server repeats it and has the
   * final say (src/Controllers/ApplicationController.php). A visitor could remove this code in
   * their browser, so it can never be the real rule. The grade options are listed best to worst
   * in the HTML, so a grade further down the list than the program's minimum is too low.
   */
  function updateGradeHint() {
    gradeHint.hidden = true;
    const program = selectedProgram();
    const grade = gradeSelect.value;
    if (!program || !grade) return;

    const order = [...gradeSelect.options].map((option) => option.value).filter(Boolean);
    const needed = order.indexOf(program.minKcse);
    if (needed !== -1 && order.indexOf(grade) > needed) {
      gradeHint.textContent = `${program.name} requires a KCSE mean grade of ${program.minKcse} or above. An application with a lower grade will not be accepted.`;
      gradeHint.hidden = false;
    }
  }
  gradeSelect.addEventListener('change', updateGradeHint);

  // Small conveniences: limit the date picker, and show how many characters are left.
  function toDateInput(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }
  const youngest = new Date();
  youngest.setFullYear(youngest.getFullYear() - 15);       // the server requires applicants to be 15+
  form.elements.dob.max = toDateInput(youngest);
  form.elements.dob.min = '1900-01-01';

  const motivation = form.elements.motivation;
  const counter = document.getElementById('messageCount');
  const updateCounter = () => { counter.textContent = `${motivation.value.length} / ${motivation.maxLength}`; };
  motivation.addEventListener('input', updateCounter);

  // =============================================================== 2. submitting

  // A blank <select> gives "" ; the API wants null (or a number) for "nothing chosen".
  const textOrNull = (value) => (value === '' ? null : value);
  const numberOrNull = (value) => (value === '' ? null : Number(value));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();               // stop the browser's own page-reloading submit
    clearFieldErrors(form);

    const payload = {
      fullName:     form.elements.fullName.value,
      email:        form.elements.email.value,
      phone:        form.elements.phone.value,
      gender:       textOrNull(form.elements.gender.value),    // RadioNodeList.value = the checked one
      dob:          form.elements.dob.value,
      address:      form.elements.address.value,
      programId:    numberOrNull(programSelect.value),
      kcseGrade:    textOrNull(gradeSelect.value),
      intakeYear:   numberOrNull(yearSelect.value),
      intakePeriod: textOrNull(periodSelect.value),
      motivation:   motivation.value,
      howHeard:     textOrNull(form.elements.howHeard.value),
    };

    setBusy(submitButton, true, 'Submitting…');
    try {
      const { application } = await MwakiApi.post('/api/applications', payload);
      showReceipt(application);
    } catch (error) {
      handleSubmitError(error);
    } finally {
      setBusy(submitButton, false);       // runs whether the request worked or not
    }
  });

  function handleSubmitError(error) {
    if (!(error instanceof MwakiApi.ApiError)) {
      toast('Something unexpected happened.', 'error');
      console.error(error);
      return;
    }
    // 422 = problems with specific fields -> show each beside its field.
    // 409 duplicate / 429 / network / anything else -> one message at the top of the form.
    const shownOnFields = error.status === 422 && showFieldErrors(form, error.errors);
    if (!shownOnFields) {
      showFormError(form, error.message);
      form.querySelector('[data-form-error]').scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }
  }

  // ------------------------------------------------------------------ the receipt

  const STATUS = {
    pending:  { text: 'Under review',   cls: 'status-pill--pending' },
    approved: { text: 'Approved',       cls: 'status-pill--approved' },
    rejected: { text: 'Not successful', cls: 'status-pill--rejected' },
  };
  function statusPill(status) {
    const known = STATUS[status];
    return h('span', { class: known ? `status-pill ${known.cls}` : 'status-pill' }, known ? known.text : status);
  }

  /**
   * SECURITY: everything shown here is passed to h(), which uses text nodes. The name and email
   * are user-supplied, so building this with innerHTML would let someone type markup into the
   * form and have it run on the receipt page.
   */
  function showReceipt(application) {
    lastApplication = application;
    const rows = [
      ['Reference number', h('span', { class: 'reference' }, application.reference)],
      ['Name', application.fullName],
      ['Email', application.email],
      ['Program', `${application.program} (${application.faculty})`],
      ['KCSE mean grade', application.kcseGrade],
      ['Intake', `${application.intakePeriod} ${application.intakeYear}`],
      ['Status', statusPill(application.status)],
      ['Submitted', formatDate(application.submittedAt)],
    ];
    document.getElementById('receiptList')
      .replaceChildren(...rows.flatMap(([label, value]) => [h('dt', null, label), h('dd', null, value)]));

    document.getElementById('successText').textContent =
      `Application submitted successfully! Your reference number is ${application.reference}. You can now download your application form.`;
    successBox.classList.add('is-visible');
    formCard.hidden = true;
    receipt.hidden = false;
    successBox.focus();                   // move keyboard/screen-reader focus to the good news
    successBox.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  /*
   * PDF. html2pdf (loaded from a CDN in admission.html) draws the receipt into a PDF file.
   * Two honest caveats: it is a third-party script, and it may be blocked (offline, ad-blocker).
   * So if it is missing or fails, we fall back to the browser's own print dialog, whose
   * "Save as PDF" option does the same job. style.css hides everything except the receipt when printing.
   */
  async function downloadPdf() {
    if (!lastApplication) return;
    if (typeof window.html2pdf !== 'function') {
      window.print();
      return;
    }
    try {
      await window.html2pdf()
        .set({
          margin: 12,
          filename: `Mwaki-Application-${lastApplication.reference}.pdf`,
          html2canvas: { scale: 2 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(document.getElementById('applicationSummary'))
        .save();
    } catch (error) {
      toast('Could not create the PDF here. Choose "Save as PDF" in the print window instead.', 'info');
      window.print();
    }
  }
  document.getElementById('downloadPDFBtn').addEventListener('click', downloadPdf);

  function startAnotherApplication() {
    form.reset();                          // puts every field back to its starting value ...
    clearFieldErrors(form);
    resetIntakeSelects();                  // ... but we rebuilt these two selects, so reset them too
    gradeHint.hidden = true;
    updateCounter();
    receipt.hidden = true;
    successBox.classList.remove('is-visible');
    formCard.hidden = false;
    form.elements.fullName.focus();
  }
  document.getElementById('newApplicationBtn').addEventListener('click', startAnotherApplication);

  // =============================================================== 3. tracking

  const trackForm = document.getElementById('trackForm');
  const trackResult = document.getElementById('trackResult');
  const trackButton = trackForm.querySelector('button[type="submit"]');

  trackForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(trackForm);
    trackResult.hidden = true;

    setBusy(trackButton, true, 'Checking…');
    try {
      // GET with a query string. MwakiApi.get() escapes the values (URLSearchParams).
      const { application } = await MwakiApi.get('/api/applications/status', {
        ref: trackForm.elements.ref.value.trim().toUpperCase(),
        email: trackForm.elements.email.value.trim(),
      });
      trackResult.replaceChildren(
        h('p', null, 'Status: ', statusPill(application.status)),
        h('p', null, `Reference: ${application.reference}`),
        h('p', null, `Program: ${application.program}`),
        h('p', null, `Intake: ${application.intakePeriod} ${application.intakeYear}`),
        h('p', null, `Submitted: ${formatDate(application.submittedAt)}`)
      );
      trackResult.hidden = false;
    } catch (error) {
      if (!(error instanceof MwakiApi.ApiError)) { toast('Something unexpected happened.', 'error'); console.error(error); return; }
      const shown = error.status === 422 && showFieldErrors(trackForm, error.errors);
      if (!shown) showFormError(trackForm, error.message);
    } finally {
      setBusy(trackButton, false);
    }
  });

  // =============================================================== start-up
  resetIntakeSelects();
  updateCounter();
  loadPrograms();
})();
