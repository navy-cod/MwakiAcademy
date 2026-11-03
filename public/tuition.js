/*
 * tuition.js  -  fills the tuition table from the database via GET /api/programs.
 *
 * PROGRESSIVE ENHANCEMENT: tuition.html already contains the figures as ordinary HTML rows,
 * so the page is useful even if JavaScript or the server fails. When this script succeeds
 * it REPLACES those rows with live data, so the numbers can never drift apart from the
 * database. When it fails, the visitor keeps the saved rows and sees a short notice.
 */
(function () {
  'use strict';

  const body = document.getElementById('tuitionBody');
  const note = document.getElementById('tuitionStatus');
  if (!body) return;

  const { h, formatKes } = MwakiUi;

  function buildRow(program) {
    // Programs with no published fee have null in the database.
    if (program.annualTuitionKes === null) {
      return h('tr', null,
        h('td', null, program.name),
        h('td', { colspan: 2 }, 'Fee to be confirmed - please contact the admissions office.')
      );
    }
    return h('tr', null,
      h('td', null, program.name),
      h('td', null, formatKes(program.annualTuitionKes)),
      h('td', null, formatKes(program.additionalFeesKes))
    );
  }

  async function load() {
    try {
      const { programs } = await MwakiApi.get('/api/programs');
      body.replaceChildren(...programs.map(buildRow));    // swap all old rows for the new ones
    } catch (error) {
      note.textContent = 'Showing the last saved figures because live data could not be loaded.';
      note.hidden = false;
    }
  }

  load();
})();
