/* hide-payments.js — payments are parked until the product has real users.
 * Hides every payment surface in the compiled UI (checkout panel, ticket
 * price fields, price filters, tickets pages) while keeping free RSVP
 * registration working. The server API is untouched and dormant, so
 * re-enabling payments later = removing this file + the CSS block in
 * theme-overrides.css. */
(function () {
  if (document.documentElement.dataset.hidePayments) return;
  document.documentElement.dataset.hidePayments = '1';

  /* 1. Block payment/ticket routes (deep links, stale bookmarks). */
  function blockRoutes() {
    if (/^\/(tickets|payment)(\/|$)/.test(window.location.pathname)) {
      window.location.replace('/events');
    }
  }
  blockRoutes();

  function hide(node) { if (node) node.style.display = 'none'; }

  function textOf(node) { return (node.textContent || '').trim(); }

  function sweep() {
    /* 2. Event page: hide the whole buy-ticket panel for paid events,
     *    keep the free "Come along / Register for free" panel. */
    document.querySelectorAll('.event-ticket-panel').forEach(function (panel) {
      var paid = panel.querySelector('.provider-choice') ||
        /Buy ticket|Starting secure checkout|Ticket price/i.test(textOf(panel));
      if (paid) hide(panel);
    });

    /* 3. Create form: hide the "Ticket details" section (currency, base
     *    price, entry type, tiers). Hidden fields keep their defaults
     *    (price 0 = free entry), so creation still works. */
    document.querySelectorAll('.create-form .form-section').forEach(function (section) {
      var heading = section.querySelector('.form-section__heading');
      if (heading && /ticket details/i.test(textOf(heading))) hide(section);
    });

    /* 4. Discover filters: hide the Price select and "Up to (KES)" field. */
    document.querySelectorAll('.filter-panel .field, .filter-grid .field').forEach(function (field) {
      var label = field.querySelector('span');
      if (label && /^(Price|Up to \(KES\))$/.test(textOf(label))) hide(field);
    });
  }

  sweep();
  var debounce = null;
  new MutationObserver(function () {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(sweep, 150);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
