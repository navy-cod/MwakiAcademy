/*
 * e_students/students.js  -  the student manager.
 *
 * BEFORE (your original): the students lived in a JavaScript array loaded from students.json. Every
 * add, edit and delete changed that array only, so a page refresh erased all your work.
 * NOW: the database is the source of truth. This script is only a VIEW of it:
 *      user action -> fetch() -> PHP validates + saves -> JSON answer -> redraw the screen.
 * Only code that comes AFTER a successful server answer changes what the user sees.
 */
(function () {
  "use strict";

  const {
    h,
    debounce,
    clearFieldErrors,
    showFieldErrors,
    showFormError,
    setBusy,
  } = MwakiUi;
  const $ = (id) => document.getElementById(id);

  // Elements used repeatedly are looked up once.
  const el = {
    list: $("studentList"),
    detail: $("studentDetail"),
    pagination: $("pagination"),
    pageInfo: $("pageInfo"),
    prev: $("prevPage"),
    next: $("nextPage"),
    total: $("totalStudents"),
    average: $("avgGrade"),
    search: $("searchInput"),
    sort: $("sortSelect"),
    add: $("addBtn"),
    headerUser: $("headerUser"),
    userName: $("userName"),
    logout: $("logoutBtn"),
    modal: $("studentModal"),
    form: $("studentForm"),
    modalTitle: $("modalTitle"),
    save: $("saveBtn"),
    cancel: $("cancelBtn"),
    toasts: $("toastContainer"),
  };

  /*
   * CONCEPT: application state. Everything the screen shows is derived from this one object.
   * The pattern: change state -> call render() -> the screen matches the state.
   * (Frameworks such as React automate exactly this idea.)
   */
  const state = {
    user: null,
    students: [], // the CURRENT PAGE of results
    meta: null, // {total, page, perPage, pages} for the current search
    selected: null, // the student shown in the right-hand panel
    keepSelection: false, // true right after add/edit, so the saved student stays shown even if it is on another page
    query: { q: "", sort: "name", page: 1 },
    editingId: null, // null = the modal is adding; a number = it is editing that student
    opener: null, // the element that opened the modal, so focus can return to it
  };

  const LOGIN_URL =
    "../login.html?next=" + encodeURIComponent("e_students/students.html");

  // ------------------------------------------------------------------ messages

  function notify(message, type = "success") {
    const icons = { success: "✓", warning: "⚠", error: "✕", info: "ℹ" };
    const toast = h(
      "div",
      { class: `toast toast-${type}` },
      h("span", { class: "toast-icon" }, icons[type] || ""),
      " ",
      h("span", null, message),
    );
    el.toasts.append(toast); // message goes in as TEXT (see ui.js h())
    setTimeout(() => {
      toast.classList.add("hiding");
      setTimeout(() => toast.remove(), 500);
    }, 3000);
  }

  function handleError(error) {
    if (error instanceof MwakiApi.ApiError) {
      if (error.status === 401) {
        // session ended: sign in again
        window.location.replace(LOGIN_URL);
        return;
      }
      notify(error.message, error.status === 403 ? "warning" : "error");
      return;
    }
    console.error(error);
    notify("Something unexpected happened.", "error");
  }

  // ------------------------------------------------------------------ small helpers

  function gradeLetter(percentage) {
    if (percentage >= 80) return "A (Excellent)";
    if (percentage >= 75) return "A- (Very Good)";
    if (percentage >= 70) return "B+ (Good)";
    if (percentage >= 65) return "B (Above Average)";
    if (percentage >= 60) return "B- (Satisfactory)";
    if (percentage >= 55) return "C+ (Fair)";
    if (percentage >= 50) return "C (Pass)";
    if (percentage >= 45) return "C- (Low Pass)";
    if (percentage >= 40) return "D+ (Marginal)";
    if (percentage >= 35) return "D (Fail)";
    return "E (Poor)";
  }

  const fullName = (s) => `${s.firstName} ${s.lastName}`;
  const canDelete = () => state.user && state.user.role === "admin";
  const canCreateLogin = () => state.user && state.user.role === "admin";
  const canResetLogin = () =>
    state.user && (state.user.role === "admin" || state.user.role === "staff"); // only a hint for the UI: the SERVER decides

  /**
   * A photo, or the student's initials when there is none or it fails to load.
   * The old page used `onerror="this.src='https://i.pravatar.cc/...random...'"`: random pictures that
   * changed on every redraw, and an endless loop when the fallback failed too. Initials need no network.
   */
  function avatar(student, className, tag = "span") {
    const initials = () =>
      h(
        tag,
        { class: `${className} initials`, "aria-hidden": "true" },
        (student.firstName[0] + student.lastName[0]).toUpperCase(),
      );
    if (!student.imageUrl) return initials();
    const img = h("img", { src: student.imageUrl, alt: "", class: className }); // alt="" : decorative, the name is next to it
    img.addEventListener("error", () => img.replaceWith(initials()), {
      once: true,
    }); // { once: true } = runs at most once, so no loop
    return img;
  }

  // ------------------------------------------------------------------ rendering

  function renderStats(stats) {
    el.total.textContent = stats.total;
    el.average.textContent =
      stats.averageGrade === null ? "-" : `${Math.round(stats.averageGrade)}%`;
  }

  function renderList() {
    if (state.students.length === 0) {
      const text = state.query.q
        ? "No students match your search."
        : "No students yet.";
      el.list.replaceChildren(h("div", { class: "no-results" }, text));
      return;
    }
    el.list.replaceChildren(
      ...state.students.map((student) => {
        const isSelected =
          state.selected !== null && state.selected.id === student.id;
        const name = fullName(student);
        return h(
          "div",
          {
            class: "student-item" + (isSelected ? " selected" : ""),
            "data-id": student.id,
          },
          h(
            "button",
            {
              type: "button",
              class: "student-item-name student-select",
              "data-action": "select",
              "aria-current": isSelected ? "true" : null,
            },
            avatar(student, "student-item-avatar"),
            `${name} (${student.studentCode})`,
          ),
          h(
            "span",
            { class: "student-item-actions" },
            h(
              "button",
              {
                type: "button",
                class: "student-edit",
                "data-action": "edit",
                "aria-label": `Edit ${name}`,
                title: "Edit",
              },
              "✎",
            ),
            canDelete()
              ? h(
                  "button",
                  {
                    type: "button",
                    class: "student-delete",
                    "data-action": "delete",
                    "aria-label": `Delete ${name}`,
                    title: "Delete",
                  },
                  "✕",
                )
              : null,
          ),
        );
      }),
    );
  }

  function renderDetail() {
    const s = state.selected;
    if (!s) {
      el.detail.replaceChildren(
        h(
          "div",
          { class: "empty-state" },
          h("div", { class: "empty-state-icon" }, "🎓"),
          h(
            "div",
            { class: "empty-state-text" },
            "Select a student to view details",
          ),
        ),
      );
      return;
    }
    const born = new Date(`${s.dob}T00:00:00`).toLocaleDateString("en-KE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    el.detail.replaceChildren(
      avatar(s, "detail-avatar", "div"),
      h("span", { class: "student-detail-heading" }, fullName(s)),
      h("span", { class: "grade" }, `🎯 ${s.grade}% - ${gradeLetter(s.grade)}`),
      h("span", null, `🎓 Student ID: ${s.studentCode}`),
      h("span", null, `📧 ${s.email}`),
      h("span", null, `📞 ${s.phone}`),
      h("span", null, `📚 Course: ${s.program}`),
      h("span", null, `📍 ${s.address}`),
      h("span", null, `🎂 ${born} (${s.age} years old)`),
      s.login
        ? h("span", null, `🔑 Login username: ${s.login.username}`)
        : null,
      h(
        "div",
        { class: "student-detail-actions" },
        h(
          "button",
          {
            type: "button",
            class: "edit-detail-btn",
            "data-action": "edit",
            "data-id": s.id,
          },
          "✏️ Edit Student",
        ),
        canDelete()
          ? h(
              "button",
              {
                type: "button",
                class: "delete-detail-btn",
                "data-action": "delete",
                "data-id": s.id,
              },
              "🗑️ Delete Student",
            )
          : null,
        // Login management:
        //   - no login yet -> admins can create one
        //   - has a login   -> admins and staff can reset the password
        !s.login && canCreateLogin()
          ? h(
              "button",
              {
                type: "button",
                class: "login-action-btn",
                "data-action": "create-login",
                "data-id": s.id,
              },
              "👤 Create login",
            )
          : null,
        s.login && canResetLogin()
          ? h(
              "button",
              {
                type: "button",
                class: "login-action-btn",
                "data-action": "reset-password",
                "data-id": s.id,
              },
              "🔑 Reset login password",
            )
          : null,
      ),
    );
  }

  function renderPagination() {
    const m = state.meta;
    el.pagination.hidden = !m || m.total === 0;
    if (el.pagination.hidden) return;
    el.pageInfo.textContent = `Page ${m.page} of ${m.pages} · ${m.total} student${m.total === 1 ? "" : "s"}`;
    el.prev.disabled = m.page <= 1;
    el.next.disabled = m.page >= m.pages;
  }

  function render() {
    renderList();
    renderDetail();
    renderPagination();
  }

  // ------------------------------------------------------------------ loading data

  let listRequest = null; // the AbortController of the list request currently in flight

  /*
   * CONCEPT: race conditions and AbortController. Type "gra" and the browser sends a request; keep
   * typing "grace" and it sends another. Network answers can arrive OUT OF ORDER, so the slower "gra"
   * answer could land last and overwrite the correct "grace" results. Before each new request we
   * ABORT the previous one, so only the newest request can ever update the screen.
   */
  async function loadStudents() {
    if (listRequest) listRequest.abort();
    listRequest = new AbortController();

    try {
      const data = await MwakiApi.get("/api/students", state.query, {
        signal: listRequest.signal,
      });
      state.students = data.students;
      state.meta = data.meta;
      state.query.page = data.meta.page; // the server may have corrected an out-of-range page

      // Keep the right-hand panel sensible: refresh the selected student from the new data, or
      // (unless we just saved one) fall back to the first result.
      const fresh =
        state.selected &&
        state.students.find((s) => s.id === state.selected.id);
      if (fresh) state.selected = fresh;
      else if (!state.keepSelection) state.selected = state.students[0] || null;
      state.keepSelection = false;

      renderStats(data.stats);
      render();
    } catch (error) {
      if (error.name === "AbortError") return; // replaced by a newer request: nothing to do
      if (state.students.length === 0) {
        el.list.replaceChildren(
          h("div", { class: "no-results" }, `❌ ${error.message}`),
        );
      }
      handleError(error);
    }
  }

  async function loadPrograms() {
    try {
      const { programs } = await MwakiApi.get("/api/programs");
      const select = el.form.elements.programId;
      select.replaceChildren(
        h("option", { value: "" }, "Select Course"),
        ...programs.map((p) => h("option", { value: p.id }, p.name)),
      );
    } catch (error) {
      notify("Could not load the list of courses.", "error");
    }
  }

  // ------------------------------------------------------------------ add / edit modal

  function openModal(student) {
    clearFieldErrors(el.form);
    el.form.reset();
    state.editingId = student ? student.id : null;
    el.modalTitle.textContent = student
      ? "✏️ Edit Student"
      : "➕ Add New Student";
    el.save.textContent = student ? "Update Student" : "Save Student";

    if (student) {
      const f = el.form.elements;
      f.firstName.value = student.firstName;
      f.lastName.value = student.lastName;
      f.studentCode.value = student.studentCode;
      f.email.value = student.email;
      f.phone.value = student.phone;
      f.grade.value = student.grade;
      f.programId.value = student.programId;
      f.address.value = student.address;
      f.dob.value = student.dob; // already YYYY-MM-DD, which is what <input type="date"> wants
      f.imageUrl.value = student.imageUrl || "";
    }

    state.opener = document.activeElement;
    el.modal.style.display = "flex";
    el.form.elements.firstName.focus(); // keyboard users start in the form
  }

  function closeModal() {
    el.modal.style.display = "none";
    clearFieldErrors(el.form);
    if (state.opener && typeof state.opener.focus === "function")
      state.opener.focus(); // hand focus back
  }

  const isModalOpen = () => el.modal.style.display === "flex";

  el.add.addEventListener("click", () => openModal(null));
  el.cancel.addEventListener("click", closeModal);
  el.modal.addEventListener("click", (event) => {
    if (event.target === el.modal) closeModal();
  }); // click on the dark backdrop
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isModalOpen()) closeModal();
  });

  el.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(el.form);

    const f = el.form.elements;
    const numberOrNull = (text) => (text === "" ? null : Number(text));
    const payload = {
      studentCode: f.studentCode.value,
      firstName: f.firstName.value,
      lastName: f.lastName.value,
      email: f.email.value,
      phone: f.phone.value,
      grade: numberOrNull(f.grade.value),
      programId: numberOrNull(f.programId.value),
      address: f.address.value,
      dob: f.dob.value,
      imageUrl: f.imageUrl.value.trim() === "" ? null : f.imageUrl.value.trim(),
    };

    const editing = state.editingId !== null;
    setBusy(el.save, true, "Saving…");
    try {
      // PUT replaces an existing student; POST creates a new one. The server answers with the saved record.
      const { student } = editing
        ? await MwakiApi.put(`/api/students/${state.editingId}`, payload)
        : await MwakiApi.post("/api/students", payload);

      closeModal();
      state.selected = student;
      state.keepSelection = true;
      notify(
        editing
          ? "Student updated successfully!"
          : `🎓 ${fullName(student)} added successfully!`,
      );
      await loadStudents();
    } catch (error) {
      if (error instanceof MwakiApi.ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      // 422 (invalid) and 409 (duplicate) both carry per-field messages: show them beside the fields.
      const hasFieldErrors =
        error instanceof MwakiApi.ApiError &&
        Object.keys(error.errors).length > 0;
      if (hasFieldErrors && showFieldErrors(el.form, error.errors)) return;
      if (error instanceof MwakiApi.ApiError)
        showFormError(el.form, error.message);
      else {
        console.error(error);
        showFormError(el.form, "Something unexpected happened.");
      }
    } finally {
      setBusy(el.save, false);
    }
  });

  // ------------------------------------------------------------------ edit and delete actions

  async function startEdit(id) {
    try {
      // Fetch the CURRENT version first: someone else may have changed or deleted it since the list loaded.
      const { student } = await MwakiApi.get(`/api/students/${id}`);
      openModal(student);
    } catch (error) {
      if (error.status === 404) {
        notify("That student no longer exists.", "warning");
        await loadStudents();
      } else handleError(error);
    }
  }

  async function removeStudent(id) {
    const target = state.students.find((s) => s.id === id) || state.selected;
    const name = target ? fullName(target) : "this student";
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;

    try {
      await MwakiApi.delete(`/api/students/${id}`); // the server answers 204 No Content
      if (state.selected && state.selected.id === id) state.selected = null;
      notify(`${name} has been deleted.`, "warning");
      await loadStudents();
    } catch (error) {
      if (error.status === 404) {
        // already gone: the goal is reached anyway
        notify("That student was already deleted.", "info");
        await loadStudents();
      } else handleError(error); // e.g. 403 if a non-admin got here
    }
  }

  async function createLogin(id) {
    const target = state.students.find((s) => s.id === id) || state.selected;
    if (!target) return;
    if (
      !window.confirm(
        `Create a login for ${fullName(target)}? They will get a username and a one-time password.`,
      )
    )
      return;

    try {
      const result = await MwakiApi.post(`/api/students/${id}/login`, {});
      showCredentialsModal(result, target, /* isNew */ true);
      await loadStudents(); // refresh so the "Create login" button swaps to "Reset password"
    } catch (error) {
      if (error instanceof MwakiApi.ApiError && error.status === 409) {
        notify(error.message, "warning");
      } else {
        handleError(error);
      }
    }
  }

  async function resetLoginPassword(id) {
    const target = state.students.find((s) => s.id === id) || state.selected;
    if (!target) return;
    if (
      !window.confirm(
        `Reset the login password for ${fullName(target)}? Their old password will stop working immediately.`,
      )
    )
      return;

    try {
      const result = await MwakiApi.post(
        `/api/students/${id}/reset-password`,
        {},
      );
      showCredentialsModal(result, target, /* isNew */ false);
    } catch (error) {
      handleError(error);
    }
  }

  /**
   * Show the username and the (one-time) password in a modal so the admin or staff member can
   * copy them. The password is NEVER shown again by the server; if it is lost, reset it again.
   */
  function showCredentialsModal(result, student, isNew) {
    const close = () => modal.remove();
    const modal = h(
      "div",
      { class: "credentials-modal" },
      h(
        "div",
        {
          class: "credentials-content",
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": "credTitle",
        },
        h(
          "h2",
          { id: "credTitle" },
          isNew ? "Login created" : "Password reset",
        ),
        h(
          "p",
          null,
          `Give these credentials to ${fullName(student)} now. The password will not be shown again.`,
        ),
        h(
          "dl",
          { class: "cred-list" },
          h("dt", null, "Username"),
          h("dd", null, h("code", null, result.username)),
          h("dt", null, "Password"),
          h("dd", null, h("code", null, result.password)),
        ),
        h(
          "p",
          { class: "cred-warning" },
          "⚠️ The password cannot be recovered later. If it is lost, reset it again.",
        ),
        h(
          "button",
          { type: "button", class: "btn", onclick: close },
          "I have copied these credentials",
        ),
      ),
    );
    document.body.appendChild(modal);
    modal.querySelector("button").focus();
    // Esc closes; clicking the backdrop closes.
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });
    document.addEventListener("keydown", function onKey(event) {
      if (event.key === "Escape") {
        document.removeEventListener("keydown", onKey);
        close();
      }
    });
  }

  /*
   * CONCEPT: event delegation. The list is rebuilt after every search, sort and page change, so
   * attaching a listener to each row would mean re-attaching them every time. Instead we attach ONE
   * listener to the container: a click on any child "bubbles up" to it, and event.target tells us
   * which button was really clicked. data-action says what it should do.
   */
  function handleAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const row = button.closest(".student-item");
    const id = Number(row ? row.dataset.id : button.dataset.id);

    if (button.dataset.action === "select") {
      state.selected = state.students.find((s) => s.id === id) || null;
      render();
    } else if (button.dataset.action === "edit") {
      startEdit(id);
    } else if (button.dataset.action === "delete") {
      removeStudent(id);
    } else if (button.dataset.action === "create-login") {
      createLogin(id);
    } else if (button.dataset.action === "reset-password") {
      resetLoginPassword(id);
    }
  }
  el.list.addEventListener("click", handleAction);
  el.detail.addEventListener("click", handleAction);

  // ------------------------------------------------------------------ search, sort, paging

  el.search.addEventListener(
    "input",
    debounce(() => {
      // wait for a 300 ms pause in typing
      state.query.q = el.search.value.trim();
      state.query.page = 1; // a new search starts at the first page
      loadStudents();
    }, 300),
  );
  el.sort.addEventListener("change", () => {
    state.query.sort = el.sort.value;
    state.query.page = 1;
    loadStudents();
  });
  el.prev.addEventListener("click", () => {
    state.query.page -= 1;
    loadStudents();
  });
  el.next.addEventListener("click", () => {
    state.query.page += 1;
    loadStudents();
  });

  el.logout.addEventListener("click", async () => {
    try {
      await MwakiApi.logout();
      window.location.href = "../login.html";
    } catch (error) {
      handleError(error);
    }
  });

  // ------------------------------------------------------------------ start-up

  async function init() {
    render(); // draw the empty states straight away

    let session;
    try {
      session = await MwakiApi.session();
    } catch (error) {
      el.list.replaceChildren(
        h("div", { class: "no-results" }, `❌ ${error.message}`),
      );
      return;
    }
    // GATE: this page is only for signed-in staff. (The server ALSO refuses every request without a
    // session, so this redirect is for convenience, not for security.)
    if (!session.user) {
      window.location.replace(LOGIN_URL);
      return;
    }
    if (session.user.role === "student") {
      window.location.replace("../student-portal.html");
      return;
    }

    state.user = session.user;
    el.userName.textContent = `${session.user.username} (${session.user.role})`;
    el.headerUser.hidden = false;
    el.add.disabled = false;

    await Promise.all([loadPrograms(), loadStudents()]); // fetch both at the same time, wait for both
  }

  init();
})();
