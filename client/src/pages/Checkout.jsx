import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Check, Clock, Info, Lock, Minus, Plus, ShieldCheck, Ticket as TicketIcon, Users,
} from 'lucide-react';

import {
  LoadingBlock, Notice, Spinner, StatusPill,
} from '../components/UI';
import { PaymentMethodPicker, PaymentStatusView, SandboxControls } from '../components/Payments';
import { api, pollPayment } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useDocumentTitle } from '../hooks';
import { formatEventWhen, formatMoney, relativeDay } from '../utils/format';

const STEPS = [
  { id: 'cart', label: 'Tickets' },
  { id: 'payment', label: 'Payment' },
  { id: 'done', label: 'Confirmation' },
];

export default function Checkout() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  useDocumentTitle('Checkout');

  const [event, setEvent] = useState(null);
  const [items, setItems] = useState(() => location.state?.items || null);
  const [quote, setQuote] = useState(null);
  const [methods, setMethods] = useState([]);
  const [method, setMethod] = useState('mpesa');
  const [phone, setPhone] = useState(user?.phone || '');
  const [email, setEmail] = useState(user?.email || '');
  const [attendeeName, setAttendeeName] = useState(user?.name || '');
  const [loading, setLoading] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [transaction, setTransaction] = useState(null);
  const [instructions, setInstructions] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [stage, setStage] = useState('cart');
  const pollRef = useRef(null);

  /* ----------------------------------------------------------- load */
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [eventData, methodData] = await Promise.all([
          api.get(`/events/${eventId}`),
          api.get('/payments/methods'),
        ]);
        if (!active) return;

        setEvent(eventData.event);
        setMethods(methodData.methods || []);

        const preferred = (methodData.methods || []).find((m) => m.id === 'mpesa') || methodData.methods?.[0];
        if (preferred) setMethod(preferred.id);

        if (!items) {
          const firstAvailable = (eventData.event.ticket_types || []).find((tier) => !tier.is_sold_out);
          if (firstAvailable) setItems([{ ticket_type_id: firstAvailable.id, quantity: 1 }]);
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [eventId, items]);

  useEffect(() => {
    if (user?.phone && !phone) setPhone(user.phone);
    if (user?.email && !email) setEmail(user.email);
    if (user?.name && !attendeeName) setAttendeeName(user.name);
  }, [user, phone, email, attendeeName]);

  /* ---------------------------------------------------------- quote */
  const refreshQuote = useCallback(async () => {
    if (!items?.length) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    try {
      const data = await api.post('/payments/quote', { event_id: eventId, items });
      setQuote(data.quote);
      setError('');
    } catch (err) {
      setQuote(null);
      setError(err.message);
    } finally {
      setQuoting(false);
    }
  }, [eventId, items]);

  useEffect(() => {
    refreshQuote();
  }, [refreshQuote]);

  /* ------------------------------------------------------- lifecycle */
  useEffect(() => () => pollRef.current?.cancel?.(), []);

  const tiers = event?.ticket_types || [];

  const setQuantity = (tier, delta) => {
    setItems((current = []) => {
      const existing = current.find((item) => item.ticket_type_id === tier.id);
      const next = (existing?.quantity || 0) + delta;

      if (next <= 0) return current.filter((item) => item.ticket_type_id !== tier.id);
      if (existing) {
        return current.map((item) =>
          item.ticket_type_id === tier.id
            ? { ...item, quantity: Math.min(next, tier.per_user_limit || 10) }
            : item
        );
      }
      return [...current, { ticket_type_id: tier.id, quantity: 1 }];
    });
  };

  const totalItems = useMemo(
    () => (items || []).reduce((sum, item) => sum + item.quantity, 0),
    [items]
  );

  /* ------------------------------------------------------ start payment */
  const startPayment = async () => {
    if (!items?.length) {
      toast('Choose at least one ticket', 'info');
      return;
    }
    if (method === 'mpesa' && !/^(\+?254|0)\d{9}$/.test(phone.replace(/\s/g, ''))) {
      setError('Enter a valid M-Pesa phone number, for example 0712 345 678');
      return;
    }

    setBusy(true);
    setError('');

    try {
      // Free events skip the provider entirely — but the server still writes
      // the transaction and issues the ticket itself.
      if (quote?.is_free) {
        const result = await api.post(`/events/${eventId}/register`);
        setTickets(result.ticket ? [result.ticket] : []);
        setTransaction(result.transaction);
        setStage('done');
        toast('You are registered — your ticket is ready', 'success');
        return;
      }

      const data = await api.post('/payments/intents', {
        event_id: Number(eventId),
        items,
        method,
        phone,
        email,
        attendees: [{ name: attendeeName, email }],
        idempotency_key: `tickets-${user?.id}-${eventId}-${Date.now().toString(36)}`,
      });

      setTransaction(data.transaction);
      setInstructions(data.instructions);
      setStage('payment');

      if (data.transaction.status === 'successful') {
        await finish(data.transaction.reference);
        return;
      }

      // Poll the server, which in turn asks the provider.
      pollRef.current = pollPayment(data.transaction.reference, {
        onUpdate: (payload) => {
          setTransaction(payload.transaction);
          if (payload.tickets?.length) setTickets(payload.tickets);
        },
      });

      const final = await pollRef.current;
      if (final?.transaction?.status === 'successful') {
        setTickets(final.tickets || []);
        setStage('done');
      }
    } catch (err) {
      setError(err.message);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const finish = async (reference) => {
    try {
      const data = await api.get(`/payments/${reference}`);
      setTransaction(data.transaction);
      setTickets(data.tickets || []);
      if (data.transaction.status === 'successful') setStage('done');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const simulate = async (outcome) => {
    if (!transaction) return;
    setBusy(true);
    try {
      const data = await api.post(`/payments/${transaction.reference}/simulate`, { outcome });
      setTransaction(data.transaction);
      setTickets(data.tickets || []);
      if (data.transaction.status === 'successful') setStage('done');
      else toast(`Simulated ${outcome}`, 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelPayment = async () => {
    if (!transaction) return;
    pollRef.current?.cancel?.();
    try {
      const data = await api.post(`/payments/${transaction.reference}/cancel`);
      setTransaction(data.transaction);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  /* ------------------------------------------------------------- render */
  if (authLoading || loading) {
    return <div className="page"><div className="container"><LoadingBlock label="Preparing checkout…" /></div></div>;
  }

  if (!user) {
    return (
      <div className="page">
        <div className="container">
          <Notice tone="brand" icon={<Lock size={18} />} title="Sign in to continue">
            <Link to="/login" state={{ from: `/checkout/${eventId}` }} className="text-brand">Sign in</Link>{' '}
            or <Link to="/register" className="text-brand">create an account</Link> to buy tickets.
          </Notice>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="page">
        <div className="container">
          <Notice tone="danger" icon={<Info size={18} />} title="Event unavailable">
            {error || 'We could not load this event.'}
          </Notice>
        </div>
      </div>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.id === stage);

  return (
    <div className="page">
      <div className="container">
        <Link to={`/events/${event.id}`} className="btn btn--ghost btn--sm mb-4">
          <ArrowLeft size={15} /> Back to event
        </Link>

        <div className="page-head">
          <div>
            <h1>{stage === 'done' ? 'You are going' : 'Checkout'}</h1>
            <p>{event.title}</p>
          </div>

          <div className="steps">
            {STEPS.map((step, index) => (
              <span
                key={step.id}
                className={`step ${index === stepIndex ? 'is-active' : ''} ${index < stepIndex ? 'is-done' : ''}`}
              >
                <span className="step__num">{index < stepIndex ? <Check size={12} /> : index + 1}</span>
                <span>{step.label}</span>
                {index < STEPS.length - 1 && <span className="step__line" />}
              </span>
            ))}
          </div>
        </div>

        <div className="checkout">
          <div className="checkout__main">
            {stage === 'done' ? (
              <div className="panel panel--pad">
                <PaymentStatusView
                  status="successful"
                  reference={transaction?.reference}
                  amountCents={transaction?.amount_cents}
                  currency={transaction?.currency}
                  message={quote?.is_free ? 'Free registration confirmed.' : 'Your tickets have been issued.'}
                >
                  <div className="row row--tight" style={{ justifyContent: 'center', marginTop: 8 }}>
                    <Link to="/tickets" className="btn btn--primary">
                      <TicketIcon size={16} /> View my tickets
                    </Link>
                    <Link to={`/events/${event.id}`} className="btn btn--secondary">
                      Back to event
                    </Link>
                  </div>

                  {tickets.length > 0 && (
                    <div className="stack stack--sm mt-5 w-full" style={{ textAlign: 'left' }}>
                      {tickets.map((ticket) => (
                        <div className="notice notice--ok" key={ticket.code}>
                          <Check size={18} />
                          <div>
                            <b className="mono">{ticket.code}</b>
                            <div className="small muted">
                              {ticket.ticket_type} · {ticket.holder?.name}
                            </div>
                          </div>
                          <Link to={`/tickets/${ticket.code}`} className="btn btn--secondary btn--sm" style={{ marginLeft: 'auto' }}>
                            Open ticket
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                </PaymentStatusView>
              </div>
            ) : stage === 'payment' && transaction ? (
              <div className="panel panel--pad">
                <PaymentStatusView
                  status={transaction.status}
                  reference={transaction.reference}
                  amountCents={transaction.amount_cents}
                  currency={transaction.currency}
                  message={
                    transaction.status === 'pending' && method === 'mpesa'
                      ? 'Enter your M-Pesa PIN on the prompt sent to your phone. This page updates automatically.'
                      : transaction.status === 'pending'
                        ? 'Complete the payment in the provider window, then come back to this page.'
                        : transaction.failure_reason || undefined
                  }
                >
                  <div className="stack w-full mt-5" style={{ textAlign: 'left' }}>
                    <SandboxControls transaction={transaction} onSimulate={simulate} busy={busy} />

                    {transaction.status === 'pending' && (
                      <>
                        <div className="notice">
                          <Clock size={18} />
                          <div>
                            <b>Reference {transaction.reference}</b>
                            <div className="small muted">
                              Paying {formatMoney(transaction.amount_cents, transaction.currency)} by{' '}
                              {transaction.method === 'mpesa' ? 'M-Pesa' : 'card'}
                              {transaction.payer_phone ? ` · ${transaction.payer_phone}` : ''}
                            </div>
                          </div>
                        </div>

                        <div className="row row--tight">
                          <button className="btn btn--secondary btn--sm" onClick={() => finish(transaction.reference)}>
                            Check status now
                          </button>
                          <button className="btn btn--ghost btn--sm" onClick={cancelPayment}>
                            Cancel payment
                          </button>
                        </div>
                      </>
                    )}

                    {(transaction.status === 'failed' || transaction.status === 'cancelled') && (
                      <div className="row row--tight">
                        <button className="btn btn--primary" onClick={() => { setStage('cart'); setTransaction(null); }}>
                          Try another method
                        </button>
                      </div>
                    )}
                  </div>
                </PaymentStatusView>
              </div>
            ) : (
              <>
                <div className="panel panel--pad">
                  <h2 className="section-title" style={{ fontSize: 'var(--fs-lg)' }}>
                    <TicketIcon size={18} /> Choose your tickets
                  </h2>

                  <div className="mt-5">
                    {tiers.map((tier) => {
                      const quantity = items?.find((item) => item.ticket_type_id === tier.id)?.quantity || 0;
                      const disabled = tier.is_sold_out;

                      return (
                        <div key={tier.id} className={`tier ${quantity > 0 ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}>
                          <span className="tier__radio" aria-hidden="true" />
                          <span className="tier__info">
                            <span className="tier__name">{tier.name}</span>
                            {tier.description && <span className="tier__desc">{tier.description}</span>}
                            <span className="tier__meta">
                              {tier.is_sold_out
                                ? <span className="text-danger">Sold out</span>
                                : tier.quantity > 0 ? `${tier.remaining} left` : 'Open capacity'}
                              <span>Max {tier.per_user_limit} per order</span>
                            </span>
                          </span>

                          <span className="row row--tight" style={{ gap: 10 }}>
                            <span className="tier__price">{tier.price_formatted}</span>
                            <span className="qty">
                              <button
                                type="button"
                                onClick={() => setQuantity(tier, -1)}
                                disabled={quantity === 0}
                                aria-label={`Fewer ${tier.name}`}
                              >
                                <Minus size={13} />
                              </button>
                              <span>{quantity}</span>
                              <button
                                type="button"
                                onClick={() => setQuantity(tier, 1)}
                                disabled={disabled}
                                aria-label={`More ${tier.name}`}
                              >
                                <Plus size={13} />
                              </button>
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="panel panel--pad">
                  <h2 className="section-title" style={{ fontSize: 'var(--fs-lg)' }}>
                    <Users size={18} /> Attendee details
                  </h2>
                  <p className="muted small mt-2">
                    The name printed on the ticket. You can change it later from your tickets page.
                  </p>

                  <div className="form-grid mt-4">
                    <div className="field">
                      <label className="field__label" htmlFor="attendee-name">Full name</label>
                      <input
                        id="attendee-name"
                        className="input"
                        value={attendeeName}
                        onChange={(e) => setAttendeeName(e.target.value)}
                        placeholder="Your name"
                      />
                    </div>
                    <div className="field">
                      <label className="field__label" htmlFor="attendee-email">Email</label>
                      <input
                        id="attendee-email"
                        className="input"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                      />
                    </div>
                  </div>
                </div>

                <div className="panel panel--pad">
                  <h2 className="section-title" style={{ fontSize: 'var(--fs-lg)' }}>
                    <ShieldCheck size={18} /> Payment method
                  </h2>

                  {quote?.is_free ? (
                    <Notice tone="ok" icon={<Check size={18} />} title="This event is free">
                      No payment is needed. We will still issue a ticket with a QR code so the
                      organiser can check you in.
                    </Notice>
                  ) : (
                    <div className="mt-4">
                      <PaymentMethodPicker
                        methods={methods}
                        value={method}
                        onChange={setMethod}
                        phone={phone}
                        onPhoneChange={setPhone}
                        email={email}
                        onEmailChange={setEmail}
                        currency={quote?.currency || event.currency}
                      />
                    </div>
                  )}
                </div>

                {error && <Notice tone="danger" icon={<Info size={18} />}>{error}</Notice>}
              </>
            )}
          </div>

          {/* Order summary -------------------------------------- */}
          <aside className="checkout__aside">
            <div className="panel panel--pad">
              <span className="eyebrow">Order summary</span>

              <div className="row row--tight mt-3">
                <img
                  src={event.image_url || '/uploads/covers/event-01-music.svg'}
                  alt=""
                  style={{ width: 56, height: 56, borderRadius: 'var(--r-sm)', objectFit: 'cover' }}
                />
                <div className="flex-1">
                  <div className="medium">{event.title}</div>
                  <div className="small muted">{relativeDay(event.starts_at)}</div>
                </div>
              </div>

              <p className="small muted mt-2">{formatEventWhen(event.starts_at, event.ends_at)}</p>
              <p className="small muted">{[event.venue, event.city].filter(Boolean).join(', ')}</p>

              <hr className="divider" />

              <div className="order-summary">
                {(quote?.lines || []).map((line) => (
                  <div className="order-line" key={line.ticket_type_id}>
                    <div>
                      <div className="order-line__name">{line.name}</div>
                      <div className="order-line__meta">
                        {line.quantity} × {formatMoney(line.unit_price_cents, quote.currency)}
                      </div>
                    </div>
                    <div className="medium">{formatMoney(line.line_total_cents, quote.currency)}</div>
                  </div>
                ))}

                {!quote && <p className="muted small">{quoting ? 'Calculating…' : 'Select tickets to see the total.'}</p>}

                {quote && (
                  <>
                    <div className="summary-row mt-3">
                      <span>Subtotal</span>
                      <span>{formatMoney(quote.subtotal_cents, quote.currency)}</span>
                    </div>

                    {quote.service_fee_cents > 0 && (
                      <div className="summary-row">
                        <span>Service fee ({quote.service_fee_percent}%)</span>
                        <span>{formatMoney(quote.service_fee_cents, quote.currency)}</span>
                      </div>
                    )}

                    <div className="summary-row summary-row--total">
                      <span>Total</span>
                      <span>{formatMoney(quote.total_cents, quote.currency)}</span>
                    </div>
                  </>
                )}
              </div>

              {stage !== 'done' && (
                <button
                  className="btn btn--primary btn--lg btn--block mt-5"
                  onClick={startPayment}
                  disabled={busy || !items?.length || (quote && !quote.is_free && transaction?.status === 'pending')}
                >
                  {busy ? <Spinner /> : quote?.is_free ? <Check size={17} /> : <Lock size={16} />}
                  {quote?.is_free
                    ? 'Complete registration'
                    : `Pay ${quote ? formatMoney(quote.total_cents, quote.currency) : ''}`}
                </button>
              )}

              {totalItems > 0 && stage === 'cart' && (
                <p className="tiny dim mt-3" style={{ textAlign: 'center' }}>
                  {totalItems} ticket{totalItems > 1 ? 's' : ''} · payment verified on the server before tickets are issued
                </p>
              )}
            </div>

            <div className="panel panel--pad-sm">
              <div className="row row--tight small muted">
                <ShieldCheck size={16} />
                <span>
                  Payments are processed by the provider and confirmed by our server. EventTracker
                  never stores card details.
                </span>
              </div>
            </div>

            {transaction && (
              <div className="panel panel--pad-sm">
                <div className="row row--between">
                  <span className="small muted">Status</span>
                  <StatusPill status={transaction.status} />
                </div>
                <div className="small muted mt-2">
                  Reference <span className="mono">{transaction.reference}</span>
                </div>
              </div>
            )}

            {stage === 'done' && (
              <Link to="/tickets" className="btn btn--secondary btn--block">
                Go to my tickets <ArrowRight size={15} />
              </Link>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
