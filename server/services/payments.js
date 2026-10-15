const crypto = require('node:crypto');
const QRCode = require('qrcode');
const { nowIso, notify, safeJson } = require('../lib/helpers');

const PROMOTION_PRICES = {
  KES: { featured: 250000, boost: 120000, sponsored: 500000 },
  USD: { featured: 2500, boost: 1200, sponsored: 5000 },
  EUR: { featured: 2300, boost: 1100, sponsored: 4600 },
  GBP: { featured: 2000, boost: 1000, sponsored: 4000 },
  NGN: { featured: 3500000, boost: 1600000, sponsored: 7000000 },
  ZAR: { featured: 45000, boost: 22000, sponsored: 90000 }
};
const CURRENCY_EXPONENT = Object.fromEntries(Object.keys(PROMOTION_PRICES).map((currency) => [currency, 2]));
const base64url = (input) => Buffer.from(input).toString('base64url');

function getSetting(db, key, fallback) {
  return db.get('SELECT value FROM settings WHERE key = ?', [key])?.value ?? String(fallback);
}
function createTicketPayload(db, transaction, config, io) {
  const existing = db.get('SELECT * FROM tickets WHERE transaction_id = ?', [transaction.id]);
  if (existing) return existing;
  const now = nowIso();
  const code = crypto.randomUUID();
  const result = db.run(
    `INSERT INTO tickets(transaction_id,user_id,event_id,ticket_type_id,code,signed_payload,status,created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
    [transaction.id, transaction.user_id, transaction.event_id, transaction.ticket_type_id, code, 'pending', 'valid', now]
  );
  const ticketId = result.lastID;
  const body = base64url(JSON.stringify({ v: 1, ticketId, code, eventId: transaction.event_id, issuedAt: now }));
  const signature = crypto.createHmac('sha256', config.ticketSecret).update(body).digest('base64url');
  const signedPayload = `${body}.${signature}`;
  db.run('UPDATE tickets SET signed_payload = ? WHERE id = ?', [signedPayload, ticketId]);
  if (transaction.ticket_type_id) {
    db.run('UPDATE ticket_types SET sold = sold + 1 WHERE id = ?', [transaction.ticket_type_id]);
  }
  const event = db.get('SELECT title,organizer_id FROM events WHERE id = ?', [transaction.event_id]);
  notify(db, io, transaction.user_id, 'ticket', 'Your ticket is ready', `Your ticket for ${event?.title || 'the event'} is available.`, 'ticket', ticketId);
  if (event?.organizer_id) notify(db, io, event.organizer_id, 'payment', 'A ticket was sold', `A new ticket was issued for ${event.title}.`, 'event', transaction.event_id);
  return db.get('SELECT * FROM tickets WHERE id = ?', [ticketId]);
}
function paymentService({ db, config, io }) {
  function isMpesaConfigured() {
    const complete = Boolean(config.mpesa.consumerKey && config.mpesa.consumerSecret && config.mpesa.shortcode && config.mpesa.passkey && config.mpesa.callbackUrl && config.mpesa.callbackToken);
    return complete && (config.mode !== 'production' || (config.mpesa.env === 'production' && config.mpesa.callbackToken.length >= 32));
  }
  function isStripeConfigured() {
    const complete = Boolean(config.stripe.secretKey && config.stripe.publishableKey && config.stripe.webhookSecret);
    return complete && (config.mode !== 'production' || (/^(sk|rk)_live_/.test(config.stripe.secretKey) && /^pk_live_/.test(config.stripe.publishableKey)));
  }
  async function mpesaAccessToken() {
    const host = config.mpesa.env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
    const credentials = Buffer.from(`${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`).toString('base64');
    const response = await fetch(`${host}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${credentials}` } });
    if (!response.ok) throw new Error('Provider unavailable');
    return (await response.json()).access_token;
  }
  function callbackUrl(transactionId) {
    const url = new URL(config.mpesa.callbackUrl);
    url.searchParams.set('ref', String(transactionId));
    if (config.mpesa.callbackToken) url.searchParams.set('token', config.mpesa.callbackToken);
    return url.toString();
  }
  async function createMpesaIntent(transaction, metadata) {
    if (!isMpesaConfigured()) return { mode: 'sandbox', reference: `sandbox-mpesa-${transaction.id}`, checkoutUrl: '' };
    const host = config.mpesa.env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
    const token = await mpesaAccessToken();
    const time = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const password = Buffer.from(`${config.mpesa.shortcode}${config.mpesa.passkey}${time}`).toString('base64');
    const response = await fetch(`${host}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: config.mpesa.shortcode, Password: password, Timestamp: time, TransactionType: 'CustomerPayBillOnline',
        Amount: Math.max(1, Math.ceil(transaction.amount_minor / 100)), PartyA: metadata.phone || '',
        PartyB: config.mpesa.shortcode, PhoneNumber: metadata.phone || '', CallBackURL: callbackUrl(transaction.id),
        AccountReference: `ET-${transaction.id}`, TransactionDesc: metadata.description || 'EventTracker ticket'
      })
    });
    const result = await response.json();
    if (!response.ok || result.ResponseCode !== '0') throw new Error('Payment provider rejected the request');
    return { mode: 'live', reference: result.CheckoutRequestID, merchantRequestId: result.MerchantRequestID };
  }
  async function createStripeIntent(transaction, metadata) {
    if (!isStripeConfigured()) return { mode: 'sandbox', reference: `sandbox-stripe-${transaction.id}`, checkoutUrl: '' };
    const body = new URLSearchParams({
      mode: 'payment',
      success_url: `${config.publicAppUrl}/payment/return?payment=${transaction.id}`,
      cancel_url: `${config.publicAppUrl}/payment/return?payment=${transaction.id}&cancelled=1`,
      'line_items[0][price_data][currency]': transaction.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(transaction.amount_minor),
      'line_items[0][price_data][product_data][name]': metadata.description || 'EventTracker payment',
      'line_items[0][quantity]': '1',
      'metadata[transaction_id]': String(transaction.id)
    });
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${config.stripe.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': transaction.idempotency_key }, body
    });
    const result = await response.json();
    if (!response.ok) throw new Error('Payment provider rejected the request');
    return { mode: 'live', reference: result.id, checkoutUrl: result.url || '' };
  }
  async function createIntent(transaction, metadata) {
    if (transaction.provider === 'mpesa') return createMpesaIntent(transaction, metadata);
    return createStripeIntent(transaction, metadata);
  }
  async function statusQuery(transaction) {
    const metadata = safeJson(transaction.metadata);
    if (metadata.mode === 'sandbox' || transaction.provider_reference.startsWith('sandbox-')) {
      // Development may simulate completion, but production never upgrades a no-charge intent.
      if (config.mode === 'production') return { status: 'pending', source: 'sandbox-disabled-in-production' };
      return { status: 'successful', source: 'sandbox-status-query' };
    }
    try {
      if (transaction.provider === 'stripe' && isStripeConfigured()) {
        const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(transaction.provider_reference)}`, { headers: { Authorization: `Bearer ${config.stripe.secretKey}` } });
        if (!response.ok) return { status: 'pending' };
        const result = await response.json();
        if (result.payment_status === 'paid' && Number(result.amount_total) === Number(transaction.amount_minor) && String(result.currency || '').toUpperCase() === String(transaction.currency).toUpperCase()) return { status: 'successful', source: 'stripe-api' };
        if (result.status === 'expired') return { status: 'cancelled', source: 'stripe-api' };
      }
      // Safaricom's callback is authoritative. A failed query is deliberately non-terminal.
      return { status: 'pending' };
    } catch {
      return { status: 'pending' };
    }
  }
  function finalize(transactionId, nextStatus, source = 'provider') {
    const tx = db.get('SELECT * FROM transactions WHERE id = ?', [transactionId]);
    if (!tx) return null;
    if (tx.status === 'successful' && nextStatus !== 'refunded') return tx;
    if (!['successful', 'failed', 'cancelled', 'refunded', 'processing'].includes(nextStatus)) return tx;
    const now = nowIso();
    db.transaction(() => {
      db.run('UPDATE transactions SET status = ?, confirmed_at = ?, updated_at = ? WHERE id = ?', [nextStatus, nextStatus === 'successful' ? now : null, now, transactionId]);
      const metadata = safeJson(tx.metadata);
      metadata.confirmation_source = source;
      db.run('UPDATE transactions SET metadata = ? WHERE id = ?', [JSON.stringify(metadata), transactionId]);
      if (nextStatus === 'successful' && tx.purpose === 'ticket') createTicketPayload(db, tx, config, io);
      if (nextStatus === 'successful' && tx.purpose === 'promotion') {
        const promotionId = metadata.promotion_id;
        if (promotionId) {
          const startsAt = now;
          const endsAt = new Date(Date.now() + 7 * 86400000).toISOString();
          db.run('UPDATE promotions SET status = ?, starts_at = ?, ends_at = ? WHERE id = ? AND transaction_id = ?', ['active', startsAt, endsAt, promotionId, tx.id]);
          const promotion = db.get('SELECT event_id,placement,user_id FROM promotions WHERE id = ?', [promotionId]);
          if (promotion) notify(db, io, promotion.user_id, 'promotion', 'Promotion is live', `Your ${promotion.placement} placement is now active.`, 'event', promotion.event_id);
        }
      }
    });
    return db.get('SELECT * FROM transactions WHERE id = ?', [transactionId]);
  }
  async function createPayment({ userId, eventId, ticketTypeId, provider, currency, idempotencyKey, purpose = 'ticket', placement = '', phone = '' }) {
    const prior = db.get('SELECT * FROM transactions WHERE user_id = ? AND idempotency_key = ?', [userId, idempotencyKey]);
    if (prior) return { transaction: prior, duplicate: true, mode: safeJson(prior.metadata).mode || 'sandbox' };
    if (provider === 'mpesa' && String(currency).toUpperCase() !== 'KES') throw Object.assign(new Error('M-Pesa requires KES.'), { status: 400, code: 'INVALID_PAYMENT' });
    const providerConfigured = provider === 'mpesa' ? isMpesaConfigured() : isStripeConfigured();
    if (config.mode === 'production' && !providerConfigured) {
      throw Object.assign(new Error('Live payment provider is not configured.'), { status: 503, code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' });
    }
    const event = db.get('SELECT * FROM events WHERE id = ? AND status = ?', [eventId, 'published']);
    if (!event) throw Object.assign(new Error('Event not found'), { status: 404, code: 'NOT_FOUND' });
    let amountMinor;
    let ticketType = null;
    if (purpose === 'promotion') {
      const map = PROMOTION_PRICES[currency];
      if (!map || !map[placement]) throw Object.assign(new Error('Invalid promotion option'), { status: 400, code: 'INVALID_INPUT' });
      amountMinor = map[placement];
    } else {
      ticketType = ticketTypeId ? db.get('SELECT * FROM ticket_types WHERE id = ? AND event_id = ?', [ticketTypeId, eventId]) : null;
      if (ticketTypeId && !ticketType) throw Object.assign(new Error('Ticket type not found'), { status: 404, code: 'NOT_FOUND' });
      amountMinor = ticketType ? ticketType.price_minor : event.price_minor;
      if (ticketType && ticketType.sold >= ticketType.quantity) throw Object.assign(new Error('Tickets are sold out'), { status: 409, code: 'SOLD_OUT' });
      if (!ticketType) {
        const count = db.get("SELECT COUNT(*) AS n FROM tickets WHERE event_id = ? AND status IN ('valid','checked_in')", [eventId]).n;
        if (count >= event.capacity) throw Object.assign(new Error('Tickets are sold out'), { status: 409, code: 'SOLD_OUT' });
      }
    }
    const normalizedCurrency = String(currency || (ticketType?.currency || event.currency) || 'KES').toUpperCase();
    const serviceFee = Number(getSetting(db, 'service_fee_minor', '0')) || 0;
    amountMinor += serviceFee;
    const commissionPercent = Math.max(0, Number(getSetting(db, 'commission_percent', '5')) || 0);
    const commissionMinor = Math.round(amountMinor * commissionPercent / 100);
    const stamp = nowIso();
    const metadata = { mode: providerConfigured ? 'live' : 'sandbox', placement, phone: String(phone || '').slice(0, 32), description: purpose === 'promotion' ? `${placement} promotion for ${event.title}` : `Ticket for ${event.title}` };
    const result = db.run(`INSERT INTO transactions(user_id,event_id,ticket_type_id,provider,status,provider_reference,amount_minor,currency,idempotency_key,commission_minor,purpose,metadata,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [userId, eventId, ticketType?.id || null, provider, 'pending', 'pending', amountMinor, normalizedCurrency, idempotencyKey, commissionMinor, purpose, JSON.stringify(metadata), stamp, stamp]);
    let tx = db.get('SELECT * FROM transactions WHERE id = ?', [result.lastID]);
    let intent;
    try { intent = await createIntent(tx, metadata); }
    catch (error) {
      // The created intent is retained for idempotency; no provider error text is exposed to the client.
      metadata.provider_error = true;
      db.run('UPDATE transactions SET metadata = ?, updated_at = ? WHERE id = ?', [JSON.stringify(metadata), nowIso(), tx.id]);
      tx = db.get('SELECT * FROM transactions WHERE id = ?', [tx.id]);
      return { transaction: tx, mode: 'pending', providerError: true };
    }
    metadata.mode = intent.mode;
    if (intent.merchantRequestId) metadata.merchant_request_id = intent.merchantRequestId;
    db.run('UPDATE transactions SET provider_reference = ?, metadata = ?, updated_at = ? WHERE id = ?', [intent.reference, JSON.stringify(metadata), nowIso(), tx.id]);
    tx = db.get('SELECT * FROM transactions WHERE id = ?', [tx.id]);
    let promotionId = null;
    if (purpose === 'promotion') {
      const promotion = db.run('INSERT INTO promotions(event_id,user_id,placement,status,transaction_id,amount_minor,currency,created_at) VALUES(?,?,?,?,?,?,?,?)', [eventId, userId, placement, 'pending', tx.id, amountMinor, normalizedCurrency, stamp]);
      promotionId = promotion.lastID;
      metadata.promotion_id = promotionId;
      db.run('UPDATE transactions SET metadata = ? WHERE id = ?', [JSON.stringify(metadata), tx.id]);
      tx = db.get('SELECT * FROM transactions WHERE id = ?', [tx.id]);
    }
    return { transaction: tx, duplicate: false, mode: intent.mode, checkoutUrl: intent.checkoutUrl || '', publishableKey: intent.mode === 'live' && provider === 'stripe' ? config.stripe.publishableKey : '', promotionId };
  }
  async function syncStatus(transactionId) {
    const tx = db.get('SELECT * FROM transactions WHERE id = ?', [transactionId]);
    if (!tx) return null;
    if (tx.status !== 'pending' && tx.status !== 'processing') return tx;
    const providerStatus = await statusQuery(tx);
    if (providerStatus.status && providerStatus.status !== 'pending') return finalize(tx.id, providerStatus.status, providerStatus.source);
    return db.get('SELECT * FROM transactions WHERE id = ?', [tx.id]);
  }
  function verifyTicket(signedPayload) {
    if (typeof signedPayload !== 'string' || signedPayload.length > 2000) return { valid: false };
    const [body, signature, extra] = signedPayload.split('.');
    if (!body || !signature || extra) return { valid: false };
    const expected = crypto.createHmac('sha256', config.ticketSecret).update(body).digest();
    let supplied;
    try { supplied = Buffer.from(signature, 'base64url'); } catch { return { valid: false }; }
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return { valid: false };
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { valid: false }; }
    if (payload.v !== 1 || !Number.isInteger(payload.ticketId) || !Number.isInteger(payload.eventId) || typeof payload.code !== 'string') return { valid: false };
    const ticket = db.get(`SELECT t.*,e.title AS event_title,e.date AS event_date,e.location AS event_location,tt.name AS ticket_name,u.name AS attendee_name
      FROM tickets t JOIN events e ON e.id=t.event_id LEFT JOIN ticket_types tt ON tt.id=t.ticket_type_id JOIN users u ON u.id=t.user_id WHERE t.id = ? AND t.code = ?`, [payload.ticketId, payload.code]);
    if (!ticket || ticket.event_id !== payload.eventId || ticket.signed_payload !== signedPayload) return { valid: false };
    return { valid: true, ticket };
  }
  async function qrData(ticketId) {
    const ticket = db.get('SELECT signed_payload FROM tickets WHERE id = ?', [ticketId]);
    if (!ticket) return null;
    return QRCode.toDataURL(ticket.signed_payload, { width: 320, margin: 1, color: { dark: '#161617', light: '#f4f4f2' } });
  }
  return { createPayment, syncStatus, finalize, verifyTicket, qrData, getSetting, isMpesaConfigured, isStripeConfigured, promotionPrices: PROMOTION_PRICES };
}
module.exports = { paymentService, PROMOTION_PRICES, CURRENCY_EXPONENT };
