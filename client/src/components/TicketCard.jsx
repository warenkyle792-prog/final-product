import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Download, MapPin, Printer, QrCode, Share2, Ticket as TicketIcon } from 'lucide-react';

import { Modal, StatusPill } from './UI';
import { formatEventWhen, formatMoney, relativeDay } from '../utils/format';
import { useToast } from '../context/ToastContext';

/**
 * A single ticket: event summary plus a tear-off stub holding the QR code.
 * The QR payload is signed on the server — scanning it only proves the code
 * is genuine, the check-in itself happens against the API.
 */
export default function TicketCard({ ticket, showEventLink = true, compact = false }) {
  const [qrOpen, setQrOpen] = useState(false);
  const { toast } = useToast();

  const isPast = new Date(`${ticket.event.starts_at.replace(' ', 'T')}Z`) < new Date();
  const used = ticket.status === 'used';
  const refunded = ticket.status === 'refunded';

  const share = async () => {
    const url = `${window.location.origin}/tickets/${ticket.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: ticket.event.title, text: `My ticket for ${ticket.event.title}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('Ticket link copied', 'success');
    } catch {
      /* user dismissed the share sheet */
    }
  };

  return (
    <>
      <article className={`ticket ${isPast ? 'ticket--past' : ''} ${used ? 'ticket--used' : ''}`}>
        <div className="ticket__body">
          <div className="ticket__head">
            {ticket.event.image_url && <img src={ticket.event.image_url} alt="" loading="lazy" />}
            <div className="flex-1">
              {showEventLink ? (
                <Link to={`/events/${ticket.event.id}`} className="ticket__title">{ticket.event.title}</Link>
              ) : (
                <span className="ticket__title">{ticket.event.title}</span>
              )}
              <div className="ticket__sub">
                {ticket.event.venue ? `${ticket.event.venue} · ` : ''}{ticket.event.city}
              </div>
            </div>
            <StatusPill status={refunded ? 'refunded' : used ? 'used' : 'valid'}>
              {refunded ? 'Refunded' : used ? 'Checked in' : 'Valid'}
            </StatusPill>
          </div>

          <div className="ticket__grid">
            <div>
              <div className="ticket__field-label">Date &amp; time</div>
              <div className="ticket__field-value">
                <CalendarDays size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 6, color: 'var(--text-3)' }} />
                {formatEventWhen(ticket.event.starts_at, ticket.event.ends_at)}
              </div>
            </div>

            <div>
              <div className="ticket__field-label">Ticket type</div>
              <div className="ticket__field-value">
                {ticket.ticket_type}
                {ticket.price_cents > 0 && (
                  <span className="muted"> · {formatMoney(ticket.price_cents, ticket.event.currency)}</span>
                )}
              </div>
            </div>

            <div>
              <div className="ticket__field-label">Attendee</div>
              <div className="ticket__field-value">{ticket.holder?.name || 'You'}</div>
            </div>

            <div>
              <div className="ticket__field-label">Payment</div>
              <div className="ticket__field-value">
                <StatusPill status={ticket.payment?.status || 'successful'}>
                  {ticket.payment?.status || 'successful'}
                </StatusPill>
              </div>
            </div>
          </div>

          {!compact && (
            <div className="row row--tight small muted">
              <span>{relativeDay(ticket.event.starts_at)}</span>
              <span aria-hidden="true">·</span>
              <span className="mono">{ticket.code}</span>
              {ticket.payment?.reference && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="mono">{ticket.payment.reference}</span>
                </>
              )}
            </div>
          )}

          {!compact && (
            <div className="share-row">
              <button className="btn btn--secondary btn--sm" onClick={() => setQrOpen(true)}>
                <QrCode size={15} /> Show QR code
              </button>
              <button className="btn btn--ghost btn--sm" onClick={share}>
                <Share2 size={15} /> Share
              </button>
              <Link to={`/events/${ticket.event.id}`} className="btn btn--ghost btn--sm">
                <MapPin size={15} /> Event details
              </Link>
            </div>
          )}
        </div>

        <div className="ticket__stub">
          <button
            className="ticket__qr"
            onClick={() => setQrOpen(true)}
            aria-label={`Show QR code for ticket ${ticket.code}`}
            style={{ padding: 6, cursor: 'zoom-in' }}
            dangerouslySetInnerHTML={ticket.qr_svg ? { __html: ticket.qr_svg } : undefined}
          >
            {!ticket.qr_svg && <QrCode size={40} />}
          </button>
          <span className="ticket__code">{ticket.code}</span>
        </div>
      </article>

      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Ticket QR code"
        footer={(
          <>
            <button className="btn btn--ghost" onClick={() => window.print()}>
              <Printer size={16} /> Print
            </button>
            <button className="btn btn--secondary" onClick={share}>
              <Share2 size={16} /> Share link
            </button>
          </>
        )}
      >
        <div className="stack">
          <div className="qr-holder">
            {ticket.qr_svg ? (
              <div dangerouslySetInnerHTML={{ __html: ticket.qr_svg }} />
            ) : (
              <QrCode size={120} />
            )}
            <span className="code">{ticket.code}</span>
          </div>

          <div className="small muted" style={{ textAlign: 'center' }}>
            Show this code at the entrance. Staff scan it once — after check-in the ticket
            is marked as used and cannot be reused.
          </div>

          <div className="notice">
            <TicketIcon size={18} />
            <div>
              <b>{ticket.event.title}</b>
              <div className="small muted">
                {formatEventWhen(ticket.event.starts_at, ticket.event.ends_at)} · {ticket.ticket_type}
              </div>
            </div>
          </div>

          <a className="btn btn--secondary btn--block" href={`/tickets/${ticket.code}`}>
            <Download size={16} /> Open ticket page
          </a>
        </div>
      </Modal>
    </>
  );
}
