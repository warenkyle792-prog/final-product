/**
 * Date, money and text formatting helpers.
 * Amounts are integers in minor units (cents) with an ISO currency code.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** SQLite stores UTC "YYYY-MM-DD HH:MM:SS"; treat bare strings as UTC. */
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const str = String(value);
  const normalised = str.includes('T') ? str : str.replace(' ', 'T');
  const withZone = /Z|[+-]\d{2}:?\d{2}$/.test(normalised) ? normalised : `${normalised}Z`;
  const d = new Date(withZone);

  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value, { year = false, weekday = true } = {}) {
  const d = parseDate(value);
  if (!d) return '';
  const parts = [];
  if (weekday) parts.push(`${DAYS[d.getDay()]},`);
  parts.push(`${MONTHS[d.getMonth()]} ${d.getDate()}`);
  if (year) parts.push(`, ${d.getFullYear()}`);
  return parts.join(' ');
}

export function formatLongDate(value) {
  const d = parseDate(value);
  if (!d) return '';
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatTime(value, { withZone = false } = {}) {
  const d = parseDate(value);
  if (!d) return '';
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}${withZone ? ' EAT' : ''}`;
}

export function formatDateTime(value) {
  const d = parseDate(value);
  if (!d) return '';
  return `${formatDate(value)} · ${formatTime(value)}`;
}

/** "Sat, Mar 14 · 7:00 PM – 11:00 PM" (collapses the date when it matches). */
export function formatEventWhen(startsAt, endsAt) {
  const start = parseDate(startsAt);
  if (!start) return '';
  const base = `${formatDate(startsAt)} · ${formatTime(startsAt)}`;

  const end = parseDate(endsAt);
  if (!end) return base;

  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) return `${base} – ${formatTime(endsAt)}`;
  return `${base} – ${formatDate(endsAt)} ${formatTime(endsAt)}`;
}

export function formatDuration(startsAt, endsAt) {
  const start = parseDate(startsAt);
  const end = parseDate(endsAt);
  if (!start || !end) return '';
  const minutes = Math.round((end - start) / 60000);
  if (minutes <= 0) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours} hr${hours > 1 ? 's' : ''}${mins ? ` ${mins} min` : ''}`;
}

export function monthDay(value) {
  const d = parseDate(value);
  if (!d) return { mon: '', day: '' };
  return { mon: MONTHS[d.getMonth()].toUpperCase(), day: d.getDate() };
}

export function relativeDay(value) {
  const d = parseDate(value);
  if (!d) return '';
  const dayMs = 86400000;
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((a - b) / dayMs);

  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return `In ${days} days`;
  if (days < -1 && days > -7) return `${Math.abs(days)} days ago`;
  return formatDate(value);
}

export function timeAgo(value) {
  const d = parseDate(value);
  if (!d) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(value);
}

export function timeLabel(value) {
  const d = parseDate(value);
  if (!d) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(value);
  return timeAgo(value);
}

/** Countdown used on event pages ("starts in 3 days"). */
export function countdown(value) {
  const d = parseDate(value);
  if (!d) return '';
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return 'Happening now or already finished';

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `Starts in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Starts in ${hours} hr${hours > 1 ? 's' : ''}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Starts in ${days} day${days > 1 ? 's' : ''}`;
  const months = Math.floor(days / 30);
  return `Starts in ${months} month${months > 1 ? 's' : ''}`;
}

export function formatMoney(cents, currency = 'KES') {
  const value = (Number(cents) || 0) / 100;
  const locale = currency === 'KES' ? 'en-KE' : 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
      .format(value)
      .replace(/\u00a0/g, ' ');
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

export function formatPrice(cents, currency = 'KES') {
  if (!cents) return 'Free';
  return formatMoney(cents, currency);
}

/** Compact numbers for dashboards: 1.2k, 18.4k */
export function compactNumber(value) {
  const n = Number(value) || 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}

export function initials(name = '') {
  return String(name)
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function pluralise(count, singular, plural) {
  return Number(count) === 1 ? singular : plural || `${singular}s`;
}

export function truncate(text, length = 120) {
  const value = String(text || '');
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
}

/** Google Maps / OpenStreetMap friendly search link for a venue. */
export function mapUrl({ venue, city, country }) {
  const query = [venue, city, country].filter(Boolean).join(', ');
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
}

export function statusLabel(status) {
  return String(status || '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}
