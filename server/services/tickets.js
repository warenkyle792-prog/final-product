/**
 * Ticket service.
 *
 * A ticket is only ever created from a transaction that the *server* has
 * confirmed. Each ticket carries a human-readable code and an HMAC signature
 * that the QR payload embeds, so a scanned code can be validated offline
 * (signature check) and online (event ownership + single-use check-in).
 */
const crypto = require('crypto');
const QRCode = require('qrcode');

const db = require('../db');
const { getUserById, listTicketTypes } = require('../db/helpers');
const notifications = require('./notifications');

const TICKET_SECRET = process.env.TICKET_SECRET || process.env.JWT_SECRET || 'eventtracker-dev-ticket-secret';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters

function randomBlock(length) {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function generateCode() {
  return `ET-${randomBlock(4)}-${randomBlock(4)}`;
}

function signatureFor(code, eventId) {
  return crypto
    .createHmac('sha256', TICKET_SECRET)
    .update(`${code}:${eventId}`)
    .digest('base64url')
    .slice(0, 24);
}

function checkSignature(code, eventId, signature) {
  const expected = signatureFor(code, eventId);
  if (typeof signature !== 'string' || signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

const TICKET_SELECT = `
  SELECT t.*, e.title AS event_title, e.starts_at, e.ends_at, e.venue, e.city, e.country,
         e.image_url AS event_image, e.currency AS event_currency, e.host_id, e.status AS event_status,
         tt.name AS ticket_type_name, tt.price_cents AS ticket_type_price,
         u.name AS holder_username, u.username AS holder_handle, u.avatar_url AS holder_avatar,
         h.name AS host_name, h.username AS host_username, h.avatar_url AS host_avatar,
         x.id AS transaction_ref_id, x.reference AS transaction_reference, x.status AS transaction_status,
         x.method AS transaction_method
  FROM tickets t
  JOIN events e ON e.id = t.event_id
  LEFT JOIN ticket_types tt ON tt.id = t.ticket_type_id
  JOIN users u ON u.id = t.user_id
  JOIN users h ON h.id = e.host_id
  LEFT JOIN transactions x ON x.id = t.transaction_id
`;

function mapTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    issued_at: row.issued_at,
    checked_in_at: row.checked_in_at,
    event_id: row.event_id,
    user_id: row.user_id,
    ticket_type_id: row.ticket_type_id,
    transaction_id: row.transaction_id,
    holder_name: row.holder_name,
    holder_email: row.holder_email,
    ticket_type: row.ticket_type_name || 'General admission',
    price_cents: Number(row.ticket_type_price || 0),
    event: {
      id: row.event_id,
      title: row.event_title,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      venue: row.venue,
      city: row.city,
      country: row.country,
      image_url: row.event_image,
      currency: row.event_currency,
      status: row.event_status,
      host_id: row.host_id,
      host_name: row.host_name,
      host_username: row.host_username,
      host_avatar: row.host_avatar,
    },
    holder: {
      id: row.user_id,
      name: row.holder_name || row.holder_username,
      username: row.holder_handle,
      avatar_url: row.holder_avatar,
    },
    payment: {
      reference: row.transaction_reference,
      status: row.transaction_status,
      method: row.transaction_method,
    },
  };
}

function getByCode(code) {
  return mapTicket(db.prepare(`${TICKET_SELECT} WHERE t.code = ?`).get(String(code || '').toUpperCase().trim()));
}

function getById(id) {
  return mapTicket(db.prepare(`${TICKET_SELECT} WHERE t.id = ?`).get(id));
}

function listForUser(userId) {
  return db.prepare(`${TICKET_SELECT} WHERE t.user_id = ? ORDER BY e.starts_at ASC, t.id DESC`)
    .all(userId)
    .map(mapTicket);
}

function listForEvent(eventId) {
  return db.prepare(`${TICKET_SELECT} WHERE t.event_id = ? ORDER BY t.id DESC LIMIT 500`)
    .all(eventId)
    .map(mapTicket);
}

/** Signed, scannable payload embedded in the QR code. */
function qrPayload(ticket) {
  return JSON.stringify({
    v: 1,
    c: ticket.code,
    e: ticket.event_id,
    s: signatureFor(ticket.code, ticket.event_id),
  });
}

function verifyUrl(ticket) {
  const base = process.env.PUBLIC_APP_URL || '';
  return `${base}/verify?code=${encodeURIComponent(ticket.code)}`;
}

async function qrSvg(ticket) {
  return QRCode.toString(qrPayload(ticket), {
    type: 'svg',
    margin: 1,
    width: 320,
    errorCorrectionLevel: 'M',
    color: { dark: '#0a0a0a', light: '#ffffff' },
  });
}

/** Full API shape: ticket + QR + signed payload. */
async function present(ticket, { includeQr = true } = {}) {
  if (!ticket) return null;
  const out = { ...ticket, qr_payload: qrPayload(ticket), verify_url: verifyUrl(ticket) };
  if (includeQr) out.qr_svg = await qrSvg(ticket);
  return out;
}

function encodePayload(ticket) {
  return Buffer.from(qrPayload(ticket)).toString('base64url');
}

/**
 * Issue tickets for a paid transaction.
 *
 * `transaction.metadata` holds the cart:
 *   { items: [{ ticket_type_id, quantity }], attendees: [{ name, email }] }
 *
 * Returns the created tickets. Idempotent: a second call for the same
 * transaction returns the existing tickets instead of duplicating them.
 */
function issueForTransaction(transaction) {
  const existing = db.prepare('SELECT id FROM tickets WHERE transaction_id = ?').all(transaction.id);
  if (existing.length) {
    return existing.map((row) => getById(row.id));
  }

  let cart = {};
  try {
    cart = JSON.parse(transaction.metadata || '{}');
  } catch (_) {
    cart = {};
  }

  const items = Array.isArray(cart.items) ? cart.items : [];
  const attendees = Array.isArray(cart.attendees) ? cart.attendees : [];
  const user = getUserById(transaction.user_id);

  const created = [];
  let attendeeIndex = 0;

  for (const item of items) {
    const tierRow = db.prepare('SELECT * FROM ticket_types WHERE id = ? AND event_id = ?')
      .get(item.ticket_type_id, transaction.event_id);
    if (!tierRow) continue;

    const quantity = Math.max(0, Math.min(Number(item.quantity) || 0, 50));
    for (let i = 0; i < quantity; i += 1) {
      const attendee = attendees[attendeeIndex] || {};
      attendeeIndex += 1;

      const code = generateCode();
      const info = db.prepare(`
        INSERT INTO tickets (code, event_id, user_id, ticket_type_id, transaction_id, holder_name, holder_email)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        code,
        transaction.event_id,
        transaction.user_id,
        tierRow.id,
        transaction.id,
        String(attendee.name || user?.name || '').slice(0, 80),
        String(attendee.email || user?.email || '').slice(0, 120)
      );

      created.push(getById(info.lastInsertRowid));
    }

    db.prepare('UPDATE ticket_types SET sold = sold + ? WHERE id = ?').run(quantity, tierRow.id);
  }

  if (created.length) {
    const event = db.prepare('SELECT title, host_id FROM events WHERE id = ?').get(transaction.event_id);
    notifications.create({
      userId: transaction.user_id,
      type: 'ticket',
      title: created.length > 1 ? `${created.length} tickets confirmed` : 'Your ticket is confirmed',
      body: `${event?.title || 'Event'} — your ticket${created.length > 1 ? 's are' : ' is'} ready.`,
      link: `/tickets/${created[0].code}`,
      eventId: transaction.event_id,
    });
  }

  return created;
}

function markRefunded(transaction) {
  const rows = db.prepare("SELECT id, ticket_type_id FROM tickets WHERE transaction_id = ? AND status != 'refunded'").all(transaction.id);
  for (const row of rows) {
    db.prepare("UPDATE tickets SET status = 'refunded' WHERE id = ?").run(row.id);
    if (row.ticket_type_id) {
      db.prepare('UPDATE ticket_types SET sold = MAX(0, sold - 1) WHERE id = ?').run(row.ticket_type_id);
    }
  }
  return rows.length;
}

function checkInStats(eventId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS checked_in,
      SUM(CASE WHEN status = 'valid' THEN 1 ELSE 0 END) AS valid,
      SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refunded
    FROM tickets WHERE event_id = ?
  `).get(eventId);

  return {
    total: Number(row?.total || 0),
    checked_in: Number(row?.checked_in || 0),
    valid: Number(row?.valid || 0),
    refunded: Number(row?.refunded || 0),
  };
}

/**
 * Validate a scanned code and (optionally) check the holder in.
 * Only the event host or an admin may verify.
 */
function verify(code, { verifierId, checkIn = true } = {}) {
  const ticket = getByCode(code);
  if (!ticket) {
    return { status: 'invalid', message: 'No ticket matches this code.' };
  }

  const verifier = getUserById(verifierId);
  const isOwner = verifier && (ticket.event.host_id === verifier.id || verifier.role === 'admin');
  if (!isOwner) {
    return { status: 'forbidden', message: 'Only the event organiser can verify these tickets.', ticket };
  }

  // A ticket is only ever issued from a server-confirmed transaction, so a
  // linked-but-unpaid transaction means something is inconsistent — refuse it.
  if (ticket.payment?.reference && ticket.payment.status !== 'successful') {
    return { status: 'unpaid', message: 'This ticket is not linked to a completed payment.', ticket };
  }

  if (ticket.status === 'refunded') {
    return { status: 'refunded', message: 'This ticket was refunded.', ticket };
  }
  if (ticket.status === 'cancelled') {
    return { status: 'cancelled', message: 'This ticket was cancelled.', ticket };
  }
  if (ticket.status === 'used') {
    return {
      status: 'already_used',
      message: `Already checked in${ticket.checked_in_at ? ` at ${ticket.checked_in_at}` : ''}.`,
      ticket,
    };
  }

  if (checkIn) {
    db.prepare(`
      UPDATE tickets SET status = 'used', checked_in_at = datetime('now'), checked_in_by = ?
      WHERE id = ?
    `).run(verifierId, ticket.id);
    return { status: 'checked_in', message: 'Checked in — enjoy the event!', ticket: getById(ticket.id) };
  }

  return { status: 'valid', message: 'Ticket is valid.', ticket };
}

/** Validate a scanned QR payload (JSON with signature) without checking in. */
function inspectPayload(payload) {
  let parsed;
  try {
    parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch (_) {
    // Maybe they typed the human-readable code instead.
    return getByCode(payload) ? { status: 'valid_code', code: String(payload).toUpperCase() } : { status: 'invalid' };
  }

  if (!parsed?.c || !parsed?.e || !parsed?.s) return { status: 'invalid' };
  if (!checkSignature(parsed.c, parsed.e, parsed.s)) return { status: 'invalid' };
  return { status: 'ok', code: parsed.c };
}

function tiersSoldSummary(eventId) {
  return listTicketTypes(eventId).map((t) => ({ id: t.id, name: t.name, sold: t.sold, quantity: t.quantity }));
}

module.exports = {
  generateCode,
  signatureFor,
  checkSignature,
  getByCode,
  getById,
  listForUser,
  listForEvent,
  listTicketTypes,
  qrPayload,
  qrSvg,
  present,
  encodePayload,
  issueForTransaction,
  markRefunded,
  checkInStats,
  verify,
  inspectPayload,
  tiersSoldSummary,
};
