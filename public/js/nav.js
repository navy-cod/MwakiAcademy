/*
 * js/nav.js  -  runs on every page: the mobile menu button, and the Login/Logout link.
 */
(function () {
  "use strict";

  // ------------------------------------------------------------ mobile menu
  // The button says which element it controls:  <button class="nav-toggle" aria-controls="site-nav">
  // We toggle the class "is-open" on that element; style.css decides what "open" looks like.
  function initMenuToggle() {
    document.querySelectorAll(".nav-toggle").forEach((button) => {
      const menu = document.getElementById(
        button.getAttribute("aria-controls"),
      );
      if (!menu) return;

      const setOpen = (open) => {
        menu.classList.toggle("is-open", open);
        // aria-expanded tells screen-reader users whether the menu is open.
        button.setAttribute("aria-expanded", String(open));
      };

      button.addEventListener("click", () =>
        setOpen(!menu.classList.contains("is-open")),
      );

      // Keyboard: Escape closes the menu and returns focus to the button.
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && menu.classList.contains("is-open")) {
          setOpen(false);
          button.focus();
        }
      });

      // Click anywhere outside the menu closes it.
      document.addEventListener("click", (event) => {
        if (
          menu.classList.contains("is-open") &&
          !menu.contains(event.target) &&
          !button.contains(event.target)
        ) {
          setOpen(false);
        }
      });

      // CONCEPT: matchMedia lets JavaScript react to the same breakpoints as the CSS. If the
      // window is widened past the mobile layout, reset the menu so it is not left "open".
      window
        .matchMedia("(min-width: 769px)")
        .addEventListener("change", (event) => {
          if (event.matches) setOpen(false);
        });
    });
  }

  // ------------------------------------------------------------ Login / Logout link
  // Every page has  <a href="login.html" data-auth-link>Login</a>.  If the visitor is signed
  // in we turn it into "Logout" and add an "Account" link.
  async function initAuthLinks() {
    const links = document.querySelectorAll("[data-auth-link]");
    if (links.length === 0 || !window.MwakiApi) return;

    let session;
    try {
      session = await MwakiApi.session();
    } catch (error) {
      return;
    }
    if (!session.user) return;

    const isStaff =
      session.user.role === "admin" || session.user.role === "staff";
    const isStudent = session.user.role === "student";
    const path = window.location.pathname;
    const needsAccountLink =
      isStaff &&
      !document.querySelector('a[href="details.html"]') &&
      !/\/details\.html$/.test(path);
    const needsAdminLink =
      isStaff &&
      !document.querySelector('a[href="admin.html"]') &&
      !/\/admin\.html$/.test(path);
    const needsStudentLink =
      isStudent &&
      !document.querySelector('a[href="student-portal.html"]') &&
      !/\/student-portal\.html$/.test(path);

    links.forEach((link) => {
      const icon = link.querySelector("i");
      const isListItem =
        link.parentElement && link.parentElement.tagName === "LI";

      const insertBefore = (href, text) => {
        const a = MwakiUi.h("a", { href }, text);
        link.before(isListItem ? MwakiUi.h("li", null, a) : a);
      };
      if (needsAccountLink) insertBefore("details.html", "Account");
      if (needsAdminLink) insertBefore("admin.html", "Admin");
      if (needsStudentLink) insertBefore("student-portal.html", "My Record");

      link.replaceChildren(
        ...(icon
          ? [
              Object.assign(icon.cloneNode(), {
                className: "fas fa-sign-out-alt",
              }),
              " ",
            ]
          : []),
        "Logout",
      );
      link.classList.remove("active");
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          await MwakiApi.logout();
          window.location.href = "login.html";
        } catch (error) {
          MwakiUi.toast(error.message, "error");
        }
      });
    });
  }

  initMenuToggle();
  initAuthLinks();
})();
