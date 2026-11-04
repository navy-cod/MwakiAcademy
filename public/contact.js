/*
 * contact.js  -  behaviour of contact.html.
 *
 * PROGRESSIVE ENHANCEMENT: without this file the form still works (the browser posts it to
 * submit_inquiry.php). With it, we send the message in the background with fetch(), so the page
 * does not reload and errors appear next to the fields.
 */
(function () {
  'use strict';

  const form = document.getElementById('contactForm');
  if (!form) return;

  const { setBusy, clearFieldErrors, showFieldErrors, showFormError, toast } = MwakiUi;
  const submitButton = form.querySelector('button[type="submit"]');
  const success = document.getElementById('contactSuccess');
  const message = form.elements.message;
  const counter = document.getElementById('messageCount');

  // Live character counter. The 'input' event fires on every change, including paste.
  const updateCounter = () => { counter.textContent = `${message.value.length} / ${message.maxLength}`; };
  message.addEventListener('input', updateCounter);
  updateCounter();

  function showSuccess() {
    success.classList.add('is-visible');
    success.focus();
    success.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  // The no-JavaScript path ends with a redirect to contact.html?sent=1 (see submit_inquiry.php).
  // Show the same thank-you, then remove "?sent=1" so refreshing the page does not repeat it.
  if (new URLSearchParams(window.location.search).get('sent') === '1') {
    showSuccess();
    window.history.replaceState(null, '', window.location.pathname);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    success.classList.remove('is-visible');

    const payload = {
      name:    form.elements.name.value,
      email:   form.elements.email.value,
      phone:   form.elements.phone.value,
      message: message.value,
      website: form.elements.website.value,     // the honeypot: normally empty
    };

    setBusy(submitButton, true, 'Sending…');
    try {
      await MwakiApi.post('/api/inquiries', payload);
      form.reset();
      updateCounter();
      showSuccess();
    } catch (error) {
      if (!(error instanceof MwakiApi.ApiError)) { toast('Something unexpected happened.', 'error'); console.error(error); return; }
      const shown = error.status === 422 && showFieldErrors(form, error.errors);
      if (!shown) showFormError(form, error.message);
    } finally {
      setBusy(submitButton, false);
    }
  });
})();
