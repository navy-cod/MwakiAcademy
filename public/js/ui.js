/*
 * js/ui.js  -  small helpers shared by every page: safe DOM building, toasts, form errors.
 */
(function () {
  'use strict';

  /*
   * CONCEPT: XSS (cross-site scripting) and why we use textContent.
   * If we build HTML by gluing text together --  el.innerHTML = '<b>' + name + '</b>'  --
   * and `name` is  <img src=x onerror=stealCookies()>  the browser would RUN the attacker's
   * code, because innerHTML turns text into live elements.
   * `textContent` (and document.createTextNode) treat the value as plain text, always.
   * So the rule in this project: user-supplied data goes in through textContent, never innerHTML.
   * escapeHtml() is here only for the rare case where you must produce an HTML string.
   */
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * h('tag', {attributes}, ...children)  builds a DOM element without any HTML string.
   *   h('a', { class: 'btn', href: 'home.html' }, 'Home')
   * String children become TEXT NODES, so they can never turn into markup.
   * Only pass developer-controlled values for href/src attributes (a "javascript:" URL in
   * an href would be dangerous); the server validates any URL a user can store.
   */
  function h(tag, attrs, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') element.className = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        element.addEventListener(key.slice(2).toLowerCase(), value);   // onClick -> 'click'
      } else element.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return element;
  }

  /** A short message that appears in the corner and fades away. type: info | success | error */
  function toast(message, type = 'info', milliseconds = 4500) {
    let region = document.getElementById('toast-region');
    if (!region) {
      // role="status" + aria-live: screen readers announce new toasts without stealing focus.
      region = h('div', { id: 'toast-region', class: 'toast-region', role: 'status', 'aria-live': 'polite' });
      document.body.append(region);
    }
    const node = h('div', { class: `site-toast site-toast--${type}` }, message);
    node.addEventListener('click', () => node.remove());
    region.append(node);
    setTimeout(() => node.remove(), milliseconds);
  }

  /**
   * CONCEPT: debounce. A search box fires an event on EVERY keystroke. Debouncing waits until
   * the user pauses typing for `ms` before running the function, so typing "nurse" makes
   * one request instead of five.
   */
  function debounce(fn, ms = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // ---------------------------------------------------------------- form error display
  // Convention used by every form: next to each input sits  <p class="field-error" data-error-for="fieldName" hidden>
  // and at the top of the form a  <div data-form-error role="alert" hidden>  for general errors.

  function fieldFor(form, name) {
    const element = form.elements[name];
    return element instanceof RadioNodeList ? element[0] : element;   // radio groups return a list
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('[data-error-for]').forEach((slot) => { slot.textContent = ''; slot.hidden = true; });
    form.querySelectorAll('[aria-invalid]').forEach((el) => {
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    });
    const banner = form.querySelector('[data-form-error]');
    if (banner) { banner.textContent = ''; banner.hidden = true; }
  }

  /** Show server (or client) messages beside their fields. Returns true if any field was marked. */
  function showFieldErrors(form, errors) {
    let firstInvalid = null;
    for (const [name, message] of Object.entries(errors || {})) {
      const slot = form.querySelector(`[data-error-for="${CSS.escape(name)}"]`);
      const input = fieldFor(form, name);
      if (slot) {
        slot.textContent = message;          // textContent: the message is text, never HTML
        slot.hidden = false;
        slot.id = slot.id || `${form.id || 'form'}-${name}-error`;
      }
      if (input) {
        // aria-invalid + aria-describedby let screen readers announce "invalid, <message>".
        input.setAttribute('aria-invalid', 'true');
        if (slot) input.setAttribute('aria-describedby', slot.id);
        firstInvalid = firstInvalid || input;
      }
    }
    if (firstInvalid) firstInvalid.focus();   // move the keyboard cursor to the first problem
    return firstInvalid !== null;
  }

  function showFormError(form, message) {
    const banner = form.querySelector('[data-form-error]');
    if (!banner) { toast(message, 'error'); return; }
    banner.textContent = message;
    banner.hidden = false;
  }

  /** Disable a button and show a busy label while a request is running (prevents double submits). */
  function setBusy(button, busy, busyLabel = 'Please wait…') {
    if (busy) {
      button.dataset.originalHtml = button.innerHTML;   // our own markup (icon + label), not user data
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = busyLabel;
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    }
  }

  // ---------------------------------------------------------------- formatting
  // CONCEPT: Intl. The browser already knows how each locale writes numbers and dates.
  const numberFormat = new Intl.NumberFormat('en-KE');
  const formatNumber = (n) => numberFormat.format(n);
  const formatKes = (n) => `KSh ${numberFormat.format(n)}`;
  function formatDate(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // ---------------------------------------------------------------- image fallbacks
  // Logos use  <img src="..." data-fallback="https://placehold.co/...">.  If the first image
  // fails, swap in the fallback ONCE. Deleting data-fallback first is what prevents an endless
  // loop when the fallback also fails (the old inline onerror="" attributes could loop).
  function useFallback(img) {
    const fallback = img.dataset.fallback;
    if (!fallback) return;
    delete img.dataset.fallback;
    img.src = fallback;
  }
  // 'error' events do not bubble, but they DO travel down in the "capture" phase, so one
  // listener on the document (third argument true) can watch every image on the page.
  document.addEventListener('error', (event) => {
    if (event.target instanceof HTMLImageElement) useFallback(event.target);
  }, true);
  // Images that already failed before this script ran would never trigger the listener.
  document.querySelectorAll('img[data-fallback]').forEach((img) => {
    if (img.complete && img.naturalWidth === 0) useFallback(img);
  });

  window.MwakiUi = {
    escapeHtml, h, toast, debounce,
    clearFieldErrors, showFieldErrors, showFormError, setBusy,
    formatNumber, formatKes, formatDate,
  };
})();
