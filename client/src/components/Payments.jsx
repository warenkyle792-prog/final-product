import { Check, Landmark, Smartphone, Wallet } from 'lucide-react';
import { Notice, Spinner, StatusPill } from './UI';
import { formatMoney } from '../utils/format';

const ICONS = {
  mpesa: Smartphone,
  card: Landmark,
};

/** Payment method chooser + the fields each method needs. */
export function PaymentMethodPicker({
  methods = [],
  value,
  onChange,
  phone = '',
  onPhoneChange,
  email = '',
  onEmailChange,
  currency = 'KES',
  disabled = false,
}) {
  return (
    <div className="stack">
      <div className="pay-methods" role="radiogroup" aria-label="Payment method">
        {methods.map((method) => {
          const Icon = ICONS[method.id] || Wallet;
          const selected = value === method.id;
          const unavailable = method.currencies && !method.currencies.includes(currency);

          return (
            <button
              key={method.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`pay-method ${selected ? 'is-selected' : ''}`}
              onClick={() => onChange(method.id)}
              disabled={disabled || unavailable}
            >
              <span className="pay-method__logo">
                <Icon size={16} />
              </span>
              <span className="pay-method__info">
                <span className="pay-method__name">
                  {method.label}
                  {method.mode === 'simulation' && <span className="badge badge--warn">Sandbox</span>}
                </span>
                <span className="pay-method__desc">
                  {method.id === 'mpesa'
                    ? 'You will get an STK push prompt on your phone'
                    : unavailable
                      ? `Not available for ${currency}`
                      : 'Visa, Mastercard and Amex via the secure provider form'}
                </span>
              </span>
              {selected && <Check size={17} style={{ color: 'var(--brand)' }} />}
            </button>
          );
        })}
      </div>

      {value === 'mpesa' && (
        <div className="field">
          <label className="field__label" htmlFor="payer-phone">
            M-Pesa phone number <span className="req">*</span>
          </label>
          <input
            id="payer-phone"
            className="input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0712 345 678"
            value={phone}
            onChange={(event) => onPhoneChange(event.target.value)}
            disabled={disabled}
          />
          <p className="field__hint">
            Enter the number registered to your M-Pesa account. The prompt arrives within a
            few seconds.
          </p>
        </div>
      )}

      {value === 'card' && (
        <div className="field">
          <label className="field__label" htmlFor="payer-email">Email for the receipt</label>
          <input
            id="payer-email"
            className="input"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => onEmailChange?.(event.target.value)}
            disabled={disabled}
          />
          <p className="field__hint">
            Card details are collected by the payment provider — EventTracker never sees or
            stores your card number.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Sandbox controls.
 *
 * These buttons only appear while a provider is running in simulation mode
 * (no live credentials configured). They call a backend endpoint that is
 * disabled the moment real credentials exist, so a simulated payment can
 * never be mistaken for a real one.
 */
export function SandboxControls({ transaction, onSimulate, busy = false }) {
  if (!transaction?.metadata?.simulate) return null;

  return (
    <div className="notice notice--warn" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div className="row row--tight" style={{ gap: 8 }}>
        <Wallet size={18} />
        <strong>Sandbox mode</strong>
      </div>
      <p className="small" style={{ color: 'var(--text-1)', marginTop: 4 }}>
        No live payment credentials are configured, so this transaction stays{' '}
        <StatusPill status={transaction.status}>{transaction.status}</StatusPill> until you
        simulate the provider response. Nothing is charged and no money moves.
      </p>
      <div className="row row--tight mt-3">
        <button className="btn btn--primary btn--sm" onClick={() => onSimulate('successful')} disabled={busy}>
          {busy ? <Spinner /> : <Check size={15} />} Approve payment
        </button>
        <button className="btn btn--secondary btn--sm" onClick={() => onSimulate('failed')} disabled={busy}>
          Simulate decline
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => onSimulate('cancelled')} disabled={busy}>
          Simulate cancel
        </button>
      </div>
      <p className="tiny dim mt-2">
        Provider reference: <span className="mono">{transaction.provider_reference || 'pending'}</span>
      </p>
    </div>
  );
}

/** Shared pending / success / failure presentation for a payment. */
export function PaymentStatusView({ status, reference, amountCents, currency, message, children }) {
  if (status === 'successful') {
    return (
      <div className="pay-status">
        <span className="pay-status__icon is-ok">
          <Check size={26} />
        </span>
        <h2>Payment confirmed</h2>
        <p className="muted">
          {formatMoney(amountCents, currency)} · reference <span className="mono">{reference}</span>
        </p>
        {message && <p className="muted small">{message}</p>}
        {children}
      </div>
    );
  }

  if (status === 'failed' || status === 'cancelled') {
    return (
      <div className="pay-status">
        <span className="pay-status__icon is-fail">
          <Wallet size={24} />
        </span>
        <h2>Payment {status}</h2>
        <p className="muted">{message || 'The payment was not completed. You can try again with a different method.'}</p>
        {children}
      </div>
    );
  }

  return (
    <div className="pay-status">
      <span className="pay-status__icon">
        <Spinner size="lg" />
      </span>
      <h2>Waiting for confirmation</h2>
      <p className="muted">{message || 'We are waiting for the provider to confirm this payment.'}</p>
      {reference && <p className="tiny dim">Reference <span className="mono">{reference}</span></p>}
      {children}
    </div>
  );
}

/** Key facts panel reused by checkout, promotions and admin views. */
export function PaymentFact({ label, value, mono = false }) {
  return (
    <div className="summary-row">
      <span>{label}</span>
      <span className={mono ? 'mono' : ''}>{value}</span>
    </div>
  );
}

export { Notice };
