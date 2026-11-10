/*
 * student-portal.js  -  behaviour of student-portal.html.
 *
 * The page has three jobs:
 *   1. Read the student's own record: GET /api/me/student
 *   2. Edit phone / address / photo: PATCH /api/me/student
 *   3. Change the student's own password: POST /api/auth/password (shared with staff)
 *
 * A "student" role is the ONLY role that can reach this page. The server enforces it on
 * every request (requireUser('student')); this page just reflects what the server returns.
 */
(function () {
  "use strict";

  const {
    h,
    toast,
    formatDate,
    clearFieldErrors,
    showFieldErrors,
    showFormError,
    setBusy,
  } = MwakiUi;

  const subtitle = document.getElementById("portalSubtitle");
  const identityCard = document.getElementById("identityCard");
  const recordList = document.getElementById("recordList");
  const contactCard = document.getElementById("contactCard");
  const contactForm = document.getElementById("contactForm");
  const passwordCard = document.getElementById("passwordCard");
  const passwordForm = document.getElementById("passwordForm");
  const portalActions = document.getElementById("portalActions");

  function renderRecord(student) {
    const name = `${student.firstName} ${student.lastName}`;
    const born = new Date(`${student.dob}T00:00:00`).toLocaleDateString(
      "en-KE",
      {
        year: "numeric",
        month: "long",
        day: "numeric",
      },
    );
    const rows = [
      ["Name", name],
      ["Student ID", student.studentCode],
      ["Program", student.program],
      ["Grade", `${student.grade}%`],
      ["Date of birth", `${born} (${student.age} years old)`],
      ["Email", student.email],
    ];
    recordList.replaceChildren(
      ...rows.flatMap(([label, value]) => [
        h("dt", null, label),
        h("dd", null, value),
      ]),
    );
  }

  function fillContactForm(student) {
    const f = contactForm.elements;
    f.phone.value = student.phone || "";
    f.address.value = student.address || "";
    f.imageUrl.value = student.imageUrl || "";
  }

  async function loadMyRecord() {
    try {
      const { student } = await MwakiApi.get("/api/me/student");
      renderRecord(student);
      fillContactForm(student);
      subtitle.textContent = "You are signed in. Here is your record.";
      identityCard.hidden = false;
      contactCard.hidden = false;
      passwordCard.hidden = false;
      portalActions.hidden = false;
      return student;
    } catch (error) {
      if (error instanceof MwakiApi.ApiError && error.status === 401) {
        window.location.replace(
          "login.html?next=" + encodeURIComponent("student-portal.html"),
        );
        return null;
      }
      if (
        error instanceof MwakiApi.ApiError &&
        (error.status === 403 || error.status === 404)
      ) {
        subtitle.textContent =
          "We could not find your student record. Please contact the registry.";
        toast(error.message, "error");
        return null;
      }
      subtitle.textContent = error.message || "We could not load your record.";
      toast(error.message || "Could not load your record.", "error");
      return null;
    }
  }

  // ------------------------------------------------------------------ contact form

  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(contactForm);
    const f = contactForm.elements;

    const payload = {
      phone: f.phone.value,
      address: f.address.value,
      imageUrl: f.imageUrl.value.trim() === "" ? null : f.imageUrl.value.trim(),
    };

    const button = contactForm.querySelector('button[type="submit"]');
    setBusy(button, true, "Saving…");
    try {
      const { student } = await MwakiApi.patch("/api/me/student", payload);
      renderRecord(student);
      fillContactForm(student);
      toast("Contact details saved.", "success");
    } catch (error) {
      if (!(error instanceof MwakiApi.ApiError)) {
        toast("Something unexpected happened.", "error");
        console.error(error);
        return;
      }
      const shown =
        error.status === 422 && showFieldErrors(contactForm, error.errors);
      if (!shown) showFormError(contactForm, error.message);
    } finally {
      setBusy(button, false);
    }
  });

  // ------------------------------------------------------------------ change password

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(passwordForm);
    const f = passwordForm.elements;

    if (f.newPassword.value !== f.confirmPassword.value) {
      showFieldErrors(passwordForm, {
        confirmPassword: "The two new passwords do not match.",
      });
      return;
    }

    const button = passwordForm.querySelector('button[type="submit"]');
    setBusy(button, true, "Changing…");
    try {
      await MwakiApi.changePassword(
        f.currentPassword.value,
        f.newPassword.value,
      );
      passwordForm.reset();
      toast("Password changed. You are still signed in.", "success");
    } catch (error) {
      if (!(error instanceof MwakiApi.ApiError)) {
        toast("Something unexpected happened.", "error");
        console.error(error);
        return;
      }
      const shown =
        error.status === 422 && showFieldErrors(passwordForm, error.errors);
      if (!shown) showFormError(passwordForm, error.message);
      if (error.errors && error.errors.currentPassword)
        f.currentPassword.value = "";
    } finally {
      setBusy(button, false);
    }
  });

  // ------------------------------------------------------------------ sign out

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    try {
      await MwakiApi.logout();
      window.location.href = "login.html";
    } catch (error) {
      toast(error.message, "error");
    }
  });

  // ------------------------------------------------------------------ start-up

  // Confirm we are a student before showing the forms.
  MwakiApi.session()
    .then((session) => {
      if (!session.user) {
        window.location.replace(
          "login.html?next=" + encodeURIComponent("student-portal.html"),
        );
        return;
      }
      if (session.user.role !== "student") {
        // Staff/admin somehow reached this page: send them where they belong.
        window.location.replace(
          session.user.role === "admin" || session.user.role === "staff"
            ? "admin.html"
            : "home.html",
        );
        return;
      }
      loadMyRecord();
    })
    .catch((error) => {
      subtitle.textContent = error.message;
    });
})();
