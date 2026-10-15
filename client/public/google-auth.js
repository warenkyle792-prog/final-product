/* Injects a "Continue with Google" button into the sign-in and sign-up forms.
   The server decides whether Google OAuth is configured (see /api/auth/google). */
(function () {
  'use strict';
  var GOOGLE_SVG = '<svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>';
  var MESSAGES = {
    'not-configured': 'Google sign-in isn’t configured on this server yet.',
    denied: 'Google sign-in was not completed.',
    state: 'Google sign-in could not be verified. Try again.',
    exchange: 'Google sign-in failed. Try again.',
    profile: 'Google profile could not be loaded. Try again.',
    invalid: 'That Google account couldn’t be used here.'
  };

  function notice(form, text) {
    var el = form.querySelector('.google-note');
    if (!el) {
      el = document.createElement('p');
      el.className = 'google-note';
      form.appendChild(el);
    }
    el.textContent = text;
  }

  function start(form, button) {
    button.disabled = true;
    fetch('/api/auth/google')
      .then(function (response) {
        if (response.status === 503) {
          notice(form, MESSAGES['not-configured']);
          button.disabled = false;
          return null;
        }
        if (!response.ok) throw new Error('unavailable');
        return response.json().then(function (body) {
          if (body && body.url) { window.location.assign(body.url); return null; }
          notice(form, MESSAGES.exchange);
          button.disabled = false;
          return null;
        });
      })
      .catch(function () {
        notice(form, MESSAGES.exchange);
        button.disabled = false;
      });
  }

  function inject(form) {
    if (form.dataset.googleInjected) return;
    form.dataset.googleInjected = '1';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'google-button';
    button.innerHTML = GOOGLE_SVG + '<span>Continue with Google</span>';
    var divider = document.createElement('div');
    divider.className = 'oauth-divider';
    divider.setAttribute('aria-hidden', 'true');
    divider.innerHTML = '<span>or</span>';
    form.insertBefore(divider, form.firstChild);
    form.insertBefore(button, divider);
    button.addEventListener('click', function () { start(form, button); });
    var params = new URLSearchParams(window.location.search);
    var reason = params.get('google');
    if (reason && MESSAGES[reason]) notice(form, MESSAGES[reason]);
  }

  function scan() {
    document.querySelectorAll('form.auth-form').forEach(inject);
  }

  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }
  scan();
})();
