/**
 * Payment service layer.
 *
 * Everything money-related lives behind this module — routes and UI never
 * touch a provider directly. Adding a new provider means implementing
 * `initiate`, `verify`, `isConfigured` and registering it below.
 *
 * The transaction row is the ledger and the single source of truth:
 *
 *   pending ──► processing ──► successful ──► refunded
 *      │             │
 *      └────────────►└────────► failed / cancelled
 *
 * A payment only becomes `successful` when the **server** has confirmed it —
 * either from a signature-verified webhook, a provider status query, or (in
 * unconfigured sandbox mode) the explicitly-flagged simulation endpoint.
 * Client-side callbacks can never mark a payment as paid.
 */
const crypto = require('crypto');

const db = require('../../db');
const money = require('./money');
const notifications = require('../notifications');
const audit = require('../../db/helpers').audit;
const getSetting = require('../../db/helpers').getSetting;

const mpesa = require('./providers/mpesa');
const card = require('./providers/card');

/* ------------------------------------------------------------------ *
 * Provider registry
 * ------------------------------------------------------------------ */

const PROVIDERS = [mpesa, card];

const byMethod = (method) => PROVIDERS.find((p) => p.methods.includes(String(method)));

function providerModes() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    methods: p.methods,
    currencies: p.currencies,
    configured: p.isConfigured(),
    mode: p.isConfigured() ? 'live' : 'simulation',
  }));
}

function methodAvailability() {
  const seen = new Map();
  for (const provider of PROVIDERS) {
    for (const method of provider.methods) {
      if (!seen.has(method)) {
        seen.set(method, {
          id: method,
          label: provider.label,
          provider: provider.id,
          configured: provider.isConfigured(),
          mode: provider.isConfigured() ? 'live' : 'simulation',
          currencies: provider.currencies,
        });
      }
    }
  }
  return [...seen.values()];
}

const STATUSES = ['pending', 'processing', 'successful', 'failed', 'cancelled', 'refunded'];
const ACTIVE_STATUSES = ['pending', 'processing'];

const REFERENCE_PREFIX = { ticket: 'TIX', promotion: 'PRO', topup: 'TOP' };

function generateReference(purpose = 'ticket') {
  const prefix = REFERENCE_PREFIX[purpose] || 'TXN';
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ET-${prefix}-${stamp}${rand}`;
}

/* ------------------------------------------------------------------ *
 * Transaction helpers
 * ------------------------------------------------------------------ */

function findByReference(reference) {
  return db.prepare('SELECT * FROM transactions WHERE reference = ?').get(String(reference || '').trim().toUpperCase());
}

function findById(id) {
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
}

/** Public shape — provider payloads and internal keys never leave the server. */
function publicTransaction(txn) {
  if (!txn) return null;
  let metadata = {};
  try {
    metadata = JSON.parse(txn.metadata || '{}');
  } catch (_) {
    metadata = {};
  }

  return {
    id: txn.id,
    reference: txn.reference,
    purpose: txn.purpose,
    status: txn.status,
    amount_cents: txn.amount_cents,
    amount_formatted: money.format(txn.amount_cents, txn.currency),
    fee_cents: Number(txn.fee_cents || 0),
    fee_formatted: money.format(Number(txn.fee_cents || 0), txn.currency),
    net_cents: Math.max(0, Number(txn.amount_cents || 0) - Number(txn.fee_cents || 0)),
    currency: txn.currency,
    method: txn.method,
    provider: txn.provider,
    provider_reference: txn.provider_reference,
    payer_phone: txn.payer_phone,
    payer_email: txn.payer_email,
    receipt: txn.receipt,
    failure_reason: txn.failure_reason,
    event_id: txn.event_id,
    user_id: txn.user_id,
    created_at: txn.created_at,
    updated_at: txn.updated_at,
    completed_at: txn.completed_at,
    metadata: {
      items: metadata.items || [],
      attendees: metadata.attendees || [],
      notes: metadata.notes || '',
      promotion_id: metadata.promotion_id || null,
      simulate: Boolean(metadata.simulate),
    },
  };
}

function touch(reference, fields) {
  const columns = Object.keys(fields);
  if (!columns.length) return;
  const assignments = columns.map((c) => `${c} = ?`).join(', ');
  db.prepare(`UPDATE transactions SET ${assignments}, updated_at = datetime('now') WHERE reference = ?`)
    .run(...columns.map((c) => fields[c]), reference);
}

/* ------------------------------------------------------------------ *
 * Intent creation
 * ------------------------------------------------------------------ */

/**
 * Create a payment intent.
 *
 * @param {object}  input
 * @param {number}  input.userId
 * @param {string}  input.purpose        ticket | promotion
 * @param {number}  input.amountCents
 * @param {string}  input.currency
 * @param {string}  input.method         mpesa | card
 * @param {object}  input.metadata
 * @param {number=} input.eventId
 * @param {number=} input.promotionId
 * @param {string=} input.payerPhone
 * @param {string=} input.payerEmail
 * @param {string=} input.idempotencyKey
 */
async function createIntent(input) {
  const {
    userId, purpose = 'ticket', amountCents, currency = money.DEFAULT_CURRENCY,
    method, metadata = {}, eventId = null, promotionId = null, feeCents = 0,
    payerPhone = '', payerEmail = '', idempotencyKey = '',
  } = input || {};

  if (!userId) throw Object.assign(new Error('Authentication required'), { status: 401 });

  const provider = byMethod(method);
  if (!provider) throw Object.assign(new Error(`Unsupported payment method: ${method}`), { status: 400 });

  const currencyCode = String(currency).toUpperCase();
  if (!money.isSupported(currencyCode)) {
    throw Object.assign(new Error(`Unsupported currency: ${currencyCode}`), { status: 400 });
  }
  if (!provider.currencies.includes(currencyCode)) {
    throw Object.assign(
      new Error(`${provider.label} does not support ${currencyCode} payments on this platform`),
      { status: 400 }
    );
  }

  const amount = Math.round(Number(amountCents) || 0);
  if (amount <= 0) throw Object.assign(new Error('The payment amount must be greater than zero'), { status: 400 });
  if (amount > 100_000_000) throw Object.assign(new Error('The payment amount is too large'), { status: 400 });

  // Platform commission carried by this transaction. Recalculated by the caller
  // from server-side prices; never trusted from the client.
  const fee = Math.max(0, Math.min(Math.round(Number(feeCents) || 0), amount));

  if (method === 'mpesa') {
    const phone = mpesa.normalizePhone(payerPhone);
    if (!/^254\d{9}$/.test(phone)) {
      throw Object.assign(new Error('Enter a valid M-Pesa phone number, e.g. 0712 345 678'), { status: 400 });
    }
  }

  // Re-use a recent identical pending intent (protects against double taps).
  if (idempotencyKey) {
    const existing = db.prepare(`
      SELECT * FROM transactions
      WHERE idempotency_key = ? AND status IN ('pending','processing')
        AND created_at > datetime('now', '-15 minutes')
      ORDER BY id DESC LIMIT 1
    `).get(String(idempotencyKey));
    if (existing) {
      return { transaction: publicTransaction(existing), reused: true, provider_mode: provider.isConfigured() ? 'live' : 'simulation' };
    }
  }

  const reference = generateReference(purpose);
  const providerMode = provider.isConfigured() ? 'live' : 'simulation';

  db.prepare(`
    INSERT INTO transactions (
      reference, user_id, event_id, promotion_id, purpose, amount_cents, fee_cents, currency,
      method, provider, status, payer_phone, payer_email, metadata, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(
    reference, userId, eventId, promotionId, purpose, amount, fee, currencyCode,
    method, provider.id,
    method === 'mpesa' ? mpesa.normalizePhone(payerPhone) : '',
    String(payerEmail || '').slice(0, 140),
    JSON.stringify({ ...metadata, simulate: providerMode === 'simulation' }),
    String(idempotencyKey || '').slice(0, 80)
  );

  let txn = findByReference(reference);

  try {
    const result = await provider.initiate(txn);

    const updates = {
      provider_reference: result.provider_reference || '',
      provider_payload: JSON.stringify(result.payload || {}).slice(0, 4000),
      status: result.status === 'failed' ? 'failed' : result.status === 'successful' ? 'successful' : 'pending',
      failure_reason: result.failure_reason || '',
    };
    touch(reference, updates);
    txn = findByReference(reference);

    if (txn.status === 'successful') {
      await finalizeSuccess(txn, { source: 'provider' });
    }

    return {
      transaction: publicTransaction(txn),
      instructions: result.instructions || null,
      provider_mode: result.mode || provider.isConfigured() ? 'live' : 'simulation',
      reused: false,
    };
  } catch (error) {
    touch(reference, { status: 'failed', failure_reason: String(error.message || 'Payment could not be started').slice(0, 200) });
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Status sync + finalisation
 * ------------------------------------------------------------------ */

/**
 * Ask the provider for the authoritative status.
 * `minIntervalMs` avoids hammering the provider when the UI polls.
 */
async function syncStatus(reference, { userId = null, minIntervalMs = 4000 } = {}) {
  const txn = findByReference(reference);
  if (!txn) throw Object.assign(new Error('Transaction not found'), { status: 404 });

  if (userId && txn.user_id !== userId) {
    const viewer = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (viewer?.role !== 'admin') throw Object.assign(new Error('Transaction not found'), { status: 404 });
  }

  if (!ACTIVE_STATUSES.includes(txn.status)) {
    return publicTransaction(txn);
  }

  const last = new Date(`${txn.updated_at.replace(' ', 'T')}Z`).getTime();
  if (Number.isFinite(last) && Date.now() - last < minIntervalMs) {
    return publicTransaction(txn);
  }

  const provider = PROVIDERS.find((p) => p.id === txn.provider) || byMethod(txn.method);
  if (!provider?.verify) return publicTransaction(txn);

  try {
    const result = await provider.verify(txn);
    if (result.status && result.status !== txn.status) {
      applyProviderResult(txn, result, { source: 'status_query' });
      return publicTransaction(findByReference(reference));
    }
    touch(reference, { updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
  } catch (error) {
    // A failing status query must not fail the payment — it stays pending.
    console.warn(`[payments] status query failed for ${reference}:`, error.message);
  }

  return publicTransaction(findByReference(reference));
}

/**
 * Apply a provider-reported outcome. Used by webhooks, callbacks and status
 * queries. The outcome is only trusted after the provider module has
 * validated it (signature / callback token / authenticated API call).
 */
function applyProviderResult(txn, result, { source = 'provider' } = {}) {
  if (!txn) return null;

  const next = STATUSES.includes(result.status) ? result.status : txn.status;
  if (txn.status === 'successful' && next !== 'successful' && next !== 'refunded') return txn;
  if (txn.status === 'refunded') return txn;

  const fields = {
    status: next,
    provider_reference: result.provider_reference || txn.provider_reference,
    receipt: result.receipt || txn.receipt,
    failure_reason: result.failure_reason ? String(result.failure_reason).slice(0, 200) : txn.failure_reason,
  };

  if (result.amount != null && Number(result.amount) > 0) {
    // Guard against a provider reporting a different amount than we asked for.
    const reported = Number(result.amount);
    if (reported + 1 < txn.amount_cents) {
      fields.status = 'failed';
      fields.failure_reason = `Provider reported ${money.format(reported, txn.currency)} but ${money.format(txn.amount_cents, txn.currency)} was requested`;
    }
  }

  if (result.payload) fields.provider_payload = JSON.stringify(result.payload).slice(0, 4000);
  if (['successful', 'failed', 'cancelled'].includes(fields.status)) {
    fields.completed_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  touch(txn.reference, fields);
  const updated = findByReference(txn.reference);

  if (updated.status === 'successful') {
    finalizeSuccess(updated, { source });
  } else if (['failed', 'cancelled'].includes(updated.status)) {
    notifyFailure(updated);
  }

  return updated;
}

/** Side effects that may only run once, after a server-confirmed payment. */
function finalizeSuccess(txn, { source = 'provider' } = {}) {
  if (txn.purpose === 'ticket') {
    const tickets = require('../tickets');
    const created = tickets.issueForTransaction(txn);
    return created;
  }

  if (txn.purpose === 'promotion') {
    const promotions = require('../promotions');
    return promotions.activateForTransaction(txn);
  }

  notifications.create({
    userId: txn.user_id,
    type: 'payment',
    title: 'Payment received',
    body: `${money.format(txn.amount_cents, txn.currency)} confirmed — reference ${txn.reference}.`,
    link: '/tickets',
  });

  audit(txn.user_id, 'payment.successful', 'transaction', txn.reference, { source });
  return null;
}

function notifyFailure(txn) {
  const label = txn.status === 'cancelled' ? 'cancelled' : 'could not be completed';
  notifications.create({
    userId: txn.user_id,
    type: 'payment',
    title: `Payment ${label}`,
    body: `${money.format(txn.amount_cents, txn.currency)} — reference ${txn.reference}.${txn.failure_reason ? ` ${txn.failure_reason}` : ''}`,
    link: txn.purpose === 'promotion' ? '/promotions' : '/tickets',
  });
}

/* ------------------------------------------------------------------ *
 * Free registrations
 * ------------------------------------------------------------------ */

/**
 * Free events still write a ledger row so the admin dashboard sees every
 * registration, but there is no provider involved: the server confirms the
 * zero-value transaction itself and issues the ticket immediately.
 */
function completeFreeRegistration({ userId, eventId, items = [], attendees = [], notes = '' }) {
  const reference = generateReference('ticket');

  db.prepare(`
    INSERT INTO transactions (
      reference, user_id, event_id, purpose, amount_cents, currency,
      method, provider, status, metadata, receipt, completed_at
    ) VALUES (?, ?, ?, 'ticket', 0, ?, 'free', 'internal', 'successful', ?, ?, datetime('now'))
  `).run(
    reference,
    userId,
    eventId,
    money.DEFAULT_CURRENCY,
    JSON.stringify({ items, attendees, notes, free: true }),
    `FREE-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
  );

  const txn = findByReference(reference);
  finalizeSuccess(txn, { source: 'free_registration' });

  return { transaction: publicTransaction(txn), reference };
}

/* ------------------------------------------------------------------ *
 * Webhooks / provider callbacks
 * ------------------------------------------------------------------ */

async function handleProviderCallback(providerId, payload, context = {}) {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider?.parseWebhook && !provider?.parseCallback) {
    return { ok: false, error: `Unknown provider ${providerId}` };
  }

  const parsed = provider.parseCallback ? provider.parseCallback(payload) : provider.parseWebhook(payload);
  if (!parsed.ok) return parsed;

  const txn = db.prepare('SELECT * FROM transactions WHERE provider_reference = ? ORDER BY id DESC LIMIT 1')
    .get(parsed.provider_reference);

  if (!txn) {
    return { ok: false, error: `No transaction for provider reference ${parsed.provider_reference}` };
  }

  applyProviderResult(txn, parsed, { source: context.source || 'webhook' });
  return { ok: true, reference: txn.reference, outcome: parsed.outcome };
}

/* ------------------------------------------------------------------ *
 * Simulation (sandbox only)
 * ------------------------------------------------------------------ */

/**
 * Complete a payment in sandbox simulation mode.
 * Hard-disabled the moment real provider credentials are configured, so a
 * simulated success can never be mistaken for a real one.
 */
async function simulate(reference, { outcome = 'successful', userId = null } = {}) {
  const txn = findByReference(reference);
  if (!txn) throw Object.assign(new Error('Transaction not found'), { status: 404 });
  if (userId && txn.user_id !== userId) throw Object.assign(new Error('Transaction not found'), { status: 404 });

  const provider = PROVIDERS.find((p) => p.id === txn.provider);
  if (provider?.isConfigured()) {
    throw Object.assign(
      new Error('Simulation is disabled because live payment credentials are configured'),
      { status: 403 }
    );
  }
  if (!ACTIVE_STATUSES.includes(txn.status)) {
    return publicTransaction(txn);
  }

  const mapped = outcome === 'cancelled' ? 'cancelled' : outcome === 'failed' ? 'failed' : 'successful';

  applyProviderResult(txn, {
    status: mapped,
    provider_reference: txn.provider_reference || `SIM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    receipt: mapped === 'successful' ? `SIM${crypto.randomBytes(3).toString('hex').toUpperCase()}` : '',
    failure_reason: mapped === 'failed' ? 'Simulated decline' : mapped === 'cancelled' ? 'Customer cancelled the request' : '',
    amount: mapped === 'successful' ? txn.amount_cents : null,
  }, { source: 'simulation' });

  audit(userId, 'payment.simulated', 'transaction', txn.reference, { outcome: mapped });
  return publicTransaction(findByReference(reference));
}

/* ------------------------------------------------------------------ *
 * Refunds (admin)
 * ------------------------------------------------------------------ */

function refund(reference, { adminId, reason = '' }) {
  const txn = findByReference(reference);
  if (!txn) throw Object.assign(new Error('Transaction not found'), { status: 404 });
  if (txn.status !== 'successful') {
    throw Object.assign(new Error('Only successful payments can be refunded'), { status: 400 });
  }

  const admin = db.prepare('SELECT role FROM users WHERE id = ?').get(adminId);
  if (admin?.role !== 'admin') throw Object.assign(new Error('Administrator access required'), { status: 403 });

  db.transaction(() => {
    touch(txn.reference, {
      status: 'refunded',
      failure_reason: reason ? `Refunded: ${String(reason).slice(0, 150)}` : 'Refunded by admin',
      completed_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });

    const tickets = require('../tickets');
    tickets.markRefunded(txn);

    if (txn.promotion_id) {
      db.prepare("UPDATE promotions SET status = 'cancelled' WHERE id = ?").run(txn.promotion_id);
    }
  });

  notifications.create({
    userId: txn.user_id,
    type: 'payment',
    title: 'Payment refunded',
    body: `${money.format(txn.amount_cents, txn.currency)} for ${txn.reference} has been refunded.${reason ? ` Reason: ${reason}` : ''}`,
    link: '/tickets',
  });

  audit(adminId, 'payment.refunded', 'transaction', txn.reference, { reason });

  return publicTransaction(findByReference(reference));
}

/* ------------------------------------------------------------------ *
 * Ledger queries (admin)
 * ------------------------------------------------------------------ */

function listTransactions({
  status = '', method = '', purpose = '', search = '', userId = null, eventId = null,
  limit = 50, offset = 0,
} = {}) {
  const where = [];
  const params = [];

  if (status) { where.push('x.status = ?'); params.push(status); }
  if (method) { where.push('x.method = ?'); params.push(method); }
  if (purpose) { where.push('x.purpose = ?'); params.push(purpose); }
  if (userId) { where.push('x.user_id = ?'); params.push(userId); }
  if (eventId) { where.push('x.event_id = ?'); params.push(eventId); }
  if (search) {
    where.push('(x.reference LIKE ? OR x.provider_reference LIKE ? OR x.receipt LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR e.title LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT x.*, u.name AS user_name, u.username AS user_username, u.email AS user_email,
           u.avatar_url AS user_avatar, e.title AS event_title
    FROM transactions x
    JOIN users u ON u.id = x.user_id
    LEFT JOIN events e ON e.id = x.event_id
    ${clause}
    ORDER BY x.id DESC LIMIT ? OFFSET ?
  `).all(...params, Math.min(Number(limit) || 50, 200), Number(offset) || 0);

  const { total } = db.prepare(`
    SELECT COUNT(*) AS total FROM transactions x
    JOIN users u ON u.id = x.user_id
    LEFT JOIN events e ON e.id = x.event_id
    ${clause}
  `).get(...params);

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'successful' THEN amount_cents ELSE 0 END), 0) AS settled,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_cents ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_cents ELSE 0 END), 0) AS refunded,
      COALESCE(SUM(CASE WHEN status = 'successful' AND purpose = 'ticket' THEN fee_cents ELSE 0 END), 0) AS commission,
      COALESCE(SUM(CASE WHEN status IN ('pending','processing') AND purpose = 'ticket' THEN fee_cents ELSE 0 END), 0) AS commission_pending,
      COALESCE(SUM(CASE WHEN status = 'refunded' AND purpose = 'ticket' THEN fee_cents ELSE 0 END), 0) AS commission_refunded,
      COUNT(*) AS count
    FROM transactions
  `).get();

  return { transactions: rows.map(publicTransaction), total, totals };
}

function ledgerForUser(userId, limit = 30) {
  return db.prepare(`
    SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?
  `).all(userId, limit).map(publicTransaction);
}

/**
 * Platform commission rate, in percent of the ticket subtotal. Admins set it
 * in the settings panel; a missing setting falls back to the platform default,
 * while a deliberate 0 turns the fee off. This is the single source of truth
 * for pricing, quoting and reporting.
 */
const DEFAULT_SERVICE_FEE_PERCENT = 5;

function serviceFeePercent() {
  const stored = getSetting('service_fee_percent', null);
  const raw = Number(stored === null || stored === '' ? DEFAULT_SERVICE_FEE_PERCENT : stored);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 20) : 0;
}

/**
 * Platform commission — what the service fee on ticket sales has earned.
 *
 * Only settled (successful) ticket transactions count towards the earned
 * figure; anything still awaiting confirmation or refunded is reported
 * separately so the headline number can never overstate income.
 */
function platformCommission() {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'successful' THEN fee_cents ELSE 0 END), 0) AS settled,
      COALESCE(SUM(CASE WHEN status = 'successful' AND created_at >= datetime('now','-30 days')
                        THEN fee_cents ELSE 0 END), 0) AS last_30_days,
      COALESCE(SUM(CASE WHEN status IN ('pending','processing') THEN fee_cents ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN fee_cents ELSE 0 END), 0) AS refunded,
      COUNT(CASE WHEN status = 'successful' AND fee_cents > 0 THEN 1 END) AS settled_count
    FROM transactions
    WHERE purpose = 'ticket'
  `).get();
}

function platformRevenue() {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'successful' THEN amount_cents ELSE 0 END), 0) AS settled,
      COALESCE(SUM(CASE WHEN status = 'successful' AND created_at >= datetime('now','-30 days') THEN amount_cents ELSE 0 END), 0) AS last_30_days,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_cents ELSE 0 END), 0) AS refunded,
      COALESCE(SUM(CASE WHEN status IN ('pending','processing') THEN amount_cents ELSE 0 END), 0) AS pending,
      COUNT(CASE WHEN status = 'successful' THEN 1 END) AS settled_count,
      COUNT(CASE WHEN status = 'successful' AND purpose = 'promotion' THEN 1 END) AS promotion_count
    FROM transactions
  `).get();
}

module.exports = {
  // registry
  providers: PROVIDERS,
  providerModes,
  methodAvailability,
  byMethod,
  // lifecycle
  createIntent,
  completeFreeRegistration,
  syncStatus,
  applyProviderResult,
  handleProviderCallback,
  simulate,
  refund,
  // queries
  findByReference,
  findById,
  publicTransaction,
  listTransactions,
  ledgerForUser,
  platformRevenue,
  platformCommission,
  serviceFeePercent,
  DEFAULT_SERVICE_FEE_PERCENT,
  money,
  STATUSES,
};
