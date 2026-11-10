/*
 * admin.js  -  staff page: review admission applications and handle contact messages.
 *
 * Applications and Messages are for staff and admins. Programs and Accounts are for ADMINS only.
 * This page only DISPLAYS what the server sends and asks the server to change things.
 * Who may do what is decided by src/Controllers/AdminController.php; hiding or showing a button
 * here is a convenience, never the protection.
 */
(function () {
  "use strict";

  const {
    h,
    debounce,
    toast,
    formatDate,
    formatKes,
    formatNumber,
    clearFieldErrors,
    showFieldErrors,
    showFormError,
    setBusy,
  } = MwakiUi;
  const $ = (id) => document.getElementById(id);

  const state = {
    apps: { status: "", q: "", page: 1 },
    msgs: { handled: "0", page: 1 },
  };

  const STATUS = {
    pending: { text: "Under review", cls: "status-pill--pending" },
    approved: { text: "Approved", cls: "status-pill--approved" },
    rejected: { text: "Not successful", cls: "status-pill--rejected" },
  };
  const ACTION_LABEL = {
    approved: "Approve",
    rejected: "Reject",
    pending: "Reopen",
  };

  function fail(error) {
    if (error instanceof MwakiApi.ApiError && error.status === 401) {
      window.location.replace(
        "login.html?next=" + encodeURIComponent("admin.html"),
      );
      return;
    }
    toast(error.message || "Something unexpected happened.", "error");
    if (!(error instanceof MwakiApi.ApiError)) console.error(error);
  }

  // ------------------------------------------------------------------ pager (used by both tabs)

  function wirePager(nav, getPage, setPage, reload) {
    nav.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-dir]");
      if (!button || button.disabled) return;
      setPage(getPage() + Number(button.dataset.dir));
      reload();
    });
  }
  function drawPager(nav, meta) {
    const [prev, next] = nav.querySelectorAll("button");
    nav.querySelector(".pager-info").textContent =
      `Page ${meta.page} of ${meta.pages}`;
    prev.disabled = meta.page <= 1;
    next.disabled = meta.page >= meta.pages;
    nav.hidden = meta.total === 0;
  }

  // ------------------------------------------------------------------ applications

  const pill = (status) => {
    const known = STATUS[status];
    return h(
      "span",
      { class: known ? `status-pill ${known.cls}` : "status-pill" },
      known ? known.text : status,
    );
  };

  function detailList(a) {
    const rows = [
      ["Phone", a.phone],
      ["Date of birth", a.dob],
      ["Gender", a.gender || "not given"],
      ["Address", a.address],
      ["Faculty", a.faculty],
      ["Heard about us via", a.howHeard],
      ["Reason for applying", a.motivation],
    ];
    return h(
      "dl",
      { class: "detail-list" },
      rows.flatMap(([label, value]) => [
        h("dt", null, label),
        h("dd", null, value),
      ]),
    );
  }

  function applicationRow(a) {
    // The two actions offered are "the other two statuses", so a row can always move to any status.
    const targets = ["approved", "rejected", "pending"].filter(
      (status) => status !== a.status,
    );
    return h(
      "tr",
      { "data-id": a.id },
      h("td", null, h("span", { class: "reference" }, a.reference)),
      h(
        "td",
        null,
        h("strong", null, a.fullName),
        h("br"),
        // mailto: is safe here only because the server validated this value as an email address.
        h("a", { href: `mailto:${a.email}` }, a.email),
        h(
          "details",
          { class: "applicant-details" },
          h("summary", null, "Details"),
          detailList(a),
        ),
      ),
      h("td", null, a.program, h("br"), `${a.intakePeriod} ${a.intakeYear}`),
      h("td", null, a.kcseGrade),
      h("td", null, formatDate(a.submittedAt)),
      h("td", null, pill(a.status)),
      h(
        "td",
        { class: "row-actions" },
        targets.map((status) =>
          h(
            "button",
            {
              type: "button",
              class:
                status === "approved"
                  ? "btn btn-small"
                  : "btn btn-outline btn-small",
              "data-action": "set-status",
              "data-status": status,
              "aria-label": `${ACTION_LABEL[status]} application ${a.reference}`,
            },
            ACTION_LABEL[status],
          ),
        ),
      ),
    );
  }

  let appRequest = null;
  async function loadApplications() {
    if (appRequest) appRequest.abort(); // only the newest request may update the screen
    appRequest = new AbortController();
    try {
      const data = await MwakiApi.get("/api/applications", state.apps, {
        signal: appRequest.signal,
      });
      state.apps.page = data.meta.page;

      $("pendingCount").textContent = data.counts.pending
        ? `${data.counts.pending} pending`
        : "";
      $("appSummary").textContent =
        `${data.meta.total} shown · Under review: ${data.counts.pending} · Approved: ${data.counts.approved} · Not successful: ${data.counts.rejected}`;

      $("appRows").replaceChildren(
        ...(data.applications.length
          ? data.applications.map(applicationRow)
          : [
              h(
                "tr",
                null,
                h(
                  "td",
                  { colspan: 7, class: "empty-note" },
                  "No applications match.",
                ),
              ),
            ]),
      );
      drawPager($("appPager"), data.meta);
    } catch (error) {
      if (error.name !== "AbortError") fail(error);
    }
  }

  // One listener on the table body handles every row's buttons (event delegation).
  $("appRows").addEventListener("click", async (event) => {
    const button = event.target.closest('button[data-action="set-status"]');
    if (!button) return;
    const row = button.closest("tr");
    const reference = row.querySelector(".reference").textContent;
    row.querySelectorAll("button").forEach((b) => {
      b.disabled = true;
    }); // stop double clicks while we wait

    try {
      await MwakiApi.patch(`/api/applications/${row.dataset.id}`, {
        status: button.dataset.status,
      });
      toast(`${reference}: ${STATUS[button.dataset.status].text}`, "success");
    } catch (error) {
      fail(error);
    }
    loadApplications(); // redraw from the server's truth, success or not
  });

  $("appStatus").addEventListener("change", () => {
    state.apps.status = $("appStatus").value;
    state.apps.page = 1;
    loadApplications();
  });
  $("appSearch").addEventListener(
    "input",
    debounce(() => {
      state.apps.q = $("appSearch").value.trim();
      state.apps.page = 1;
      loadApplications();
    }, 300),
  );
  wirePager(
    $("appPager"),
    () => state.apps.page,
    (n) => {
      state.apps.page = n;
    },
    loadApplications,
  );

  // ------------------------------------------------------------------ messages

  function messageCard(m) {
    return h(
      "article",
      {
        class: "message-card" + (m.handled ? " is-handled" : ""),
        "data-id": m.id,
      },
      h(
        "header",
        { class: "message-head" },
        h("strong", null, m.name),
        h("a", { href: `mailto:${m.email}` }, m.email),
        m.phone ? h("span", null, m.phone) : null,
        h("time", { datetime: m.receivedAt }, formatDate(m.receivedAt)),
        m.handled
          ? h("span", { class: "status-pill status-pill--approved" }, "Handled")
          : null,
      ),
      h("p", { class: "message-body" }, m.message), // text node; CSS keeps the line breaks
      h(
        "button",
        {
          type: "button",
          class: m.handled ? "btn btn-outline btn-small" : "btn btn-small",
          "data-action": "toggle-handled",
          "data-handled": String(!m.handled),
        },
        m.handled ? "Mark as new" : "Mark as handled",
      ),
    );
  }

  let msgRequest = null;
  async function loadMessages() {
    if (msgRequest) msgRequest.abort();
    msgRequest = new AbortController();
    try {
      const data = await MwakiApi.get("/api/inquiries", state.msgs, {
        signal: msgRequest.signal,
      });
      state.msgs.page = data.meta.page;

      $("newCount").textContent = data.counts.new
        ? `${data.counts.new} new`
        : "";
      $("msgSummary").textContent =
        `${data.meta.total} shown · New: ${data.counts.new} · Handled: ${data.counts.handled}`;
      $("messageList").replaceChildren(
        ...(data.inquiries.length
          ? data.inquiries.map(messageCard)
          : [h("p", { class: "empty-note" }, "No messages here.")]),
      );
      drawPager($("msgPager"), data.meta);
    } catch (error) {
      if (error.name !== "AbortError") fail(error);
    }
  }

  $("messageList").addEventListener("click", async (event) => {
    const button = event.target.closest('button[data-action="toggle-handled"]');
    if (!button) return;
    const card = button.closest(".message-card");
    button.disabled = true;
    try {
      // PATCH: change just one field. The value goes as a real boolean (true/false), not text.
      await MwakiApi.patch(`/api/inquiries/${card.dataset.id}`, {
        handled: button.dataset.handled === "true",
      });
    } catch (error) {
      fail(error);
    }
    loadMessages();
  });
  $("msgFilter").addEventListener("change", () => {
    state.msgs.handled = $("msgFilter").value;
    state.msgs.page = 1;
    loadMessages();
  });
  wirePager(
    $("msgPager"),
    () => state.msgs.page,
    (n) => {
      state.msgs.page = n;
    },
    loadMessages,
  );

  // ------------------------------------------------------------------ overview (staff and admins)

  function drawOverview(stats) {
    $("ovStudents").textContent = formatNumber(stats.students.total);
    $("ovPending").textContent = formatNumber(stats.applications.pending);
    $("ovInquiries").textContent = formatNumber(stats.inquiries.unhandled);
    const avg = stats.students.averageGrade;
    $("ovAverage").textContent = avg === null ? "–" : `${avg}%`;
  }

  async function loadOverview() {
    try {
      drawOverview(await MwakiApi.get("/api/stats"));
    } catch (error) {
      if (error instanceof MwakiApi.ApiError && error.status === 401) {
        window.location.replace(
          "login.html?next=" + encodeURIComponent("admin.html"),
        );
        return;
      }
      // Non-fatal: the overview keeps its dashes. Log for the developer and move on.
      console.warn("Could not load overview statistics:", error.message);
    }
  }

  // The "Jump to" cards on the overview open one of the existing tabs.
  // (The id is built from a fixed dataset value, so nothing user-supplied goes into the lookup.)
  const overviewPanel = $("overview");
  if (overviewPanel) {
    overviewPanel.addEventListener("click", (event) => {
      const card = event.target.closest("[data-goto]");
      if (!card) return;
      const tab = $("tab-" + card.dataset.goto);
      if (!tab || tab.hidden) return; // staff never see Programs/Accounts tabs
      selectTab(tab, true);
      $("tabList").scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }
  // ------------------------------------------------------------------ programs (admins only)

  const programForm = $("programForm");
  let editingProgramId = null; // null = the form is adding; a number = it is editing that program
  let programsById = new Map();

  function programRow(p) {
    const money =
      p.annualTuitionKes === null
        ? "Not published"
        : `${formatKes(p.annualTuitionKes)} + ${formatKes(p.additionalFeesKes)}`;
    return h(
      "tr",
      { "data-id": p.id },
      h("td", null, h("strong", null, p.name)),
      h("td", null, p.faculty),
      h("td", null, money),
      h("td", null, p.minKcse),
      h("td", null, p.intakes.join(", ")),
      h(
        "td",
        { class: "row-actions" },
        h(
          "button",
          {
            type: "button",
            class: "btn btn-outline btn-small",
            "data-action": "edit",
            "aria-label": `Edit ${p.name}`,
          },
          "Edit",
        ),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-outline btn-small",
            "data-action": "delete",
            "aria-label": `Delete ${p.name}`,
          },
          "Delete",
        ),
      ),
    );
  }

  async function loadPrograms() {
    try {
      const { programs } = await MwakiApi.get("/api/programs");
      programsById = new Map(programs.map((p) => [p.id, p]));
      $("programRows").replaceChildren(...programs.map(programRow));
      $("programSummary").textContent = `${programs.length} programs`;
      // Suggest the existing faculty names while typing a new one (a <datalist> is an HTML autocomplete list).
      const faculties = [...new Set(programs.map((p) => p.faculty))].sort();
      $("facultyList").replaceChildren(
        ...faculties.map((name) => h("option", { value: name })),
      );
    } catch (error) {
      fail(error);
    }
  }

  function openProgramForm(program) {
    clearFieldErrors(programForm);
    programForm.reset();
    editingProgramId = program ? program.id : null;
    $("programFormTitle").textContent = program
      ? `Edit ${program.name}`
      : "Add program";
    $("programSaveBtn").textContent = program ? "Save changes" : "Add program";
    if (program) {
      const f = programForm.elements;
      f.name.value = program.name;
      f.faculty.value = program.faculty;
      f.annualTuitionKes.value = program.annualTuitionKes ?? ""; // ?? means "if null, use ''"
      f.additionalFeesKes.value = program.additionalFeesKes ?? "";
      f.minKcse.value = program.minKcse;
      programForm.querySelectorAll('input[name="intakes"]').forEach((box) => {
        box.checked = program.intakes.includes(box.value);
      });
    }
    $("programFormCard").hidden = false;
    programForm.elements.name.focus();
    $("programFormCard").scrollIntoView?.({
      behavior: "smooth",
      block: "start",
    });
  }
  const closeProgramForm = () => {
    $("programFormCard").hidden = true;
    clearFieldErrors(programForm);
  };

  $("addProgramBtn").addEventListener("click", () => openProgramForm(null));
  $("programCancelBtn").addEventListener("click", closeProgramForm);

  programForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(programForm);
    const f = programForm.elements;
    const numberOrNull = (text) => (text.trim() === "" ? null : Number(text));
    const payload = {
      name: f.name.value,
      faculty: f.faculty.value,
      annualTuitionKes: numberOrNull(f.annualTuitionKes.value),
      additionalFeesKes: numberOrNull(f.additionalFeesKes.value),
      minKcse: f.minKcse.value === "" ? null : f.minKcse.value,
      // The checked boxes become a real JSON list: ["January", "September"].
      intakes: [
        ...programForm.querySelectorAll('input[name="intakes"]:checked'),
      ].map((box) => box.value),
    };

    const editing = editingProgramId !== null;
    setBusy($("programSaveBtn"), true, "Saving…");
    try {
      const { program } = editing
        ? await MwakiApi.put(`/api/programs/${editingProgramId}`, payload)
        : await MwakiApi.post("/api/programs", payload);
      closeProgramForm();
      toast(
        editing
          ? `${program.name} updated.`
          : `${program.name} added. It is already on the admission form and tuition page.`,
        "success",
      );
      await loadPrograms();
    } catch (error) {
      if (!(error instanceof MwakiApi.ApiError)) {
        fail(error);
        return;
      }
      if (error.status === 401) {
        fail(error);
        return;
      }
      // 422 (invalid) and 409 (name taken) both carry per-field messages.
      const hasFieldErrors = Object.keys(error.errors).length > 0;
      if (!(hasFieldErrors && showFieldErrors(programForm, error.errors)))
        showFormError(programForm, error.message);
    } finally {
      setBusy($("programSaveBtn"), false);
    }
  });

  $("programRows").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const program = programsById.get(Number(button.closest("tr").dataset.id));
    if (!program) return;

    if (button.dataset.action === "edit") {
      openProgramForm(program);
      return;
    }
    if (
      !window.confirm(
        `Delete the program "${program.name}"? This cannot be undone.`,
      )
    )
      return;
    try {
      await MwakiApi.delete(`/api/programs/${program.id}`);
      toast(`${program.name} deleted.`, "success");
    } catch (error) {
      // 409 in_use: the message already explains which students/applications still use it.
      if (error instanceof MwakiApi.ApiError && error.status !== 401)
        toast(error.message, "error", 8000);
      else fail(error);
    }
    loadPrograms();
  });

  // ------------------------------------------------------------------ accounts (admins only)

  const accountForm = $("accountForm");
  let resetTarget = null; // null = the form creates an account; an object = it resets that person's password

  function accountRow(u) {
    const other = u.role === "admin" ? "staff" : "admin";
    return h(
      "tr",
      { "data-id": u.id, "data-username": u.username },
      h(
        "td",
        null,
        h("strong", null, u.username),
        u.isYou ? h("span", { class: "you-tag" }, " (you)") : null,
      ),
      h("td", null, h("span", { class: `badge badge--${u.role}` }, u.role)),
      h("td", null, formatDate(u.createdAt)),
      h(
        "td",
        { class: "row-actions" },
        u.isYou
          ? // The server also refuses these on your own account; we just do not offer them.
            h(
              "span",
              { class: "muted" },
              'Use "Change my password" on your Account page',
            )
          : [
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-outline btn-small",
                  "data-action": "toggle-role",
                  "data-role": other,
                  "aria-label": `Make ${u.username} ${other}`,
                },
                `Make ${other}`,
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-outline btn-small",
                  "data-action": "reset",
                  "aria-label": `Reset password for ${u.username}`,
                },
                "Reset password",
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-outline btn-small",
                  "data-action": "delete",
                  "aria-label": `Delete account ${u.username}`,
                },
                "Delete",
              ),
            ],
      ),
    );
  }

  async function loadAccounts() {
    try {
      const { users } = await MwakiApi.get("/api/users");
      $("accountRows").replaceChildren(...users.map(accountRow));
    } catch (error) {
      fail(error);
    }
  }

  function openAccountForm(user) {
    clearFieldErrors(accountForm);
    accountForm.reset();
    resetTarget = user;
    const resetting = user !== null;
    $("accountFormTitle").textContent = resetting
      ? `Reset password for ${user.username}`
      : "Add account";
    $("accountSaveBtn").textContent = resetting
      ? "Set new password"
      : "Create account";
    $("accountPasswordLabel").textContent = resetting
      ? "New password (at least 12 characters)"
      : "Password (at least 12 characters)";
    // When resetting, username and role are not asked for. `disabled` also stops the browser demanding them.
    $("accountUsernameField").hidden = resetting;
    $("accountRoleField").hidden = resetting;
    accountForm.elements.username.disabled = resetting;
    accountForm.elements.role.disabled = resetting;
    $("accountResetNote").hidden = !resetting;
    $("accountFormCard").hidden = false;
    (resetting
      ? accountForm.elements.password
      : accountForm.elements.username
    ).focus();
    $("accountFormCard").scrollIntoView?.({
      behavior: "smooth",
      block: "start",
    });
  }
  const closeAccountForm = () => {
    $("accountFormCard").hidden = true;
    clearFieldErrors(accountForm);
    accountForm.reset();
  };

  $("addAccountBtn").addEventListener("click", () => openAccountForm(null));
  $("accountCancelBtn").addEventListener("click", closeAccountForm);

  accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(accountForm);
    const f = accountForm.elements;
    const resetting = resetTarget !== null;

    setBusy($("accountSaveBtn"), true, "Saving…");
    try {
      if (resetting) {
        await MwakiApi.patch(`/api/users/${resetTarget.id}`, {
          password: f.password.value,
        });
        toast(`Password reset for ${resetTarget.username}.`, "success");
      } else {
        await MwakiApi.post("/api/users", {
          username: f.username.value,
          role: f.role.value,
          password: f.password.value,
        });
        toast(`Account ${f.username.value.trim()} created.`, "success");
      }
      closeAccountForm();
      await loadAccounts();
    } catch (error) {
      if (!(error instanceof MwakiApi.ApiError) || error.status === 401) {
        fail(error);
        return;
      }
      const hasFieldErrors = Object.keys(error.errors).length > 0;
      if (!(hasFieldErrors && showFieldErrors(accountForm, error.errors)))
        showFormError(accountForm, error.message);
    } finally {
      setBusy($("accountSaveBtn"), false);
    }
  });

  $("accountRows").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const row = button.closest("tr");
    const user = { id: Number(row.dataset.id), username: row.dataset.username };

    try {
      if (button.dataset.action === "reset") {
        openAccountForm(user);
        return;
      }
      if (button.dataset.action === "toggle-role") {
        if (
          !window.confirm(
            `Make "${user.username}" ${button.dataset.role === "admin" ? "an admin" : "a staff member"}?`,
          )
        )
          return;
        await MwakiApi.patch(`/api/users/${user.id}`, {
          role: button.dataset.role,
        });
        toast(`${user.username} is now ${button.dataset.role}.`, "success");
      } else if (button.dataset.action === "delete") {
        if (
          !window.confirm(
            `Delete the account "${user.username}"? They will not be able to sign in again.`,
          )
        )
          return;
        await MwakiApi.delete(`/api/users/${user.id}`);
        toast(`Account ${user.username} deleted.`, "success");
      }
    } catch (error) {
      fail(error);
    }
    loadAccounts();
  });

  // ------------------------------------------------------------------ tabs (keyboard accessible)

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const visibleTabs = () => tabs.filter((tab) => !tab.hidden); // staff never see the admin-only tabs
  function selectTab(tab, moveFocus) {
    for (const t of tabs) {
      const active = t === tab;
      t.setAttribute("aria-selected", String(active));
      t.tabIndex = active ? 0 : -1; // only the active tab is in the Tab order; arrows move between tabs
      t.classList.toggle("is-active", active);
      $(t.getAttribute("aria-controls")).hidden = !active;
    }
    if (moveFocus) tab.focus();
  }
  tabs.forEach((tab) =>
    tab.addEventListener("click", () => selectTab(tab, false)),
  );
  $("tabList").addEventListener("keydown", (event) => {
    const shown = visibleTabs();
    const index = shown.indexOf(document.activeElement);
    if (index === -1) return;
    if (event.key === "ArrowRight")
      selectTab(shown[(index + 1) % shown.length], true);
    if (event.key === "ArrowLeft")
      selectTab(shown[(index - 1 + shown.length) % shown.length], true);
  });

  // ------------------------------------------------------------------ start-up

  async function init() {
    let session;
    try {
      session = await MwakiApi.session();
    } catch (error) {
      $("adminSubtitle").textContent = error.message;
      return;
    }
    if (!session.user) {
      window.location.replace(
        "login.html?next=" + encodeURIComponent("admin.html"),
      );
      return;
    }
    // A student role cannot use this page. The APIs would refuse them (403) anyway; this
    // just sends them where they belong instead of showing them error toasts.
    if (session.user.role === "student") {
      window.location.replace("student-portal.html");
      return;
    }
    $("adminSubtitle").textContent =
      `Signed in as ${session.user.username} (${session.user.role}).`;
    $("adminApp").hidden = false;

    // Hiding the admin-only shortcuts from staff is a courtesy; the server refuses them anyway.
    if (session.user.role !== "admin") {
      document.querySelectorAll("[data-admin-only]").forEach((node) => {
        node.hidden = true;
      });
    }

    const jobs = [loadApplications(), loadMessages(), loadOverview()];
    if (session.user.role === "admin") {
      $("tab-programs").hidden = false;
      $("tab-accounts").hidden = false;
      jobs.push(loadPrograms(), loadAccounts());
    }
    await Promise.all(jobs);
  }

  init();
})();
