import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CalendarDays, Check, Clock, MapPin, Printer, QrCode, Share2, ShieldCheck, Ticket as TicketIcon,
} from 'lucide-react';

import { Avatar, EmptyState, LoadingBlock, Notice, StatusPill } from '../components/UI';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useAsync, useDocumentTitle } from '../hooks';
import { formatEventWhen, formatMoney, mapUrl, relativeDay } from '../utils/format';

export default function TicketDetail() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [checkIn, setCheckIn] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error } = useAsync(
    () => (user ? api.get(`/tickets/${code}`) : Promise.resolve(null)),
    [code, user?.id]
  );

  const ticket = data?.ticket;
  useDocumentTitle(ticket ? `Ticket ${ticket.code}` : 'Ticket');

  const isOrganiser = ticket && user && (ticket.event.host_id === user.id || user.role === 'admin');

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Ticket ${ticket.code}`, text: ticket.event.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('Ticket link copied', 'success');
    } catch {
      /* dismissed */
    }
  };

  const verifyAtDoor = async () => {
    setBusy(true);
    try {
      const result = await api.post('/tickets/verify', { code: ticket.code });
      setCheckIn(result);
      toast(result.message, result.status === 'checked_in' ? 'success' : 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="page">
        <div className="container">
          <EmptyState
            icon={<TicketIcon size={22} />}
            title="Sign in to open this ticket"
            action={<Link to="/login" className="btn btn--primary">Sign in</Link>}
          />
        </div>
      </div>
    );
  }

  if (loading) return <div className="page"><div className="container"><LoadingBlock label="Loading ticket…" /></div></div>;

  if (error || !ticket) {
    return (
      <div className="page">
        <div className="container">
          <EmptyState
            icon={<TicketIcon size={22} />}
            title="Ticket not found"
            text="This ticket does not exist, or it belongs to another account."
            action={<Link to="/tickets" className="btn btn--primary">Back to my tickets</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 780 }}>
        <button className="btn btn--ghost btn--sm mb-4" onClick={() => navigate(-1)}>
          <ArrowLeft size={15} /> Back
        </button>

        <div className="panel panel--pad">
          <div className="row row--between mb-5">
            <div>
              <span className="eyebrow">Ticket</span>
              <h1 style={{ fontSize: 'var(--fs-xl)' }}>{ticket.event.title}</h1>
            </div>
            <StatusPill status={ticket.status === 'used' ? 'used' : ticket.status === 'refunded' ? 'refunded' : 'valid'}>
              {ticket.status === 'used' ? 'Checked in' : ticket.status === 'refunded' ? 'Refunded' : 'Valid'}
            </StatusPill>
          </div>

          <div className="qr-holder">
            {ticket.qr_svg ? (
              <div dangerouslySetInnerHTML={{ __html: ticket.qr_svg }} />
            ) : (
              <QrCode size={140} />
            )}
            <span className="code">{ticket.code}</span>
          </div>

          <p className="small muted mt-4" style={{ textAlign: 'center' }}>
            Show this code at the entrance. It can be scanned once — after check-in it is marked
            as used and cannot be reused.
          </p>

          <hr className="divider" />

          <div className="ticket__grid">
            <div>
              <div className="ticket__field-label">Date &amp; time</div>
              <div className="ticket__field-value">
                {formatEventWhen(ticket.event.starts_at, ticket.event.ends_at)}
                <div className="small muted">{relativeDay(ticket.event.starts_at)}</div>
              </div>
            </div>

            <div>
              <div className="ticket__field-label">Venue</div>
              <div className="ticket__field-value">
                {ticket.event.venue || 'To be announced'}
                <div className="small muted">{[ticket.event.city, ticket.event.country].filter(Boolean).join(', ')}</div>
              </div>
            </div>

            <div>
              <div className="ticket__field-label">Ticket type</div>
              <div className="ticket__field-value">
                {ticket.ticket_type}
                <div className="small muted">
                  {ticket.price_cents > 0 ? formatMoney(ticket.price_cents, ticket.event.currency) : 'Free'}
                </div>
              </div>
            </div>

            <div>
              <div className="ticket__field-label">Attendee</div>
              <div className="ticket__field-value">
                {ticket.holder?.name || 'You'}
                {ticket.holder_email && <div className="small muted">{ticket.holder_email}</div>}
              </div>
            </div>

            <div>
              <div className="ticket__field-label">Payment</div>
              <div className="ticket__field-value">
                <StatusPill status={ticket.payment?.status || 'successful'}>
                  {ticket.payment?.status || 'confirmed'}
                </StatusPill>
                {ticket.payment?.reference && (
                  <div className="small muted mono">{ticket.payment.reference}</div>
                )}
              </div>
            </div>

            <div>
              <div className="ticket__field-label">Checked in</div>
              <div className="ticket__field-value">
                {ticket.checked_in_at || 'Not yet'}
              </div>
            </div>
          </div>

          <div className="share-row mt-6">
            <button className="btn btn--secondary" onClick={share}>
              <Share2 size={16} /> Share ticket
            </button>
            <button className="btn btn--secondary" onClick={() => window.print()}>
              <Printer size={16} /> Print
            </button>
            <Link to={`/events/${ticket.event.id}`} className="btn btn--ghost">
              <CalendarDays size={16} /> Event details
            </Link>
            <a
              className="btn btn--ghost"
              href={mapUrl({ venue: ticket.event.venue, city: ticket.event.city, country: ticket.event.country })}
              target="_blank"
              rel="noreferrer noopener"
            >
              <MapPin size={16} /> Directions
            </a>
          </div>
        </div>

        <div className="panel panel--pad mt-5">
          <span className="eyebrow">Organiser</span>
          <div className="host-card mt-3">
            <Avatar user={{ name: ticket.event.host_name, avatar_url: ticket.event.host_avatar }} />
            <div className="host-card__info">
              <Link to={`/u/${ticket.event.host_username}`} className="host-card__name">{ticket.event.host_name}</Link>
              <div className="host-card__handle">@{ticket.event.host_username}</div>
            </div>
            <Link to={`/events/${ticket.event.id}`} className="btn btn--secondary btn--sm">
              View event
            </Link>
          </div>

          {isOrganiser && (
            <div className="mt-4">
              <Notice tone="brand" icon={<ShieldCheck size={18} />} title="Organiser view">
                You are viewing a ticket for your own event. Use the check-in button at the door —
                it can only be used once.
                <div className="row row--tight mt-3">
                  <button className="btn btn--primary btn--sm" onClick={verifyAtDoor} disabled={busy || ticket.status === 'used'}>
                    <Check size={15} /> Check in this ticket
                  </button>
                  <Link to="/verify" className="btn btn--secondary btn--sm">
                    <QrCode size={15} /> Scanner
                  </Link>
                </div>
              </Notice>
            </div>
          )}

          {checkIn && (
            <Notice
              tone={checkIn.status === 'checked_in' ? 'ok' : 'warn'}
              icon={<Clock size={18} />}
              title={checkIn.status.replace(/_/g, ' ')}
            >
              {checkIn.message}
            </Notice>
          )}
        </div>
      </div>
    </div>
  );
}
