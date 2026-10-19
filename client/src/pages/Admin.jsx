import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, BadgeCheck, Ban, BarChart3, CalendarDays, CheckCircle2, Coins, Crown,
  Eye, Megaphone, Percent, Receipt, RefreshCw, Search, Settings2, ShieldCheck, Ticket, Trash2,
  TrendingUp, Users, Wallet,
} from 'lucide-react';

import {
  Avatar, ConfirmDialog, EmptyState, LoadingBlock, Modal, Notice, SectionHead, StatCard,
  StatusPill, TabBar,
} from '../components/UI';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useAsync, useDocumentTitle } from '../hooks';
import { formatMoney, relativeDay } from '../utils/format';

const TABS = [
  { id: 'overview', label: 'Overview', icon: <BarChart3 size={15} /> },
  { id: 'transactions', label: 'Transactions', icon: <Receipt size={15} /> },
  { id: 'events', label: 'Events', icon: <CalendarDays size={15} /> },
  { id: 'users', label: 'Users', icon: <Users size={15} /> },
  { id: 'promotions', label: 'Promotions', icon: <Megaphone size={15} /> },
  { id: 'settings', label: 'Settings', icon: <Settings2 size={15} /> },
  { id: 'audit', label: 'Audit log', icon: <Activity size={15} /> },
];

export default function Admin() {
  useDocumentTitle('Admin');

  const { user, loading: authLoading } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';

  if (authLoading) return <div className="page"><div className="container"><LoadingBlock label="Checking access…" /></div></div>;

  if (!user || user.role !== 'admin') {
    return (
      <div className="page">
        <div className="container">
          <EmptyState
            icon={<ShieldCheck size={22} />}
            title="Administrator access required"
            text="This area manages platform payments, events, users and settings. Sign in with an admin account to continue."
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
            <span className="eyebrow">Platform administration</span>
            <h1>Operations dashboard</h1>
            <p>Payments, events, people and promotions — everything in one place.</p>
          </div>
        </div>

        <TabBar
          tabs={TABS}
          active={tab}
          onChange={(next) => setParams(next === 'overview' ? {} : { tab: next }, { replace: true })}
        />

        {tab === 'overview' && <Overview />}
        {tab === 'transactions' && <Transactions />}
        {tab === 'events' && <AdminEvents />}
        {tab === 'users' && <AdminUsers />}
        {tab === 'promotions' && <AdminPromotions />}
        {tab === 'settings' && <SettingsPanel />}
        {tab === 'audit' && <AuditLog />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Overview */

/**
 * Loading / failure states for the tab queries. A failed request must say so
 * and offer a retry — never leave the tab spinning forever.
 */
function QueryFallback({ loading, error, label, onRetry }) {
  if (error) {
    return (
      <Notice tone="danger" icon={<AlertTriangle size={18} />} title="That didn’t load">
        <span className="small">
          {error.status === 401 || error.status === 403
            ? 'Your session is no longer valid. Sign in again to see these figures.'
            : error.message || 'The request failed. Check your connection and try again.'}
        </span>
        <div className="row row--tight mt-3">
          <button className="btn btn--secondary btn--sm" onClick={onRetry}><RefreshCw size={14} /> Try again</button>
          {(error.status === 401 || error.status === 403) && (
            <Link to="/login" className="btn btn--primary btn--sm">Sign in</Link>
          )}
        </div>
      </Notice>
    );
  }
  if (loading) return <LoadingBlock label={label} />;
  return null;
}

function Overview() {
  const { data, loading, error, reload } = useAsync(() => api.get('/admin/overview'), []);
  if (error || loading || !data) {
    return <QueryFallback loading={loading} error={error} onRetry={reload} label="Loading platform figures…" />;
  }

  const counts = data.counts;
  const revenue = data.revenue;
  const commission = data.commission;
  const sold = data.tickets_sold;
  const commission_by_event = data.commission_by_event || [];
  const peak = Math.max(1, ...data.daily.map((day) => Number(day.amount || 0)));

  return (
    <>
      <div className="stat-grid">
        <StatCard label="Commission earned" value={commission.settled_formatted} icon={<Coins size={16} />}
          foot={`${commission.percent}% of every ticket · ${commission.pending_formatted} still pending`} />
        <StatCard label="Tickets sold" value={sold.total} icon={<Ticket size={16} />}
          foot={`${sold.paid} paid · ${sold.free} free · ${sold.checked_in} checked in`} />
        <StatCard label="Gross revenue" value={revenue.settled_formatted} icon={<Wallet size={16} />}
          foot={`${revenue.last_30_days_formatted} in the last 30 days`} />
        <StatCard label="Promotion revenue" value={data.promotion_revenue.settled_formatted} icon={<Megaphone size={16} />}
          foot={`${counts.active_promotions} campaigns running`} />
      </div>

      <section className="section">
        <SectionHead
          title="Ticket sales & commission"
          sub={`What every ticket earned the platform — ${commission.percent}% service fee on the ticket subtotal`}
          link={<button className="btn btn--ghost btn--sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>}
        />
        <div className="grid grid--3" style={{ gap: 'var(--s-4)' }}>
          <StatCard label="Settled commission" value={commission.settled_formatted} icon={<Coins size={16} />}
            foot={`${commission.settled_count} paid orders`} />
          <StatCard label="Awaiting confirmation" value={commission.pending_formatted} icon={<Percent size={16} />}
            foot="Earned once the provider confirms" />
          <StatCard label="Refunded commission" value={commission.refunded_formatted} icon={<Receipt size={16} />}
            foot={`${sold.refunded} tickets refunded`} />
        </div>

        <div className="table-wrap mt-5">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th><th>Tickets sold</th><th>Gross collected</th><th>Commission</th><th>Organiser net</th>
              </tr>
            </thead>
            <tbody>
              {commission_by_event.map((event) => (
                <tr key={event.id}>
                  <td>
                    <Link to={`/events/${event.id}`} className="medium">{event.title}</Link>
                    <div className="tiny dim">{event.city || 'Online'} · {relativeDay(event.starts_at)}</div>
                  </td>
                  <td className="small">
                    {event.tickets_sold}
                    {event.tickets_refunded > 0 && <div className="tiny dim">{event.tickets_refunded} refunded</div>}
                  </td>
                  <td className="small">{event.gross_formatted}</td>
                  <td className="medium">{event.commission_formatted}</td>
                  <td className="small muted">{event.net_formatted}</td>
                </tr>
              ))}
              {commission_by_event.length === 0 && (
                <tr>
                  <td colSpan={5}><p className="muted small">No tickets sold yet — commission appears here as orders settle.</p></td>
                </tr>
              )}
            </tbody>
            {commission_by_event.length > 0 && (
              <tfoot>
                <tr>
                  <td className="medium">All events</td>
                  <td className="medium">{sold.total}</td>
                  <td className="medium">{revenue.settled_formatted}</td>
                  <td className="medium">{commission.settled_formatted}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <div className="grid grid--2 mt-6" style={{ gap: 'var(--s-5)' }}>
        <div className="panel panel--pad">
          <SectionHead
            title="Transaction volume"
            sub="Successful payments, last 14 days"
            link={<button className="btn btn--ghost btn--sm" onClick={reload}><RefreshCw size={14} /> Refresh</button>}
          />
          <div className="chart">
            {data.daily.map((day) => (
              <div
                key={day.day}
                className="chart__bar"
                data-empty={Number(day.amount || 0) === 0}
                style={{ height: `${Math.max(4, (Number(day.amount || 0) / peak) * 100)}%` }}
                title={`${day.day}: ${formatMoney(day.amount, 'KES')} across ${day.count} transactions`}
              />
            ))}
            {data.daily.length === 0 && <p className="muted small">No transactions in the last fortnight.</p>}
          </div>
          <div className="chart__labels">
            <span>{data.daily[0]?.day || ''}</span>
            <span>{data.daily[data.daily.length - 1]?.day || ''}</span>
          </div>
        </div>

        <div className="panel panel--pad">
          <SectionHead title="Payment methods" sub="Share of processed volume" />
          <div className="stack">
            {data.by_method.map((method) => {
              const total = data.by_method.reduce((sum, row) => sum + Number(row.amount || 0), 0) || 1;
              const share = Math.round((Number(method.amount || 0) / total) * 100);
              return (
                <div key={method.method}>
                  <div className="row row--between">
                    <span className="medium" style={{ textTransform: 'capitalize' }}>
                      {method.method === 'mpesa' ? 'M-Pesa' : method.method}
                    </span>
                    <span className="small muted">{formatMoney(method.amount, 'KES')} · {share}%</span>
                  </div>
                  <div className="progress mt-2">
                    <span style={{ width: `${Math.max(2, share)}%` }} />
                  </div>
                </div>
              );
            })}
            {data.by_method.length === 0 && <p className="muted small">No payments recorded yet.</p>}
          </div>

          <div className="divider" style={{ margin: 'var(--s-5) 0' }} />

          <div className="row row--between mb-3">
            <span className="eyebrow">Provider mode</span>
          </div>
          <div className="row row--tight" style={{ flexWrap: 'wrap', gap: 8 }}>
            {(data.providers || []).map((provider) => (
              <span className="badge" key={provider.id}>
                {provider.label}: <strong>{provider.mode}</strong>
              </span>
            ))}
          </div>
          {(data.providers || []).some((provider) => provider.mode === 'simulation') && (
            <Notice tone="warn" icon={<AlertTriangle size={18} />} title="Sandbox credentials active">
              <span className="small">
                Live provider keys are not configured, so new payments wait in <code className="mono">pending</code> until
                they are approved from the payment screen. Nothing is charged.
              </span>
            </Notice>
          )}
        </div>
      </div>

      <section className="section">
        <SectionHead title="Latest transactions" sub="Most recent activity across the platform" />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th><th>Customer</th><th>Event</th><th>Method</th><th>Amount</th><th>Status</th><th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="mono small">{transaction.reference}</td>
                  <td><strong>{transaction.user_name}</strong><div className="tiny dim">@{transaction.user_username}</div></td>
                  <td className="small">{transaction.event_title || '—'}</td>
                  <td className="small">{transaction.method === 'mpesa' ? 'M-Pesa' : transaction.method}</td>
                  <td className="medium">{transaction.amount_formatted}</td>
                  <td className="small">{transaction.fee_cents > 0 ? transaction.fee_formatted : <span className="dim">—</span>}</td>
                  <td><StatusPill status={transaction.status} /></td>
                  <td className="small muted">{relativeDay(transaction.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <SectionHead title="Best performing events" sub="By tickets issued and settled revenue" />
        <div className="grid grid--2" style={{ gap: 'var(--s-4)' }}>
          {data.top_events.map((event) => (
            <Link key={event.id} to={`/events/${event.id}`} className="panel panel--pad-sm row row--between">
              <span style={{ minWidth: 0 }}>
                <span className="medium truncate" style={{ display: 'block' }}>{event.title}</span>
                <span className="small muted">{relativeDay(event.starts_at)} · {event.city || 'Online'}</span>
              </span>
              <span className="tiny dim nowrap" style={{ textAlign: 'right' }}>
                {event.tickets} tickets<div>{event.commission_formatted} commission</div>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

/* -------------------------------------------------------------- Transactions */

function Transactions() {
  const { toast } = useToast();
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [refundTarget, setRefundTarget] = useState(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: '80' });
    if (status) params.set('status', status);
    if (method) params.set('method', method);
    if (search.trim()) params.set('q', search.trim());
    return params.toString();
  }, [status, method, search]);

  const { data, loading, error, reload } = useAsync(() => api.get(`/admin/transactions?${query}`), [query]);

  const openDetail = async (reference) => {
    try {
      setDetail(await api.get(`/admin/transactions/${reference}`));
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const refund = async (reason) => {
    try {
      await api.post(`/admin/transactions/${refundTarget}/refund`, { reason });
      toast('Refund recorded — tickets voided', 'success');
      setRefundTarget(null);
      reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const sync = async (reference) => {
    try {
      await api.post(`/admin/transactions/${reference}/sync`, {});
      toast('Re-checked with the provider', 'success');
      reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <>
      <div className="filters">
        <div className="filters__row">
          <span className="input-icon filters__search">
            <Search size={15} />
            <input className="input" placeholder="Search reference, customer or event" value={search}
              onChange={(event) => setSearch(event.target.value)} />
          </span>
          <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {['pending', 'processing', 'successful', 'failed', 'cancelled', 'refunded'].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          <select className="select" value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="">All methods</option>
            <option value="mpesa">M-Pesa</option>
            <option value="card">Card</option>
            <option value="free">Free</option>
          </select>
        </div>
      </div>

      {data && (
        <div className="row row--tight mt-4" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span className="badge">Settled {data.totals_formatted.settled}</span>
          <span className="badge badge--ok">Commission {data.totals_formatted.commission}</span>
          <span className="badge">Pending {data.totals_formatted.pending}</span>
          <span className="badge">Refunded {data.totals_formatted.refunded}</span>
          <span className="badge">{data.total} transactions</span>
        </div>
      )}

      <QueryFallback loading={loading} error={error} onRetry={reload} label="Loading transactions…" />

      {!loading && data && (
        <div className="table-wrap mt-5">
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th><th>Customer</th><th>Purpose</th><th>Method</th>
                <th>Amount</th><th>Commission</th><th>Status</th><th>Created</th><th />
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="mono small">
                    <button className="link" onClick={() => openDetail(transaction.reference)}>{transaction.reference}</button>
                  </td>
                  <td><strong>{transaction.user_name || `#${transaction.user_id}`}</strong></td>
                  <td className="small">
                    {transaction.purpose === 'promotion' ? 'Promotion' : 'Ticket'}
                    {transaction.event_title && <div className="tiny dim truncate" style={{ maxWidth: 200 }}>{transaction.event_title}</div>}
                  </td>
                  <td className="small">{transaction.method === 'mpesa' ? 'M-Pesa' : transaction.method}</td>
                  <td className="medium">{transaction.amount_formatted}</td>
                  <td><StatusPill status={transaction.status} /></td>
                  <td className="small muted">{relativeDay(transaction.created_at)}</td>
                  <td>
                    <div className="row row--tight">
                      <button className="btn btn--ghost btn--sm" onClick={() => sync(transaction.reference)} title="Re-check with provider">
                        <RefreshCw size={14} />
                      </button>
                      {transaction.status === 'successful' && (
                        <button className="btn btn--ghost btn--sm" onClick={() => setRefundTarget(transaction.reference)} title="Refund">
                          <Ban size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {data.transactions.length === 0 && (
                <tr><td colSpan={8} className="muted">No transactions match those filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Transaction detail" size="wide">
        {detail && (
          <div className="stack">
            <div className="row row--between">
              <span className="mono">{detail.transaction.reference}</span>
              <StatusPill status={detail.transaction.status} />
            </div>
            <div className="meta-grid">
              <div><span className="eyebrow">Customer</span>{detail.user?.name} <div className="tiny dim">@{detail.user?.username}</div></div>
              <div><span className="eyebrow">Event</span>{detail.event?.title || '—'}</div>
              <div><span className="eyebrow">Amount</span>{detail.transaction.amount_formatted}</div>
              <div>
                <span className="eyebrow">Platform commission</span>
                {detail.transaction.fee_cents > 0 ? detail.transaction.fee_formatted : '—'}
                {detail.transaction.fee_cents > 0 && (
                  <div className="tiny dim">organiser net {formatMoney(detail.transaction.net_cents, detail.transaction.currency)}</div>
                )}
              </div>
              <div><span className="eyebrow">Method</span>{detail.transaction.method}</div>
              <div><span className="eyebrow">Provider reference</span><span className="mono small">{detail.transaction.provider_reference || '—'}</span></div>
              <div><span className="eyebrow">Created</span>{detail.transaction.created_at}</div>
            </div>
            {detail.tickets?.length > 0 && (
              <div>
                <span className="eyebrow">Tickets issued</span>
                <div className="stack stack--sm mt-2">
                  {detail.tickets.map((ticket) => (
                    <div className="row row--between" key={ticket.code}>
                      <span className="mono small">{ticket.code}</span>
                      <span className="small muted">{ticket.holder_name}</span>
                      <StatusPill status={ticket.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detail.provider_payload && (
              <details>
                <summary className="small muted">Raw provider payload</summary>
                <pre className="mono tiny" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{detail.provider_payload}</pre>
              </details>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(refundTarget)}
        title="Refund this transaction?"
        message="The payment is marked refunded, the issued tickets are voided and the buyer is notified. This cannot be undone."
        confirmLabel="Refund"
        danger
        onCancel={() => setRefundTarget(null)}
        onConfirm={() => refund('Refunded by administrator')}
      />
    </>
  );
}

/* -------------------------------------------------------------------- Events */

function AdminEvents() {
  const { toast } = useToast();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search.trim()) params.set('q', search.trim());
    return params.toString();
  }, [status, search]);

  const { data, loading, error, reload } = useAsync(() => api.get(`/admin/events?${query}`), [query]);

  const act = async (path, body, message) => {
    try {
      await api.post(path, body);
      toast(message, 'success');
      reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const remove = async () => {
    try {
      await api.del(`/admin/events/${confirmDelete}`);
      toast('Event deleted', 'success');
      setConfirmDelete(null);
      reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <>
      <div className="filters">
        <div className="filters__row">
          <span className="input-icon filters__search">
            <Search size={15} />
            <input className="input" placeholder="Search events, organisers or cities" value={search}
              onChange={(event) => setSearch(event.target.value)} />
          </span>
          <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <QueryFallback loading={loading} error={error} onRetry={reload} label="Loading events…" />

      {!loading && data && (
        <div className="table-wrap mt-5">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th><th>Organiser</th><th>When</th><th>Tickets</th><th>Revenue</th>
                <th>Status</th><th>Flags</th><th />
              </tr>
            </thead>
            <tbody>
              {data.events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <Link to={`/events/${event.id}`}><strong>{event.title}</strong></Link>
                    <div className="tiny dim">{event.category_name} · {event.city || 'Online'}</div>
                  </td>
                  <td className="small">@{event.host_username}</td>
                  <td className="small muted">{relativeDay(event.starts_at)}</td>
                  <td className="small">{event.tickets}</td>
                  <td className="small">{formatMoney(event.revenue_cents, event.currency)}</td>
                  <td><StatusPill status={event.status} /></td>
                  <td>
                    <div className="row row--tight" style={{ flexWrap: 'wrap', gap: 6 }}>
                      {event.is_featured ? <span className="badge badge--brand">Featured</span> : null}
                      {event.promotion_plan && <span className="badge">{event.promotion_plan}</span>}
                    </div>
                  </td>
                  <td>
                    <div className="row row--tight">
                      <button
                        className="btn btn--ghost btn--sm"
                        title={event.is_featured ? 'Remove from featured' : 'Feature on home'}
                        onClick={() => act(`/admin/events/${event.id}/feature`, { featured: !event.is_featured },
                          event.is_featured ? 'Removed from featured' : 'Featured on home')}
                      >
                        <Crown size={14} />
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        title="Toggle cancelled"
                        onClick={() => act(`/admin/events/${event.id}/status`,
                          { status: event.status === 'cancelled' ? 'published' : 'cancelled' },
                          event.status === 'cancelled' ? 'Event restored' : 'Event cancelled')}
                      >
                        <Ban size={14} />
                      </button>
                      <button className="btn btn--ghost btn--sm" title="Delete" onClick={() => setConfirmDelete(event.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {data.events.length === 0 && <tr><td colSpan={8} className="muted">No events match those filters.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this event?"
        message="The event, its tiers and guest list are removed permanently. Attendees are not refunded automatically."
        confirmLabel="Delete event"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={remove}
      />
    </>
  );
}

/* --------------------------------------------------------------------- Users */

function AdminUsers() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (role) params.set('role', role);
    return params.toString();
  }, [search, role]);

  const { data, loading, error, reload } = useAsync(() => api.get(`/admin/users?${query}`), [query]);

  const changeRole = async (target, nextRole) => {
    try {
      await api.post(`/admin/users/${target.id}/role`, { role: nextRole });
      toast(`${target.name} is now ${nextRole}`, 'success');
      reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <>
      <div className="filters">
        <div className="filters__row">
          <span className="input-icon filters__search">
            <Search size={15} />
            <input className="input" placeholder="Search name, username or email" value={search}
              onChange={(event) => setSearch(event.target.value)} />
          </span>
          <select className="select" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">All roles</option>
            <option value="user">Attendees</option>
            <option value="organizer">Organisers</option>
            <option value="admin">Admins</option>
          </select>
        </div>
      </div>

      <QueryFallback loading={loading} error={error} onRetry={reload} label="Loading people…" />

      {!loading && data && (
        <div className="table-wrap mt-5">
          <table className="table">
            <thead>
              <tr><th>Member</th><th>Contact</th><th>Location</th><th>Hosted</th><th>Spend</th><th>Role</th><th>Joined</th></tr>
            </thead>
            <tbody>
              {data.users.map((member) => (
                <tr key={member.id}>
                  <td>
                    <span className="row row--tight">
                      <Avatar user={member} size="sm" />
                      <span>
                        <strong>{member.name}</strong>
                        <div className="tiny dim">@{member.username}</div>
                      </span>
                    </span>
                  </td>
                  <td className="small">{member.email}</td>
                  <td className="small muted">{member.location || '—'}</td>
                  <td className="small">{member.events_hosted}</td>
                  <td className="small">{formatMoney(member.spend_cents, 'KES')}</td>
                  <td>
                    <select
                      className="select select--sm"
                      value={member.role}
                      disabled={member.id === me.id}
                      onChange={(event) => changeRole(member, event.target.value)}
                    >
                      <option value="user">user</option>
                      <option value="organizer">organizer</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="small muted">{member.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
              {data.users.length === 0 && <tr><td colSpan={7} className="muted">Nobody matches that search.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Promotions */

function AdminPromotions() {
  const { toast } = useToast();
  const [status, setStatus] = useState('');

  const { data, loading, error, reload } = useAsync(
    () => api.get(`/admin/promotions${status ? `?status=${status}` : ''}`),
    [status]
  );

  const end = async (id) => {
    try {
      await api.post(`/admin/promotions/${id}/end`, {});
      toast('Campaign ended', 'success');
      reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  return (
    <>
      <div className="filters">
        <div className="filters__row">
          <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All campaigns</option>
            <option value="active">Active</option>
            <option value="pending">Awaiting payment</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {data && (
        <div className="stat-grid mt-5">
          <StatCard label="Active campaigns" value={data.summary.active_count} icon={<Eye size={16} />} />
          <StatCard label="Awaiting payment" value={data.summary.pending_count} icon={<Wallet size={16} />} />
          <StatCard label="Settled promotion revenue" value={data.summary.settled_formatted} icon={<Megaphone size={16} />} />
        </div>
      )}

      <QueryFallback loading={loading} error={error} onRetry={reload} label="Loading campaigns…" />

      {!loading && data && (
        <div className="table-wrap mt-5">
          <table className="table">
            <thead>
              <tr><th>Event</th><th>Owner</th><th>Plan</th><th>Window</th><th>Performance</th><th>Paid</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {data.promotions.map((promotion) => (
                <tr key={promotion.id}>
                  <td><Link to={`/events/${promotion.event_id}`}><strong>{promotion.event_title}</strong></Link></td>
                  <td className="small">@{promotion.owner_username}</td>
                  <td className="small">{promotion.plan}</td>
                  <td className="small muted">
                    {promotion.starts_at ? `${promotion.starts_at.slice(0, 10)} → ${promotion.ends_at.slice(0, 10)}` : 'Not started'}
                  </td>
                  <td className="small">{promotion.impressions} views · {promotion.clicks} clicks</td>
                  <td className="small">{promotion.price_formatted}</td>
                  <td><StatusPill status={promotion.status} /></td>
                  <td>
                    {promotion.status === 'active' && (
                      <button className="btn btn--ghost btn--sm" onClick={() => end(promotion.id)}>End</button>
                    )}
                  </td>
                </tr>
              ))}
              {data.promotions.length === 0 && <tr><td colSpan={8} className="muted">No campaigns in this view.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ Settings */

function SettingsPanel() {
  const { toast } = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get('/admin/settings'), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.settings) setForm({ ...data.settings });
  }, [data]);

  if (error || loading || !form) {
    return <QueryFallback loading={loading} error={error} onRetry={reload} label="Loading settings…" />;
  }

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/admin/settings', form);
      toast('Settings saved', 'success');
      reload();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid--2" style={{ gap: 'var(--s-5)', alignItems: 'start' }}>
      <div className="panel panel--pad">
        <SectionHead title="Commerce settings" sub="Applies to new payments only" />

        <div className="stack">
          <div className="field">
            <label className="field__label" htmlFor="fee">Service fee (%)</label>
            <input id="fee" className="input" type="number" min="0" max="25" step="0.1"
              value={form.service_fee_percent}
              onChange={(event) => setForm({ ...form, service_fee_percent: event.target.value })} />
            <span className="field__hint">Added to the order total at checkout and shown before payment.</span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="currency">Platform currency</label>
            <select id="currency" className="select" value={form.platform_currency}
              onChange={(event) => setForm({ ...form, platform_currency: event.target.value })}>
              {['KES', 'USD', 'EUR', 'GBP', 'NGN', 'ZAR', 'UGX', 'TZS'].map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="support">Support email</label>
            <input id="support" className="input" type="email" value={form.support_email}
              onChange={(event) => setForm({ ...form, support_email: event.target.value })} />
          </div>

          <button className="btn btn--primary" onClick={save} disabled={busy}>
            <CheckCircle2 size={16} /> {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>

      <div className="panel panel--pad">
        <SectionHead title="Payment providers" sub="Read-only runtime status" />
        <div className="stack">
          {(data.providers || []).map((provider) => (
            <div className="row row--between" key={provider.id}>
              <span className="medium">
                {provider.label}
                <div className="tiny dim">
                  {provider.methods.join(', ')} · {(provider.currencies || []).join(', ')}
                </div>
              </span>
              <StatusPill status={provider.mode === 'live' ? 'successful' : 'pending'}>
                {provider.mode}
              </StatusPill>
            </div>
          ))}
        </div>

        <Notice icon={<ShieldCheck size={18} />} title="Keys stay server-side">
          <span className="small">
            Provider credentials are read from environment variables on the server. They are never
            sent to the browser, and a payment is only marked successful after the backend verifies
            it with the provider (or the callback signature checks out).
          </span>
        </Notice>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Audit log */

function AuditLog() {
  const { data, loading, error, reload } = useAsync(() => api.get('/admin/audit'), []);
  if (error) return <QueryFallback error={error} onRetry={reload} label="Loading audit log…" />;
  if (loading) return <LoadingBlock label="Loading audit log…" />;

  return (
    <>
      <SectionHead
        title="Administrator activity"
        sub="Every privileged action is recorded with the actor and timestamp"
        icon={<Activity size={17} />}
      />
      <div className="table-wrap mt-4">
        <table className="table">
          <thead>
            <tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {(data?.entries || []).map((entry) => (
              <tr key={entry.id}>
                <td className="small muted nowrap">{entry.created_at}</td>
                <td className="small">{entry.actor_name || 'system'}<div className="tiny dim">@{entry.actor_username || '—'}</div></td>
                <td className="small medium">{entry.action}</td>
                <td className="small">{entry.target_type} {entry.target_id}</td>
                <td className="tiny dim mono truncate" style={{ maxWidth: 260 }}>{entry.detail || '—'}</td>
              </tr>
            ))}
            {(data?.entries || []).length === 0 && <tr><td colSpan={5} className="muted">No admin actions recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
