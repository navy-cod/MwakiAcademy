/*
 * js/nav.js  -  runs on every page: the mobile menu button, and the Login/Logout link.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------ mobile menu
  // The button says which element it controls:  <button class="nav-toggle" aria-controls="site-nav">
  // We toggle the class "is-open" on that element; style.css decides what "open" looks like.
  function initMenuToggle() {
    document.querySelectorAll('.nav-toggle').forEach((button) => {
      const menu = document.getElementById(button.getAttribute('aria-controls'));
      if (!menu) return;

      const setOpen = (open) => {
        menu.classList.toggle('is-open', open);
        // aria-expanded tells screen-reader users whether the menu is open.
        button.setAttribute('aria-expanded', String(open));
      };

      button.addEventListener('click', () => setOpen(!menu.classList.contains('is-open')));

      // Keyboard: Escape closes the menu and returns focus to the button.
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && menu.classList.contains('is-open')) {
          setOpen(false);
          button.focus();
        }
      });

      // Click anywhere outside the menu closes it.
      document.addEventListener('click', (event) => {
        if (menu.classList.contains('is-open') && !menu.contains(event.target) && !button.contains(event.target)) {
          setOpen(false);
        }
      });

      // CONCEPT: matchMedia lets JavaScript react to the same breakpoints as the CSS. If the
      // window is widened past the mobile layout, reset the menu so it is not left "open".
      window.matchMedia('(min-width: 769px)').addEventListener('change', (event) => {
        if (event.matches) setOpen(false);
      });
    });
  }

  // ------------------------------------------------------------ Login / Logout link
  // Every page has  <a href="login.html" data-auth-link>Login</a>.  If the visitor is signed
  // in we turn it into "Logout" and add an "Account" link.
  async function initAuthLinks() {
    const links = document.querySelectorAll('[data-auth-link]');
    if (links.length === 0 || !window.MwakiApi) return;

    let session;
    try {
      session = await MwakiApi.session();
    } catch (error) {
      return;      // server unreachable (or page opened without PHP): leave the plain Login link
    }
    if (!session.user) return;

    const needsAccountLink = !document.querySelector('a[href="details.html"]');   // home sidebar already has one

    links.forEach((link) => {
      const icon = link.querySelector('i');
      const isListItem = link.parentElement && link.parentElement.tagName === 'LI';

      if (needsAccountLink) {
        const account = MwakiUi.h('a', { href: 'details.html' }, 'Account');
        if (isListItem) {
          const li = MwakiUi.h('li', null, account);
          link.parentElement.before(li);
        } else {
          link.before(account);
        }
      }

      // Keep the icon (sidebar) but change the words and the destination behaviour.
      link.replaceChildren(
        ...(icon ? [Object.assign(icon.cloneNode(), { className: 'fas fa-sign-out-alt' }), ' '] : []),
        'Logout'
      );
      link.classList.remove('active');
      link.addEventListener('click', async (event) => {
        event.preventDefault();             // stop the link from navigating; we do it ourselves
        try {
          await MwakiApi.logout();
          window.location.href = 'login.html';
        } catch (error) {
          MwakiUi.toast(error.message, 'error');
        }
      });
    });
  }

  initMenuToggle();
  initAuthLinks();
})();
