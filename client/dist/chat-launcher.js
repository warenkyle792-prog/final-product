/* chat-launcher.js — adds the missing chat entry points to the compiled app:
 *  1. a "Messages" link in the topbar (signed-in users)
 *  2. a "Message" button on other people's profiles
 *  3. a "New message" people-search overlay on the chat pages
 * The compiled bundle already renders /chat and /chat/:id and handles
 * realtime sockets itself; this script only starts conversations via REST
 * (cookie session auth) and hands off to the app's own pages. */
(function () {
  if (document.documentElement.dataset.chatLauncher) return;
  document.documentElement.dataset.chatLauncher = '1';

  var me = null;
  var meLoaded = false;

  function api(path, options) {
    return fetch('/api' + path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    }, options || {})).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, data: data };
      });
    });
  }

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  function openConversation(userId) {
    return api('/chat/conversations', { method: 'POST', body: JSON.stringify({ user_id: Number(userId) }) })
      .then(function (res) {
        if (res.status === 401) { window.location.assign('/login'); return null; }
        if (!res.data || !res.data.conversation) throw new Error('CONVERSATION_FAILED');
        window.location.assign('/chat/' + res.data.conversation.id);
        return res.data.conversation;
      });
  }

  /* ---------- 1. profile "Message" button ---------- */
  function ensureProfileButton() {
    if (!me) return;
    var match = /^\/profile\/(\d+)$/.exec(window.location.pathname);
    if (!match) return;
    var userId = Number(match[1]);
    if (userId === Number(me.id)) return;
    var actions = document.querySelector('.profile-actions');
    if (!actions || actions.querySelector('.chat-launcher-dm')) return;
    var button = el('button', 'chat-launcher-dm', ICON + '<span>Message</span>');
    button.type = 'button';
    button.addEventListener('click', function () {
      button.disabled = true;
      openConversation(userId).catch(function () { button.disabled = false; });
    });
    actions.appendChild(button);
  }

  /* ---------- 3. "New message" overlay on chat pages ---------- */
  var overlay = null;
  var searchTimer = null;

  function closeOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function renderResults(panel, users) {
    var list = panel.querySelector('.chat-launcher-results');
    list.innerHTML = '';
    if (!users.length) {
      list.appendChild(el('div', 'chat-launcher-empty', 'No members match that search.'));
      return;
    }
    users.forEach(function (user) {
      var row = el('button', 'chat-launcher-row');
      row.type = 'button';
      var avatar = user.avatar
        ? '<img src="' + escapeHtml(user.avatar) + '" alt="" />'
        : '<span>' + escapeHtml((user.name || '?').trim().charAt(0).toUpperCase()) + '</span>';
      row.innerHTML = '<i class="chat-launcher-avatar">' + avatar + '</i>' +
        '<span class="chat-launcher-meta"><strong>' + escapeHtml(user.name) + '</strong>' +
        '<em>@' + escapeHtml(user.username) + '</em></span>';
      row.addEventListener('click', function () {
        closeOverlay();
        openConversation(user.id).catch(function () {});
      });
      list.appendChild(row);
    });
  }

  function openOverlay() {
    if (overlay) return;
    overlay = el('div', 'chat-launcher-overlay');
    var panel = el('div', 'chat-launcher-panel');
    panel.innerHTML =
      '<div class="chat-launcher-head"><h3>New message</h3>' +
      '<button type="button" class="chat-launcher-close" aria-label="Close">&times;</button></div>' +
      '<input class="chat-launcher-input" type="search" placeholder="Search people by name or @username" autocomplete="off" />' +
      '<div class="chat-launcher-results"><div class="chat-launcher-empty">Type at least one character to search.</div></div>';
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    var input = panel.querySelector('.chat-launcher-input');
    panel.querySelector('.chat-launcher-close').addEventListener('click', closeOverlay);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) closeOverlay(); });
    document.addEventListener('keydown', function onEsc(event) {
      if (event.key === 'Escape') { closeOverlay(); document.removeEventListener('keydown', onEsc); }
    });
    input.addEventListener('input', function () {
      var q = input.value.trim();
      window.clearTimeout(searchTimer);
      if (!q) {
        renderResults(panel, []);
        panel.querySelector('.chat-launcher-results').innerHTML =
          '<div class="chat-launcher-empty">Type at least one character to search.</div>';
        return;
      }
      searchTimer = window.setTimeout(function () {
        api('/users/search?q=' + encodeURIComponent(q)).then(function (res) {
          if (res.status === 401) { window.location.assign('/login'); return; }
          renderResults(panel, (res.data && res.data.users) || []);
        }).catch(function () {
          panel.querySelector('.chat-launcher-results').innerHTML =
            '<div class="chat-launcher-empty">Search is unavailable right now.</div>';
        });
      }, 250);
    });
    input.focus();
  }

  function ensureChatFab() {
    if (!me) return;
    if (!/^\/chat(\/|$)/.test(window.location.pathname)) return;
    if (document.querySelector('.chat-launcher-fab')) return;
    var fab = el('button', 'chat-launcher-fab', ICON + '<span>New message</span>');
    fab.type = 'button';
    fab.addEventListener('click', openOverlay);
    document.body.appendChild(fab);
  }

  /* ---------- 4. message requests ---------- */
  function sweep() { ensure(); }
  var requestsCache = null;      // { list, at }
  var requestsBusy = false;

  function loadRequests(force) {
    if (!me || requestsBusy) return Promise.resolve(requestsCache ? requestsCache.list : []);
    if (!force && requestsCache && Date.now() - requestsCache.at < 8000) return Promise.resolve(requestsCache.list);
    requestsBusy = true;
    return api('/chat/requests').then(function (res) {
      requestsBusy = false;
      if (res.status === 200) {
        requestsCache = { list: res.data.requests || [], at: Date.now() };
        return requestsCache.list;
      }
      return requestsCache ? requestsCache.list : [];
    }).catch(function () { requestsBusy = false; return requestsCache ? requestsCache.list : []; });
  }

  function requestAction(id, action) {
    return api('/chat/requests/' + id + '/' + action, { method: 'POST', body: '{}' }).then(function () {
      requestsCache = null;
      sweep();
    });
  }

  function requestsRow(item) {
    var row = el('div', 'chat-requests__row');
    var avatar = item.other_avatar
      ? '<img src="' + escapeHtml(item.other_avatar) + '" alt="" />'
      : '<span>' + escapeHtml((item.other_name || '?').trim().charAt(0).toUpperCase()) + '</span>';
    row.innerHTML = '<i class="chat-launcher-avatar">' + avatar + '</i>' +
      '<span class="chat-launcher-meta"><strong>' + escapeHtml(item.other_name) + '</strong>' +
      '<em>' + (item.from_me ? 'Waiting for them to accept' : 'Wants to chat with you') + '</em></span>' +
      '<span class="chat-requests__actions"></span>';
    var actions = row.querySelector('.chat-requests__actions');
    if (item.from_me) {
      var open = el('button', 'chat-requests__btn', 'Open');
      open.type = 'button';
      open.addEventListener('click', function () { window.location.assign('/chat/' + item.id); });
      actions.appendChild(open);
    } else {
      var accept = el('button', 'chat-requests__btn chat-requests__btn--accept', 'Accept');
      accept.type = 'button';
      accept.addEventListener('click', function () { requestAction(item.id, 'accept').then(function () { window.location.assign('/chat/' + item.id); }); });
      var decline = el('button', 'chat-requests__btn', 'Decline');
      decline.type = 'button';
      decline.addEventListener('click', function () { requestAction(item.id, 'decline'); });
      actions.appendChild(accept);
      actions.appendChild(decline);
    }
    return row;
  }

  function ensureRequestsPanel() {
    if (!me) return;
    if (window.location.pathname !== '/chat') return;
    var header = document.querySelector('.conversation-list__header');
    if (!header) return;
    var panel = header.parentElement.querySelector('.chat-requests');
    if (!panel) {
      panel = el('div', 'chat-requests');
      header.parentElement.insertBefore(panel, header.nextSibling);
    }
    loadRequests(false).then(function (list) {
      var sig = list.map(function (r) { return r.id + ':' + r.from_me; }).join(',');
      if (panel.dataset.sig === sig) return;
      panel.dataset.sig = sig;
      panel.innerHTML = '';
      if (!list.length) { panel.style.display = 'none'; return; }
      panel.style.display = '';
      panel.appendChild(el('h3', 'chat-requests__title', 'Message requests'));
      list.forEach(function (item) { panel.appendChild(requestsRow(item)); });
    });
  }

  function ensureThreadBanner() {
    if (!me) return;
    var match = /^\/chat\/(\d+)$/.exec(window.location.pathname);
    var shell = document.querySelector('.chat-shell');
    if (!match || !shell) return;
    var id = Number(match[1]);
    var composer = document.querySelector('.message-composer');
    loadRequests(false).then(function (list) {
      var item = null;
      for (var i = 0; i < list.length; i++) if (list[i].id === id) { item = list[i]; break; }
      var banner = shell.querySelector('.chat-request-banner');
      if (!item) {
        if (banner) banner.remove();
        if (composer) composer.style.display = '';
        return;
      }
      if (composer) composer.style.display = 'none';
      if (!banner) {
        banner = el('div', 'chat-request-banner');
        var head = document.querySelector('.chat-room__head');
        if (head && head.parentElement) head.parentElement.insertBefore(banner, head.nextSibling);
        else shell.appendChild(banner);
      }
      banner.innerHTML = '';
      if (item.from_me) {
        banner.classList.add('chat-request-banner--outgoing');
        banner.appendChild(el('p', '', '<strong>' + escapeHtml(item.other_name) + '</strong> hasn’t accepted your request yet. You can chat once they accept.'));
      } else {
        banner.classList.add('chat-request-banner--incoming');
        banner.appendChild(el('p', '', '<strong>' + escapeHtml(item.other_name) + '</strong> wants to chat with you. Accept to open this conversation.'));
        var wrap = el('div', 'chat-requests__actions');
        var accept = el('button', 'chat-requests__btn chat-requests__btn--accept', 'Accept');
        accept.type = 'button';
        accept.addEventListener('click', function () { requestAction(id, 'accept'); });
        var decline = el('button', 'chat-requests__btn', 'Decline');
        decline.type = 'button';
        decline.addEventListener('click', function () { requestAction(id, 'decline').then(function () { window.location.assign('/chat'); }); });
        wrap.appendChild(accept);
        wrap.appendChild(decline);
        banner.appendChild(wrap);
      }
    });
  }

  /* ---------- 5. chat-side chrome (reference-style) ---------- */
  var ICON_CHAT = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  function inChat() { return /^\/chat(\/|$)/.test(window.location.pathname); }

  function ensureChatSearch() {
    if (!me || window.location.pathname !== '/chat') return;
    var header = document.querySelector('.conversation-list__header');
    if (!header || header.parentElement.querySelector('.chat-search')) return;
    var input = el('input', 'chat-search');
    input.type = 'search';
    input.placeholder = 'Search';
    input.setAttribute('autocomplete', 'off');
    header.parentElement.insertBefore(input, header.nextSibling);
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      document.querySelectorAll('.conversation-preview').forEach(function (row) {
        row.style.display = !q || textOf(row).toLowerCase().indexOf(q) !== -1 ? '' : 'none';
      });
    });
  }

  function ensureDayDivider() {
    if (!me || !/^\/chat\/\d+$/.test(window.location.pathname)) return;
    var history = document.querySelector('.message-history');
    if (!history || !history.children.length || history.querySelector('.chat-day-divider')) return;
    history.insertBefore(el('div', 'chat-day-divider', 'Today'), history.firstChild);
  }

  /* ---------- 6. profile follow band (fills the old dark cover space) ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function faceChip(u) {
    var inner = u.avatar ? '<img src="' + esc(u.avatar) + '" alt="">' : esc((u.name || u.username || '?').slice(0, 1));
    return '<a class="follow-band__face" href="/profile/' + u.id + '" title="' + esc(u.name || u.username) + '">' + inner + '</a>';
  }
  function ensureFollowBand() {
    var m = /^\/profile\/(\d+)/.exec(window.location.pathname);
    var cover = document.querySelector('.profile-hero__cover');
    if (!m || !cover || cover.querySelector('.follow-band')) return;
    var band = el('div', 'follow-band');
    band.innerHTML =
      '<div class="follow-band__side" data-side="followers"><span class="follow-band__label">Followers</span><strong class="follow-band__count">0</strong><div class="follow-band__faces"></div></div>' +
      '<div class="follow-band__side" data-side="following"><span class="follow-band__label">Following</span><strong class="follow-band__count">0</strong><div class="follow-band__faces"></div></div>';
    cover.appendChild(band);
    api('/users/' + m[1]).then(function (res) {
      if (res.status !== 200 || !res.data || !res.data.stats) return;
      var f = band.querySelector('[data-side="followers"] .follow-band__count');
      var g = band.querySelector('[data-side="following"] .follow-band__count');
      if (f) f.textContent = String(res.data.stats.followers);
      if (g) g.textContent = String(res.data.stats.following);
    }).catch(function () {});
    ['followers', 'following'].forEach(function (kind) {
      api('/users/' + m[1] + '/' + kind).then(function (res) {
        if (res.status !== 200 || !res.data || !res.data.users) return;
        var side = band.querySelector('[data-side="' + kind + '"]');
        if (!side) return;
        var users = res.data.users;
        var faces = side.querySelector('.follow-band__faces');
        faces.innerHTML = users.slice(0, 8).map(faceChip).join('') +
          (users.length > 8 ? '<span class="follow-band__face follow-band__more">+' + (users.length - 8) + '</span>' : '');
      }).catch(function () {});
    });
  }

  /* ---------- 7. create-event helpers: gallery button, quick dates, clear publish errors ---------- */
  function showToast(msg) {
    var t = el('div', 'create-toast', msg);
    document.body.appendChild(t);
    window.setTimeout(function () { t.remove(); }, 6000);
  }
  var ERROR_TEXT = {
    EVENT_DATE_IN_PAST: 'This event was not published: the date is in the past. Pick today or a future date (use the quick date buttons).',
    INVALID_EVENT: 'This event was not published: a required field is missing or too short (title 3+, description 12+ characters).',
    INVALID_TICKET_TIERS: 'This event was not published: a ticket tier has an invalid name, price or quantity.',
    NOT_AUTHENTICATED: 'Your session expired. Sign in again, then publish.'
  };
  function wrapFetchForCreateErrors() {
    if (window.__etFetchWrapped) return;
    window.__etFetchWrapped = 1;
    var orig = window.fetch;
    window.fetch = function () {
      var args = arguments;
      var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      var method = args[1] && args[1].method;
      var p = orig.apply(this, args);
      if (url.indexOf('/api/events') !== -1 && method && method.toUpperCase() === 'POST') {
        p.then(function (res) {
          if (res && !res.ok) res.clone().json().then(function (j) {
            showToast(ERROR_TEXT[j && j.error] || ('Publishing failed' + (j && j.error ? ' (' + j.error + ')' : '') + '. Nothing was saved yet — fix the form and try again.'));
          }).catch(function () { showToast('Publishing failed. Nothing was saved yet — check the form and try again.'); });
        }).catch(function () {});
      }
      return p;
    };
  }
  function setNativeValue(input, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function ensureCreateHelpers() {
    if (!/^\/create(\/|$)/.test(window.location.pathname)) return;
    var form = document.querySelector('.create-form');
    if (!form || form.dataset.helpers) return;
    form.dataset.helpers = '1';
    wrapFetchForCreateErrors();

    /* quick date chips next to the Date field */
    var dateInput = form.querySelector('input[type="date"]');
    if (dateInput && dateInput.closest('label')) {
      var iso = function (d) { return d.toISOString().slice(0, 10); };
      var nextSaturday = function () { var d = new Date(); d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7)); return d; };
      var chips = el('div', 'create-date-chips');
      [['Today', function () { return new Date(); }], ['Tomorrow', function () { var d = new Date(); d.setUTCDate(d.getUTCDate() + 1); return d; }], ['Saturday', nextSaturday], ['Next week', function () { var d = new Date(); d.setUTCDate(d.getUTCDate() + 7); return d; }]].forEach(function (c) {
        var b = el('button', 'create-date-chip', c[0]);
        b.type = 'button';
        b.addEventListener('click', function () { setNativeValue(dateInput, iso(c[1]())); });
        chips.appendChild(b);
      });
      dateInput.closest('label').insertAdjacentElement('afterend', chips);
    }

    /* prominent gallery upload button wired to the cover file input */
    var coverInput = form.querySelectorAll('input[type="file"]')[0];
    if (coverInput) {
      var wrap = el('div', 'create-gallery');
      var btn = el('button', 'button button--outline button--small create-gallery__btn', '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg> Upload your photo (gallery)');
      btn.type = 'button';
      var note = el('span', 'create-gallery__note', 'Choose a photo from your device — it becomes the event cover.');
      btn.addEventListener('click', function () { coverInput.click(); });
      coverInput.addEventListener('change', function () {
        var f = coverInput.files && coverInput.files[0];
        note.textContent = f ? 'Selected: ' + f.name : 'Choose a photo from your device — it becomes the event cover.';
      });
      wrap.appendChild(btn); wrap.appendChild(note);
      var firstGrid = form.querySelector('.form-grid');
      if (firstGrid) firstGrid.insertAdjacentElement('beforebegin', wrap);
    }
  }

  function ensure() {
    if (!meLoaded) return;
    ensureProfileButton();
    ensureChatFab();
    ensureRequestsPanel();
    ensureThreadBanner();
    ensureChatSearch();
    ensureDayDivider();
    ensureFollowBand();
    ensureCreateHelpers();
    if (overlay && !inChat()) closeOverlay();
  }

  window.setInterval(function () {
    if (me && /^\/chat(\/|$)/.test(window.location.pathname)) { requestsCache = null; sweep(); }
  }, 12000);

  api('/auth/me').then(function (res) {
    meLoaded = true;
    if (res.status === 200 && res.data && res.data.user) me = res.data.user;
    ensure();
  }).catch(function () { meLoaded = true; });

  var debounce = null;
  new MutationObserver(function () {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(ensure, 200);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
