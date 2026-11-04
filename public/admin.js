/*
 * admin.js  -  staff page: review admission applications and handle contact messages.
 *
 * This page only DISPLAYS what the server sends and asks the server to change things.
 * Who may do what is decided by src/Controllers/AdminController.php; hiding or showing a button
 * here is a convenience, never the protection.
 */
(function () {
  'use strict';

  const { h, debounce, toast, formatDate } = MwakiUi;
  const $ = (id) => document.getElementById(id);

  const state = {
    apps: { status: '', q: '', page: 1 },
    msgs: { handled: '0', page: 1 },
  };

  const STATUS = {
    pending:  { text: 'Under review',   cls: 'status-pill--pending' },
    approved: { text: 'Approved',       cls: 'status-pill--approved' },
    rejected: { text: 'Not successful', cls: 'status-pill--rejected' },
  };
  const ACTION_LABEL = { approved: 'Approve', rejected: 'Reject', pending: 'Reopen' };

  function fail(error) {
    if (error instanceof MwakiApi.ApiError && error.status === 401) {
      window.location.replace('login.html?next=' + encodeURIComponent('admin.html'));
      return;
    }
    toast(error.message || 'Something unexpected happened.', 'error');
    if (!(error instanceof MwakiApi.ApiError)) console.error(error);
  }

  // ------------------------------------------------------------------ pager (used by both tabs)

  function wirePager(nav, getPage, setPage, reload) {
    nav.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-dir]');
      if (!button || button.disabled) return;
      setPage(getPage() + Number(button.dataset.dir));
      reload();
    });
  }
  function drawPager(nav, meta) {
    const [prev, next] = nav.querySelectorAll('button');
    nav.querySelector('.pager-info').textContent = `Page ${meta.page} of ${meta.pages}`;
    prev.disabled = meta.page <= 1;
    next.disabled = meta.page >= meta.pages;
    nav.hidden = meta.total === 0;
  }

  // ------------------------------------------------------------------ applications

  const pill = (status) => {
    const known = STATUS[status];
    return h('span', { class: known ? `status-pill ${known.cls}` : 'status-pill' }, known ? known.text : status);
  };

  function detailList(a) {
    const rows = [
      ['Phone', a.phone], ['Date of birth', a.dob], ['Gender', a.gender || 'not given'], ['Address', a.address],
      ['Faculty', a.faculty], ['Heard about us via', a.howHeard], ['Reason for applying', a.motivation],
    ];
    return h('dl', { class: 'detail-list' }, rows.flatMap(([label, value]) => [h('dt', null, label), h('dd', null, value)]));
  }

  function applicationRow(a) {
    // The two actions offered are "the other two statuses", so a row can always move to any status.
    const targets = ['approved', 'rejected', 'pending'].filter((status) => status !== a.status);
    return h('tr', { 'data-id': a.id },
      h('td', null, h('span', { class: 'reference' }, a.reference)),
      h('td', null,
        h('strong', null, a.fullName), h('br'),
        // mailto: is safe here only because the server validated this value as an email address.
        h('a', { href: `mailto:${a.email}` }, a.email),
        h('details', { class: 'applicant-details' }, h('summary', null, 'Details'), detailList(a))),
      h('td', null, a.program, h('br'), `${a.intakePeriod} ${a.intakeYear}`),
      h('td', null, a.kcseGrade),
      h('td', null, formatDate(a.submittedAt)),
      h('td', null, pill(a.status)),
      h('td', { class: 'row-actions' }, targets.map((status) =>
        h('button', {
          type: 'button',
          class: status === 'approved' ? 'btn btn-small' : 'btn btn-outline btn-small',
          'data-action': 'set-status', 'data-status': status,
          'aria-label': `${ACTION_LABEL[status]} application ${a.reference}`,
        }, ACTION_LABEL[status]))));
  }

  let appRequest = null;
  async function loadApplications() {
    if (appRequest) appRequest.abort();                    // only the newest request may update the screen
    appRequest = new AbortController();
    try {
      const data = await MwakiApi.get('/api/applications', state.apps, { signal: appRequest.signal });
      state.apps.page = data.meta.page;

      $('pendingCount').textContent = data.counts.pending ? `${data.counts.pending} pending` : '';
      $('appSummary').textContent =
        `${data.meta.total} shown · Under review: ${data.counts.pending} · Approved: ${data.counts.approved} · Not successful: ${data.counts.rejected}`;

      $('appRows').replaceChildren(...(data.applications.length
        ? data.applications.map(applicationRow)
        : [h('tr', null, h('td', { colspan: 7, class: 'empty-note' }, 'No applications match.'))]));
      drawPager($('appPager'), data.meta);
    } catch (error) {
      if (error.name !== 'AbortError') fail(error);
    }
  }

  // One listener on the table body handles every row's buttons (event delegation).
  $('appRows').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action="set-status"]');
    if (!button) return;
    const row = button.closest('tr');
    const reference = row.querySelector('.reference').textContent;
    row.querySelectorAll('button').forEach((b) => { b.disabled = true; });   // stop double clicks while we wait

    try {
      await MwakiApi.patch(`/api/applications/${row.dataset.id}`, { status: button.dataset.status });
      toast(`${reference}: ${STATUS[button.dataset.status].text}`, 'success');
    } catch (error) {
      fail(error);
    }
    loadApplications();                                    // redraw from the server's truth, success or not
  });

  $('appStatus').addEventListener('change', () => { state.apps.status = $('appStatus').value; state.apps.page = 1; loadApplications(); });
  $('appSearch').addEventListener('input', debounce(() => { state.apps.q = $('appSearch').value.trim(); state.apps.page = 1; loadApplications(); }, 300));
  wirePager($('appPager'), () => state.apps.page, (n) => { state.apps.page = n; }, loadApplications);

  // ------------------------------------------------------------------ messages

  function messageCard(m) {
    return h('article', { class: 'message-card' + (m.handled ? ' is-handled' : ''), 'data-id': m.id },
      h('header', { class: 'message-head' },
        h('strong', null, m.name),
        h('a', { href: `mailto:${m.email}` }, m.email),
        m.phone ? h('span', null, m.phone) : null,
        h('time', { datetime: m.receivedAt }, formatDate(m.receivedAt)),
        m.handled ? h('span', { class: 'status-pill status-pill--approved' }, 'Handled') : null),
      h('p', { class: 'message-body' }, m.message),        // text node; CSS keeps the line breaks
      h('button', {
        type: 'button', class: m.handled ? 'btn btn-outline btn-small' : 'btn btn-small',
        'data-action': 'toggle-handled', 'data-handled': String(!m.handled),
      }, m.handled ? 'Mark as new' : 'Mark as handled'));
  }

  let msgRequest = null;
  async function loadMessages() {
    if (msgRequest) msgRequest.abort();
    msgRequest = new AbortController();
    try {
      const data = await MwakiApi.get('/api/inquiries', state.msgs, { signal: msgRequest.signal });
      state.msgs.page = data.meta.page;

      $('newCount').textContent = data.counts.new ? `${data.counts.new} new` : '';
      $('msgSummary').textContent = `${data.meta.total} shown · New: ${data.counts.new} · Handled: ${data.counts.handled}`;
      $('messageList').replaceChildren(...(data.inquiries.length
        ? data.inquiries.map(messageCard)
        : [h('p', { class: 'empty-note' }, 'No messages here.')]));
      drawPager($('msgPager'), data.meta);
    } catch (error) {
      if (error.name !== 'AbortError') fail(error);
    }
  }

  $('messageList').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action="toggle-handled"]');
    if (!button) return;
    const card = button.closest('.message-card');
    button.disabled = true;
    try {
      // PATCH: change just one field. The value goes as a real boolean (true/false), not text.
      await MwakiApi.patch(`/api/inquiries/${card.dataset.id}`, { handled: button.dataset.handled === 'true' });
    } catch (error) {
      fail(error);
    }
    loadMessages();
  });
  $('msgFilter').addEventListener('change', () => { state.msgs.handled = $('msgFilter').value; state.msgs.page = 1; loadMessages(); });
  wirePager($('msgPager'), () => state.msgs.page, (n) => { state.msgs.page = n; }, loadMessages);

  // ------------------------------------------------------------------ tabs (keyboard accessible)

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function selectTab(tab, moveFocus) {
    for (const t of tabs) {
      const active = t === tab;
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;                          // only the active tab is in the Tab order; arrows move between tabs
      t.classList.toggle('is-active', active);
      $(t.getAttribute('aria-controls')).hidden = !active;
    }
    if (moveFocus) tab.focus();
  }
  tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab, false)));
  $('tabList').addEventListener('keydown', (event) => {
    const index = tabs.indexOf(document.activeElement);
    if (index === -1) return;
    if (event.key === 'ArrowRight') selectTab(tabs[(index + 1) % tabs.length], true);
    if (event.key === 'ArrowLeft') selectTab(tabs[(index - 1 + tabs.length) % tabs.length], true);
  });

  // ------------------------------------------------------------------ start-up

  async function init() {
    let session;
    try {
      session = await MwakiApi.session();
    } catch (error) {
      $('adminSubtitle').textContent = error.message;
      return;
    }
    if (!session.user) {
      window.location.replace('login.html?next=' + encodeURIComponent('admin.html'));
      return;
    }
    $('adminSubtitle').textContent = `Signed in as ${session.user.username} (${session.user.role}). Review applications and answer messages.`;
    $('adminApp').hidden = false;
    // Load both tabs at once so both badges are filled in immediately.
    await Promise.all([loadApplications(), loadMessages()]);
  }

  init();
})();
