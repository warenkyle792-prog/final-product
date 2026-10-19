/**
 * Card payment provider (Stripe-compatible PaymentIntents).
 *
 * Card data never touches EventTracker: the browser collects it with the
 * provider's own hosted UI (Stripe.js / Checkout) using a *publishable* key,
 * while the secret key stays on the server for intent creation and webhook
 * verification.
 *
 *   STRIPE_SECRET_KEY       sk_live_… / sk_test_…   (server only)
 *   STRIPE_PUBLISHABLE_KEY  pk_live_… / pk_test_…   (safe for the browser)
 *   STRIPE_WEBHOOK_SECRET   whsec_…                 (signature verification)
 *
 * Without keys the provider runs in sandbox simulation mode — no network
 * calls are made and the payment can only be completed through the
 * explicitly-flagged simulation endpoint.
 *
 * Adding Paystack, Flutterwave, Pesapal or Adyen later means implementing the
 * same five functions (initiate / verify / parseWebhook / isConfigured /
 * currencies) and registering the module in services/payments/index.js.
 */

const crypto = require('crypto');
const money = require('../money');

const PROVIDER = 'card';
const API = 'https://api.stripe.com/v1';

const config = () => ({
  secretKey: process.env.STRIPE_SECRET_KEY || '',
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
});

function isConfigured() {
  return Boolean(config().secretKey);
}

function publishableKey() {
  return config().publishableKey;
}

async function stripe(path, { method = 'POST', body } = {}) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(body || {})) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }

  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config().secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : params.toString(),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw Object.assign(
      new Error(data?.error?.message || 'Card provider rejected the payment request'),
      { status: 502 }
    );
  }
  return data;
}

function mapIntentStatus(status) {
  switch (status) {
    case 'succeeded':
    case 'requires_capture':
      return 'successful';
    case 'processing':
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
      return 'pending';
    case 'canceled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

async function initiate(transaction) {
  const c = config();

  if (!isConfigured()) {
    return {
      status: 'pending',
      provider_reference: `SIM-CARD-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      mode: 'simulation',
      instructions: {
        kind: 'card',
        message: 'Sandbox simulation: use the simulation controls to approve or decline this card payment.',
      },
      payload: { simulation: true, reason: 'STRIPE_SECRET_KEY not configured' },
    };
  }

  const intent = await stripe('/payment_intents', {
    body: {
      amount: Number(transaction.amount_cents),
      currency: String(transaction.currency).toLowerCase(),
      description: `EventTracker ${transaction.reference}`,
      'metadata[reference]': transaction.reference,
      'metadata[user_id]': transaction.user_id,
      'metadata[purpose]': transaction.purpose,
      automatic_payment_methods: JSON.stringify({ enabled: true }),
      receipt_email: transaction.payer_email || undefined,
    },
  });

  return {
    status: 'pending',
    provider_reference: intent.id,
    mode: 'live',
    instructions: {
      kind: 'card',
      client_secret: intent.client_secret,
      publishable_key: c.publishableKey,
      message: 'Complete the card payment in the secure provider form.',
    },
    payload: { id: intent.id, status: intent.status },
  };
}

async function verify(transaction) {
  if (!isConfigured()) {
    return { status: transaction.status, mode: 'simulation' };
  }
  if (!transaction.provider_reference) {
    return { status: transaction.status, mode: 'live' };
  }

  const intent = await stripe(`/payment_intents/${transaction.provider_reference}`, { method: 'GET' });
  const status = mapIntentStatus(intent.status);

  return {
    status,
    mode: 'live',
    receipt: intent.latest_charge || '',
    failure_reason: intent.last_payment_error?.message || '',
    amount: intent.amount_received ? Number(intent.amount_received) : null,
    payload: { id: intent.id, status: intent.status },
  };
}

/** Verify the `stripe-signature` header against the raw request body. */
function verifySignature(rawBody, signatureHeader) {
  const secret = config().webhookSecret;
  if (!secret) return { ok: false, error: 'STRIPE_WEBHOOK_SECRET is not configured' };
  if (!signatureHeader) return { ok: false, error: 'Missing stripe-signature header' };

  const parts = Object.fromEntries(
    String(signatureHeader).split(',').map((kv) => kv.split('=').map((s) => s.trim()))
  );
  const timestamp = parts.t;
  const expected = parts.v1;

  if (!timestamp || !expected) return { ok: false, error: 'Malformed signature header' };

  // 5 minute replay window.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return { ok: false, error: 'Signature timestamp outside tolerance' };
  }

  const computed = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  if (computed.length !== expected.length) return { ok: false, error: 'Signature mismatch' };

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(expected))
    ? { ok: true }
    : { ok: false, error: 'Signature mismatch' };
}

/**
 * @param {object} event   parsed webhook JSON
 * @param {string} rawBody raw request body (needed for signature checking)
 */
function parseWebhook(event) {
  const intent = event?.data?.object;
  if (!intent?.id) return { ok: false, error: 'Webhook payload has no payment intent' };

  if (event.type === 'payment_intent.succeeded') {
    return {
      ok: true,
      provider_reference: intent.id,
      outcome: 'successful',
      amount: intent.amount_received ? Number(intent.amount_received) : Number(intent.amount),
      receipt: intent.latest_charge || '',
      payload: { id: intent.id, status: intent.status },
    };
  }

  if (event.type === 'payment_intent.payment_failed') {
    return {
      ok: true,
      provider_reference: intent.id,
      outcome: 'failed',
      failure_reason: intent.last_payment_error?.message || 'Card payment failed',
      payload: { id: intent.id, status: intent.status },
    };
  }

  if (event.type === 'payment_intent.canceled') {
    return { ok: true, provider_reference: intent.id, outcome: 'cancelled', payload: { id: intent.id } };
  }

  return { ok: false, error: `Unhandled event type ${event.type}` };
}

module.exports = {
  id: PROVIDER,
  label: 'Card',
  methods: ['card'],
  currencies: ['KES', 'USD', 'EUR', 'GBP', 'NGN', 'ZAR', 'UGX', 'TZS'],
  isConfigured,
  publishableKey,
  initiate,
  verify,
  verifySignature,
  parseWebhook,
  supportsSimulation: true,
  formatAmount: (minor, currency) => money.forProvider(minor, currency),
};
