/**
 * Money helpers.
 *
 * All amounts are stored as integer minor units (cents) together with an
 * ISO-4217 currency code. Rounding happens exactly once — at the edge.
 */

const CURRENCIES = {
  KES: { symbol: 'KSh', minor: 2, locale: 'en-KE', label: 'Kenyan Shilling' },
  USD: { symbol: '$', minor: 2, locale: 'en-US', label: 'US Dollar' },
  EUR: { symbol: '€', minor: 2, locale: 'de-DE', label: 'Euro' },
  GBP: { symbol: '£', minor: 2, locale: 'en-GB', label: 'British Pound' },
  NGN: { symbol: '₦', minor: 2, locale: 'en-NG', label: 'Nigerian Naira' },
  ZAR: { symbol: 'R', minor: 2, locale: 'en-ZA', label: 'South African Rand' },
  UGX: { symbol: 'USh', minor: 0, locale: 'en-UG', label: 'Ugandan Shilling' },
  TZS: { symbol: 'TSh', minor: 0, locale: 'en-TZ', label: 'Tanzanian Shilling' },
};

const DEFAULT_CURRENCY = 'KES';

function isSupported(currency) {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, String(currency || '').toUpperCase());
}

function currencyInfo(currency) {
  const code = String(currency || DEFAULT_CURRENCY).toUpperCase();
  return { code, ...(CURRENCIES[code] || CURRENCIES[DEFAULT_CURRENCY]) };
}

/** Convert a user-entered amount ("1,500.50") into minor units. */
function toMinorUnits(amount, currency = DEFAULT_CURRENCY) {
  const info = currencyInfo(currency);
  const numeric = typeof amount === 'number'
    ? amount
    : Number(String(amount ?? '').replace(/[^0-9.-]/g, ''));

  if (!Number.isFinite(numeric)) return 0;

  const factor = 10 ** info.minor;
  return Math.round(numeric * factor);
}

function toMajorUnits(minor, currency = DEFAULT_CURRENCY) {
  const info = currencyInfo(currency);
  return Number(minor || 0) / (10 ** info.minor);
}

/** Human readable string, e.g. "KSh 1,500". */
function format(minor, currency = DEFAULT_CURRENCY) {
  const info = currencyInfo(currency);
  const value = toMajorUnits(minor, info.code);

  try {
    return new Intl.NumberFormat(info.locale, {
      style: 'currency',
      currency: info.code,
      maximumFractionDigits: info.minor,
      minimumFractionDigits: 0,
    }).format(value).replace(/\u00a0/g, ' ');
  } catch (_) {
    return `${info.symbol} ${value.toLocaleString()}`;
  }
}

/** Provider payloads (M-Pesa, Stripe) expect a decimal string/number. */
function forProvider(minor, currency = DEFAULT_CURRENCY) {
  const info = currencyInfo(currency);
  const value = toMajorUnits(minor, info.code);
  return info.minor === 0 ? Math.round(value) : Number(value.toFixed(info.minor));
}

module.exports = {
  CURRENCIES,
  DEFAULT_CURRENCY,
  currencyInfo,
  isSupported,
  toMinorUnits,
  toMajorUnits,
  format,
  forProvider,
};
