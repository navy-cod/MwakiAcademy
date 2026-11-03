/*
 * details.js  -  the "My Account" page (details.html): who is signed in, plus summary numbers.
 */
(function () {
  'use strict';

  const { h, toast, formatDate, formatNumber } = MwakiUi;

  const subtitle = document.getElementById('account-subtitle');
  const accountCard = document.getElementById('accountCard');
  const statsSection = document.getElementById('statsSection');
  const statGrid = document.getElementById('statGrid');
  const programRows = document.getElementById('programRows');

  function renderAccount(user) {
    document.getElementById('accountName').textContent = user.username;     // textContent: safe
    document.getElementById('accountRole').textContent = user.role;
    document.getElementById('accountSince').textContent = formatDate(user.createdAt);
    subtitle.textContent = 'You are signed in. Here is your account and a snapshot of the university.';
    accountCard.hidden = false;
  }

  function statCard(label, value) {
    return h('div', { class: 'stat-card' },
      h('span', { class: 'stat-value' }, value),
      h('span', { class: 'stat-label' }, label)
    );
  }

  function renderStats(stats) {
    const average = stats.students.averageGrade;
    statGrid.replaceChildren(
      statCard('Students enrolled', formatNumber(stats.students.total)),
      statCard('Average grade', average === null ? '-' : `${average}%`),
      statCard('Applications pending', formatNumber(stats.applications.pending)),
      statCard('New inquiries', formatNumber(stats.inquiries.unhandled))
    );
    programRows.replaceChildren(...stats.students.byProgram.map((row) =>
      h('tr', null,
        h('td', null, row.program),
        h('td', null, formatNumber(row.students)),
        h('td', null, row.averageGrade === null ? '-' : `${row.averageGrade}%`)
      )
    ));
    statsSection.hidden = false;
  }

  async function init() {
    let session;
    try {
      session = await MwakiApi.session();
    } catch (error) {
      subtitle.textContent = error.message;
      return;
    }

    // Not signed in: send them to the login page, and tell it where to come back to.
    if (!session.user) {
      window.location.replace('login.html?next=' + encodeURIComponent('details.html'));
      return;
    }
    renderAccount(session.user);

    // Two independent things to load; a failure in one should not hide the other.
    try {
      renderStats(await MwakiApi.get('/api/stats'));
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try {
      await MwakiApi.logout();
      window.location.href = 'login.html';
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  init();
})();
