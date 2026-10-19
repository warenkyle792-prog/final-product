/**
 * M-Pesa (Safaricom Daraja) payment provider.
 *
 * The integration is structured exactly like the production flow:
 *
 *   1. OAuth token            GET  /oauth/v1/generate?grant_type=client_credentials
 *   2. STK Push (Lipa na M-Pesa)  POST /mpesa/stkpush/v1/processrequest
 *   3. Customer authorises on their handset
 *   4. Daraja calls our callback URL (ResultCode + receipt)
 *   5. We verify with the STK query API before trusting a callback
 *
 * Credentials are read from the server environment only — they are never
 * sent to, or readable by, the browser.
 *
 *   MPESA_CONSUMER_KEY
 *   MPESA_CONSUMER_SECRET
 *   MPESA_SHORTCODE          (Paybill / Till number)
 *   MPESA_PASSKEY
 *   MPESA_ENV                sandbox | production
 *   MPESA_CALLBACK_URL       public HTTPS URL of /api/payments/webhooks/mpesa
 *
 * When the credentials are absent the provider runs in **sandbox simulation
 * mode**: no request leaves the server, the transaction stays `pending`, and
 * the payment is only completed through an explicitly-flagged simulation
 * endpoint. The UI always shows that this is a simulation.
 */

const crypto = require('crypto');
const money = require('../money');

const PROVIDER = 'mpesa';

const config = () => ({
  consumerKey: process.env.MPESA_CONSUMER_KEY || '',
  consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
  shortcode: process.env.MPESA_SHORTCODE || '',
  passkey: process.env.MPESA_PASSKEY || '',
  env: (process.env.MPESA_ENV || 'sandbox').toLowerCase(),
  callbackUrl: process.env.MPESA_CALLBACK_URL || '',
});

function isConfigured() {
  const c = config();
  return Boolean(c.consumerKey && c.consumerSecret && c.shortcode && c.passkey);
}

function baseUrl() {
  return config().env === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

/** Normalise Kenyan numbers to the 2547XXXXXXXX form Daraja expects. */
function normalizePhone(input) {
  const digits = String(input || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`;
  if (digits.length > 9) return digits;
  return digits;
}

function darajaTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

async function accessToken() {
  const c = config();
  const auth = Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString('base64');

  const res = await fetch(
    `${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  if (!res.ok) {
    throw new Error(`M-Pesa authorisation failed (${res.status})`);
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * Start an STK push. Returns a normalised provider result:
 *   { provider_reference, status, instructions, payload }
 */
async function initiate(transaction) {
  const c = config();

  if (!isConfigured()) {
    return {
      status: 'pending',
      provider_reference: `SIM-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      mode: 'simulation',
      instructions: {
        kind: 'stk_push',
        message: 'Sandbox simulation: confirm on the M-Pesa prompt to complete this payment.',
        phone: normalizePhone(transaction.payer_phone),
      },
      payload: { simulation: true, reason: 'MPESA credentials not configured' },
    };
  }

  const phone = normalizePhone(transaction.payer_phone);
  if (!phone) throw Object.assign(new Error('A valid M-Pesa phone number is required'), { status: 400 });

  const token = await accessToken();
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${c.shortcode}${c.passkey}${timestamp}`).toString('base64');
  const amount = money.forProvider(transaction.amount_cents, transaction.currency);

  if (Number(amount) < 1) throw Object.assign(new Error('M-Pesa requires an amount of at least 1'), { status: 400 });

  const body = {
    BusinessShortCode: c.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: c.shortcode,
    PhoneNumber: phone,
    CallBackURL: c.callbackUrl || 'https://example.invalid/mpesa/callback',
    AccountReference: transaction.reference,
    TransactionDesc: `EventTracker ${transaction.reference}`.slice(0, 60),
  };

  const res = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ResponseCode !== '0') {
    const message = data.errorMessage || data.ResponseDescription || 'M-Pesa rejected the payment request';
    return {
      status: 'failed',
      provider_reference: data.CheckoutRequestID || '',
      mode: 'live',
      failure_reason: message,
      payload: data,
    };
  }

  return {
    status: 'pending',
    provider_reference: data.CheckoutRequestID || '',
    mode: 'live',
    instructions: {
      kind: 'stk_push',
      message: 'Enter your M-Pesa PIN on the prompt sent to your phone to complete payment.',
      phone,
      merchant_request_id: data.MerchantRequestID || '',
    },
    payload: data,
  };
}

/** Ask Safaricom for the authoritative status of an STK request. */
async function verify(transaction) {
  const c = config();

  if (!isConfigured()) {
    return { status: transaction.status, mode: 'simulation' };
  }
  if (!transaction.provider_reference) {
    return { status: transaction.status, mode: 'live' };
  }

  const token = await accessToken();
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${c.shortcode}${c.passkey}${timestamp}`).toString('base64');

  const res = await fetch(`${baseUrl()}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: c.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: transaction.provider_reference,
    }),
  });

  const data = await res.json().catch(() => ({}));
  const code = String(data.ResultCode ?? '');

  if (code === '0') {
    return { status: 'successful', mode: 'live', receipt: '', payload: data };
  }
  if (code === '1032' || code === '1037' || code === '2001') {
    return { status: 'cancelled', mode: 'live', failure_reason: data.ResultDesc || 'Payment cancelled', payload: data };
  }
  if (!code || code === '500.001.1001') {
    // Still being processed by the handset.
    return { status: 'pending', mode: 'live', payload: data };
  }
  return { status: 'failed', mode: 'live', failure_reason: data.ResultDesc || 'Payment failed', payload: data };
}

/**
 * Normalise a Daraja callback body into our internal shape.
 * The caller still needs to match `provider_reference` against a pending
 * transaction — callbacks are never trusted on their own.
 */
function parseCallback(body) {
  const callback = body?.Body?.stkCallback;
  if (!callback) {
    return { ok: false, error: 'Unrecognised M-Pesa callback payload' };
  }

  const items = callback.CallbackMetadata?.Item || [];
  const pick = (name) => items.find((i) => i.Name === name)?.Value;

  const resultCode = Number(callback.ResultCode);
  const outcome = resultCode === 0
    ? 'successful'
    : [1032, 1037, 2001].includes(resultCode) ? 'cancelled' : 'failed';

  return {
    ok: true,
    provider_reference: callback.CheckoutRequestID || '',
    outcome,
    result_code: resultCode,
    result_desc: callback.ResultDesc || '',
    amount: pick('Amount') != null ? money.toMinorUnits(pick('Amount'), 'KES') : null,
    receipt: pick('MpesaReceiptNumber') || '',
    phone: pick('PhoneNumber') ? String(pick('PhoneNumber')) : '',
    payload: callback,
  };
}

/**
 * Optional callback hardening: Safaricom lets you append a shared secret to
 * the callback URL. Requests without it are rejected when MPESA_CALLBACK_TOKEN
 * is configured.
 */
function callbackAllowed(req) {
  const expected = process.env.MPESA_CALLBACK_TOKEN || '';
  if (!expected) return true;
  const provided = req.query.token || req.get('x-callback-token') || '';
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

module.exports = {
  id: PROVIDER,
  label: 'M-Pesa',
  methods: ['mpesa'],
  currencies: ['KES'],
  isConfigured,
  normalizePhone,
  initiate,
  verify,
  parseCallback,
  callbackAllowed,
  /** Present because unconfigured M-Pesa runs as an explicit simulation. */
  supportsSimulation: true,
};
