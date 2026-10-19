import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BadgeCheck, Ban, Check, Crown, Eye, Info, Megaphone, MousePointerClick, Rocket, TrendingUp,
} from 'lucide-react';

import { EmptyState, LoadingBlock, Modal, Notice, Spinner, StatusPill } from '../components/UI';
import { PaymentMethodPicker, PaymentStatusView, SandboxControls } from '../components/Payments';
import { api, pollPayment } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useAsync, useDocumentTitle } from '../hooks';
import { timeAgo } from '../utils/format';

const PLAN_ICONS = { featured: BadgeCheck, boost: TrendingUp, sponsored: Crown };

export default function Promotions() {
  useDocumentTitle('Promotions');

  const { user } = useAuth();
  const { toast } = useToast();
  const [params] = useSearchParams();
  const preselect = params.get('event');

  const [buyOpen, setBuyOpen] = useState(Boolean(preselect));
  const [selectedEvent, setSelectedEvent] = useState(preselect ? Number(preselect) : null);
  const [method, setMethod] = useState('mpesa');
  const [phone, setPhone] = useState(user?.phone || '');
  const [busy, setBusy] = useState(false);
  const [transaction, setTransaction] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const pollRef = useRef(null);

  const { data: planData } = useAsync(() => api.get('/promotions/plans?currency=KES'), []);
  const { data: mine, loading: mineLoading, reload: reloadMine } = useAsync(
    () => (user ? api.get('/promotions/mine') : Promise.resolve(null)),
    [user?.id]
  );
  const { data: hosted } = useAsync(
    () => (user ? api.get('/users/me/overview') : Promise.resolve(null)),
    [user?.id]
  );

  const plans = planData?.plans || [];
  const myEvents = useMemo(
    () => (hosted?.hosted_events || []).filter((event) => event.status !== 'cancelled'),
    [hosted]
  );

  useEffect(() => () => pollRef.current?.cancel?.(), []);

  const startPurchase = async (planId) => {
    if (!selectedEvent) {
      toast('Choose which event to promote', 'info');
      return;
    }
    if (method === 'mpesa' && !/^(\+?254|0)\d{9}$/.test(phone.replace(/\s/g, ''))) {
      toast('Enter a valid M-Pesa phone number', 'error');
      return;
    }

    setBusy(true);
    try {
      const data = await api.post('/promotions', {
        event_id: selectedEvent,
        plan: planId,
        method,
        phone,
        email: user?.email,
      });

      setPromotion(data.promotion);
      setTransaction(data.transaction);

      if (data.transaction.status === 'successful') {
        toast('Promotion is live', 'success');
        reloadMine();
        return;
      }

      pollRef.current = pollPayment(data.transaction.reference, {
        onUpdate: (payload) => setTransaction(payload.transaction),
      });

      const final = await pollRef.current;
      if (final?.transaction?.status === 'successful') {
        setTransaction(final.transaction);
        toast('Payment confirmed — promotion is live', 'success');
        const refreshed = await api.get('/promotions/mine');
        reloadMine();
        setPromotion(refreshed.promotions.find((item) => item.id === data.promotion.id) || data.promotion);
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const simulate = async (outcome) => {
    if (!transaction) return;
    setBusy(true);
    try {
      const data = await api.post(`/payments/${transaction.reference}/simulate`, { outcome });
      setTransaction(data.transaction);
      reloadMine();
      if (data.transaction.status === 'successful') toast('Simulated approval — promotion active', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelPromotion = async (id) => {
    try {
      await api.post(`/promotions/${id}/cancel`);
      toast('Promotion cancelled', 'success');
      reloadMine();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  if (!user) {
    return (
      <div className="page">
        <div className="container">
          <EmptyState
            icon={<Megaphone size={22} />}
            title="Sign in to promote an event"
            text="Promotions are attached to events you organise."
            action={<Link to="/login" className="btn btn--primary">Sign in</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <h1>Promote your events</h1>
            <p>
              Get in front of the right people. Every placement is bought through the same verified
              payment flow as tickets — it only goes live once the payment is confirmed.
            </p>
          </div>
          <button className="btn btn--primary" onClick={() => setBuyOpen(true)}>
            <Rocket size={16} /> Promote an event
          </button>
        </div>

        {/* Plans */}
        <div className="grid grid--3">
          {plans.map((plan) => {
            const Icon = PLAN_ICONS[plan.id] || Megaphone;
            return (
              <div className="panel panel--pad" key={plan.id}>
                <div className="row row--between">
                  <span className="cat-tile__icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                    <Icon size={18} />
                  </span>
                  <span className="badge">{plan.duration_days} days</span>
                </div>

                <h2 className="mt-4" style={{ fontSize: 'var(--fs-lg)' }}>{plan.label}</h2>
                <p className="muted small mt-2">{plan.tagline}</p>

                <div className="mt-4">
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', color: 'var(--text-0)' }}>
                    {plan.price_formatted}
                  </span>
                  <span className="muted small"> / {plan.duration_days} days</span>
                </div>

                <ul className="stack stack--sm mt-4">
                  {plan.perks.map((perk) => (
                    <li className="cta__item" key={perk} style={{ alignItems: 'flex-start' }}>
                      <Check size={15} style={{ marginTop: 4 }} />
                      <span className="small">{perk}</span>
                    </li>
                  ))}
                </ul>

                <button
                  className="btn btn--primary btn--block mt-5"
                  onClick={() => {
                    setBuyOpen(true);
                    setSelectedEvent(myEvents[0]?.id || null);
                  }}
                >
                  Choose this plan
                </button>
              </div>
            );
          })}
        </div>

        {/* My campaigns */}
        <section className="section">
          <div className="row row--between mb-5">
            <h2 className="section-title"><Megaphone size={18} /> My campaigns</h2>
            <Link to="/events/new" className="section-link">Create an event</Link>
          </div>

          {mineLoading && <LoadingBlock label="Loading campaigns…" />}

          {!mineLoading && (mine?.promotions || []).length === 0 && (
            <EmptyState
              icon={<Megaphone size={22} />}
              title="No promotions yet"
              text="Promoted events appear on the home page, at the top of search and inside their category."
              action={<button className="btn btn--primary" onClick={() => setBuyOpen(true)}>Promote an event</button>}
            />
          )}

          {(mine?.promotions || []).length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Plan</th>
                    <th>Window</th>
                    <th>Performance</th>
                    <th>Paid</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {mine.promotions.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link to={`/events/${item.event_id}`}><strong>{item.event_title}</strong></Link>
                        <div className="tiny dim">{item.event_city}</div>
                      </td>
                      <td className="medium">{item.plan}</td>
                      <td className="small muted">
                        {item.starts_at ? `${item.starts_at.slice(0, 10)} → ${item.ends_at.slice(0, 10)}` : 'Not started'}
                        <div className="tiny dim">created {timeAgo(item.created_at)}</div>
                      </td>
                      <td className="small">
                        <span className="row row--tight" style={{ gap: 12 }}>
                          <span><Eye size={13} /> {item.impressions}</span>
                          <span><MousePointerClick size={13} /> {item.clicks}</span>
                        </span>
                      </td>
                      <td>
                        {item.price_formatted}
                        {item.transaction_reference && (
                          <div className="tiny dim mono">{item.transaction_reference}</div>
                        )}
                      </td>
                      <td><StatusPill status={item.status} /></td>
                      <td>
                        {item.status === 'pending' && (
                          <button className="btn btn--ghost btn--sm" onClick={() => cancelPromotion(item.id)}>
                            <Ban size={14} /> Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Purchase flow */}
        <Modal
          open={buyOpen}
          onClose={() => {
            setBuyOpen(false);
            setTransaction(null);
            setPromotion(null);
          }}
          title={transaction ? 'Promotion payment' : 'Promote an event'}
          size="wide"
          footer={!transaction ? (
            <button className="btn btn--ghost" onClick={() => setBuyOpen(false)}>Close</button>
          ) : null}
        >
          {transaction ? (
            <PaymentStatusView
              status={transaction.status}
              reference={transaction.reference}
              amountCents={transaction.amount_cents}
              currency={transaction.currency}
              message={
                transaction.status === 'pending'
                  ? 'Complete the payment on your phone. The placement activates as soon as the provider confirms it.'
                  : transaction.failure_reason || undefined
              }
            >
              <div className="stack w-full mt-4" style={{ textAlign: 'left' }}>
                <SandboxControls transaction={transaction} onSimulate={simulate} busy={busy} />

                {transaction.status === 'successful' && promotion && (
                  <Notice tone="ok" icon={<Check size={18} />} title="Promotion active">
                    {promotion.plan_label} is running until {promotion.ends_at?.slice(0, 10)}.
                  </Notice>
                )}

                {['failed', 'cancelled'].includes(transaction.status) && (
                  <button className="btn btn--primary" onClick={() => setTransaction(null)}>
                    Try again
                  </button>
                )}

                {transaction.status === 'successful' && (
                  <Link to="/promotions" className="btn btn--secondary" onClick={() => setBuyOpen(false)}>
                    View campaigns
                  </Link>
                )}
              </div>
            </PaymentStatusView>
          ) : (
            <div className="stack stack--lg">
              <div className="field">
                <label className="field__label" htmlFor="promote-event">Which event?</label>
                <select
                  id="promote-event"
                  className="select"
                  value={selectedEvent || ''}
                  onChange={(event) => setSelectedEvent(Number(event.target.value))}
                >
                  <option value="">Choose one of your events</option>
                  {myEvents.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title} · {event.starts_at?.slice(0, 10)}
                    </option>
                  ))}
                </select>
                {myEvents.length === 0 && (
                  <p className="field__hint">
                    You have not published an event yet — <Link to="/events/new" className="text-brand">create one first</Link>.
                  </p>
                )}
              </div>

              <div className="field">
                <span className="field__label">Payment method</span>
                <PaymentMethodPicker
                  methods={[
                    { id: 'mpesa', label: 'M-Pesa (KES)', mode: 'simulation' },
                    { id: 'card', label: 'Card', mode: 'simulation' },
                  ]}
                  value={method}
                  onChange={setMethod}
                  phone={phone}
                  onPhoneChange={setPhone}
                  currency="KES"
                />
              </div>

              <Notice icon={<Info size={18} />} title="Pricing">
                Promotion prices are fixed per plan and shown before you pay. The placement
                activates only after the payment provider confirms the transaction.
              </Notice>

              <div className="grid grid--3">
                {plans.map((plan) => (
                  <button
                    key={plan.id}
                    className="tier"
                    style={{ flexDirection: 'column', alignItems: 'stretch', textAlign: 'left' }}
                    onClick={() => startPurchase(plan.id)}
                    disabled={busy || !selectedEvent}
                  >
                    <span className="tier__name">{plan.label}</span>
                    <span className="tier__price mt-2">{plan.price_formatted}</span>
                    <span className="tier__desc">{plan.duration_days} days · {plan.tagline}</span>
                    {busy && <Spinner />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}
