import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Ban, Bookmark, CalendarDays, CheckCircle2, Clock, Globe,
  Mail, MapPin, Megaphone, MessageCircle, Minus, Pencil, Phone, Plus, QrCode, Send,
  Share2, Star, Ticket as TicketIcon, Trash2, TrendingUp, Users,
} from 'lucide-react';

import EventCard from '../components/EventCard';
import {
  Avatar, ConfirmDialog, EmptyState, LoadingBlock, MetaItem, Modal, Notice, SectionHead, Spinner, StatusPill,
} from '../components/UI';
import { api, assetUrl } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useCopy, useDocumentTitle, useScrollLock } from '../hooks';
import {
  countdown, formatDuration, formatEventWhen, formatMoney, mapUrl, parseDate, relativeDay,
} from '../utils/format';

export default function EventDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();

  const [event, setEvent] = useState(null);
  const [related, setRelated] = useState([]);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState({});
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [guestListOpen, setGuestListOpen] = useState(false);
  const [guests, setGuests] = useState(null);
  const { copied, copy } = useCopy();

  useDocumentTitle(event?.title || 'Event');
  useScrollLock(guestListOpen);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/events/${id}`);
      setEvent(data.event);
      setComments(await api.get(`/events/${id}/comments`).then((d) => d.comments).catch(() => []));
      api.get(`/events/${id}/related`).then((d) => setRelated(d.events)).catch(() => setRelated([]));
    } catch (error) {
      toast(error.message, 'error');
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const tiers = event?.ticket_types || [];
  const isHost = user && event && (event.host_id === user.id || isAdmin);

  // Highest-priced tier is preselected so the intended default is sensible.
  useEffect(() => {
    if (!tiers.length) return;
    setSelection((current) => {
      if (Object.keys(current).length) return current;
      const first = tiers.find((tier) => !tier.is_sold_out) || tiers[0];
      return { [first.id]: 1 };
    });
  }, [tiers]);

  const selectionSummary = useMemo(() => {
    const lines = tiers
      .filter((tier) => selection[tier.id] > 0)
      .map((tier) => ({ tier, quantity: selection[tier.id] }));
    const subtotal = lines.reduce((sum, { tier, quantity }) => sum + tier.price_cents * quantity, 0);
    const count = lines.reduce((sum, { quantity }) => sum + quantity, 0);
    return { lines, subtotal, count, currency: event?.currency || 'KES' };
  }, [tiers, selection, event]);

  const setQuantity = (tier, delta) => {
    setSelection((current) => {
      const next = { ...current };
      const value = Math.max(0, Math.min((current[tier.id] || 0) + delta, tier.per_user_limit || 10));
      if (value === 0) delete next[tier.id];
      else next[tier.id] = value;
      return next;
    });
  };

  const requireLogin = () => {
    if (user) return false;
    toast('Sign in to continue', 'info');
    navigate('/login', { state: { from: `/events/${id}` } });
    return true;
  };

  const toggleSave = async () => {
    if (requireLogin()) return;
    setBusy(true);
    try {
      const res = await api.post(`/events/${id}/save`);
      setEvent((current) => ({ ...current, is_saved: res.is_saved }));
      toast(res.is_saved ? 'Saved to your events' : 'Removed from saved', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleFollow = async () => {
    if (requireLogin()) return;
    setBusy(true);
    try {
      const res = await api.post(`/events/${id}/follow`);
      setEvent((current) => ({
        ...current,
        is_following: res.is_following,
        follower_count: res.follower_count,
      }));
      toast(res.is_following ? 'You will get updates for this event' : 'Unfollowed', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: event.title, text: event.tagline || event.title, url });
        return;
      }
      await copy(url);
      toast('Event link copied', 'success');
    } catch {
      /* dismissed */
    }
  };

  const proceedToCheckout = () => {
    if (requireLogin()) return;
    if (!selectionSummary.count) {
      toast('Choose at least one ticket', 'info');
      return;
    }

    navigate(`/checkout/${event.id}`, {
      state: {
        items: selectionSummary.lines.map(({ tier, quantity }) => ({
          ticket_type_id: tier.id,
          quantity,
        })),
      },
    });
  };

  const registerFree = async () => {
    if (requireLogin()) return;
    setBusy(true);
    try {
      const res = await api.post(`/events/${id}/register`);
      setEvent((current) => ({ ...current, has_ticket: true, my_rsvp: 'going' }));
      toast(res.already_registered ? 'You already have a ticket' : 'You are registered — ticket issued', 'success');
      if (res.ticket?.code) navigate(`/tickets/${res.ticket.code}`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const postComment = async (e) => {
    e.preventDefault();
    if (requireLogin()) return;
    if (!comment.trim()) return;

    setPosting(true);
    try {
      const res = await api.post(`/events/${id}/comments`, { body: comment.trim() });
      setComments((current) => [res.comment, ...current]);
      setComment('');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setPosting(false);
    }
  };

  const deleteComment = async (commentId) => {
    try {
      await api.del(`/events/${id}/comments/${commentId}`);
      setComments((current) => current.filter((item) => item.id !== commentId));
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const messageOrganiser = async () => {
    if (requireLogin()) return;
    try {
      const res = await api.post('/conversations', { participantId: event.host_id });
      navigate('/chat', { state: { conversationId: res.conversation.id } });
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const openEventChat = async () => {
    if (requireLogin()) return;
    try {
      const res = await api.post('/conversations', { eventId: event.id });
      navigate('/chat', { state: { conversationId: res.conversation.id } });
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const openGuestList = async () => {
    setGuestListOpen(true);
    setGuests(null);
    try {
      const data = await api.get(`/events/${id}/attendees`);
      setGuests(data);
    } catch (error) {
      toast(error.message, 'error');
      setGuestListOpen(false);
    }
  };

  const cancelEvent = async () => {
    setBusy(true);
    try {
      await api.put(`/events/${id}`, { status: 'cancelled' });
      toast('Event cancelled — attendees have been notified', 'success');
      load();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteEvent = async () => {
    setBusy(true);
    try {
      await api.del(`/events/${id}`);
      toast('Event deleted', 'success');
      navigate('/events');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
      setDeleteOpen(false);
    }
  };

  if (loading) return <div className="page"><div className="container"><LoadingBlock label="Loading event…" /></div></div>;

  if (!event) {
    return (
      <div className="page">
        <div className="container">
          <EmptyState
            icon={<AlertTriangle size={22} />}
            title="Event not found"
            text="This event may have been removed by the organiser."
            action={<Link to="/events" className="btn btn--primary">Browse events</Link>}
          />
        </div>
      </div>
    );
  }

  const sold = Number(event.sold || 0);
  const capacity = Number(event.capacity || 0);
  const availability = event.available;
  const fillPercent = capacity > 0 ? Math.min(100, Math.round((sold / capacity) * 100)) : null;
  const lowestPrice = tiers.length ? Math.min(...tiers.map((tier) => tier.price_cents)) : event.price_cents;
  const allFree = tiers.length ? tiers.every((tier) => tier.price_cents === 0) : event.price_cents === 0;
  const startsAt = parseDate(event.starts_at);

  return (
    <div className="page page--tight">
      <div className="container">
        <Link to="/discover" className="btn btn--ghost btn--sm mb-4">
          <ArrowLeft size={15} /> Back to discovery
        </Link>

        {/* Hero -------------------------------------------------- */}
        <header className="detail-hero">
          {event.video_url ? (
            <video src={assetUrl(event.video_url)} poster={assetUrl(event.image_url)} controls playsInline preload="metadata" />
          ) : (
            <img src={assetUrl(event.image_url) || '/uploads/covers/event-01-music.svg'} alt="" />
          )}
          <div className="detail-hero__veil" />

          <div className="detail-hero__top">
            <div className="row row--tight">
              <span className="flag">{event.category_name}</span>
              {event.is_promoted && (
                <span className="flag flag--promoted">
                  <Megaphone size={11} /> {event.promotion_plan === 'sponsored' ? 'Sponsored' : 'Featured'}
                </span>
              )}
              {event.status === 'cancelled' && <span className="flag flag--soldout">Cancelled</span>}
            </div>

            <div className="row row--tight">
              <button className="btn btn--onmedia btn--sm" onClick={toggleSave} disabled={busy}>
                <Bookmark size={15} fill={event.is_saved ? 'currentColor' : 'none'} />
                {event.is_saved ? 'Saved' : 'Save'}
              </button>
              <button className="btn btn--onmedia btn--sm" onClick={share}>
                <Share2 size={15} /> {copied ? 'Link copied' : 'Share'}
              </button>
            </div>
          </div>

          <div className="detail-hero__content">
            <h1>{event.title}</h1>
            {event.tagline && <p className="detail-hero__tagline">{event.tagline}</p>}
            <div className="detail-hero__meta">
              <span><CalendarDays size={16} /> {formatEventWhen(event.starts_at, event.ends_at)}</span>
              <span><MapPin size={16} /> {[event.venue, event.city].filter(Boolean).join(', ')}</span>
              <span><Users size={16} /> {sold} going</span>
              {!event.is_past && <span><Clock size={16} /> {countdown(event.starts_at)}</span>}
            </div>
          </div>
        </header>

        <div className="detail-layout">
          {/* Main column --------------------------------------- */}
          <div className="detail-main">
            <section className="panel panel--pad">
              <h2 className="section-title" style={{ fontSize: 'var(--fs-lg)' }}>About this event</h2>
              <p className="prose mt-4">{event.description}</p>

              {event.tags.length > 0 && (
                <div className="row row--tight mt-5">
                  {event.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                </div>
              )}
            </section>

            <section className="panel panel--pad">
              <h2 className="section-title" style={{ fontSize: 'var(--fs-lg)' }}>When and where</h2>
              <div className="meta-grid mt-5">
                <MetaItem
                  icon={<CalendarDays size={17} />}
                  label="Date"
                  value={relativeDay(event.starts_at)}
                  sub={formatEventWhen(event.starts_at, event.ends_at)}
                />
                <MetaItem
                  icon={<Clock size={17} />}
                  label="Duration"
                  value={formatDuration(event.starts_at, event.ends_at) || 'See programme'}
                  sub={event.is_past ? 'Already took place' : countdown(event.starts_at)}
                />
                <MetaItem
                  icon={<MapPin size={17} />}
                  label="Venue"
                  value={event.venue || 'Venue to be announced'}
                  sub={[event.city, event.country].filter(Boolean).join(', ')}
                />
                <MetaItem
                  icon={<Globe size={17} />}
                  label="Directions"
                  value={
                    <a
                      className="text-brand"
                      href={mapUrl(event)}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open in maps
                    </a>
                  }
                  sub="Opens OpenStreetMap in a new tab"
                />
                {event.contact_email && (
                  <MetaItem icon={<Mail size={17} />} label="Organiser email" value={event.contact_email} />
                )}
                {event.contact_phone && (
                  <MetaItem icon={<Phone size={17} />} label="Organiser phone" value={event.contact_phone} />
                )}
              </div>
            </section>

            {/* Comments ---------------------------------------- */}
            <section className="panel panel--pad">
              <div className="row row--between mb-4">
                <h2 className="section-title" style={{ fontSize: 'var(--fs-lg)' }}>
                  <MessageCircle size={18} /> Questions &amp; comments
                </h2>
                <span className="badge">{comments.length}</span>
              </div>

              <form className="comment-form" onSubmit={postComment}>
                {user ? <Avatar user={user} /> : <span className="avatar-fallback">?</span>}
                <div className="flex-1">
                  <textarea
                    className="textarea"
                    placeholder={user ? 'Ask the organiser or share a tip for other attendees…' : 'Sign in to join the conversation'}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    disabled={!user || posting}
                    maxLength={1000}
                  />
                  <div className="row row--between mt-3">
                    <span className="tiny dim">{comment.length}/1000</span>
                    <button className="btn btn--primary btn--sm" disabled={!user || !comment.trim() || posting}>
                      {posting ? <Spinner /> : <Send size={15} />} Post comment
                    </button>
                  </div>
                </div>
              </form>

              <div className="mt-6">
                {comments.length === 0 && (
                  <p className="muted small">No comments yet — be the first to ask a question.</p>
                )}
                {comments.map((item) => (
                  <div className="comment" key={item.id}>
                    <Avatar user={{ name: item.name, avatar_url: item.avatar_url }} />
                    <div className="comment__body">
                      <div className="comment__head">
                        <Link to={`/u/${item.username}`}><b>{item.name}</b></Link>
                        {item.user_id === event.host_id && <span className="badge badge--brand">Organiser</span>}
                        <span>
                          {new Date(`${item.created_at.replace(' ', 'T')}Z`).toLocaleString(undefined, {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="comment__text">{item.body}</p>
                    </div>
                    {(user?.id === item.user_id || isAdmin) && (
                      <button
                        className="icon-btn"
                        onClick={() => deleteComment(item.id)}
                        aria-label="Delete comment"
                        title="Delete comment"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {related.length > 0 && (
              <section>
                <SectionHead title="More like this" icon={<TrendingUp size={18} />} />
                <div className="grid grid--events">
                  {related.map((item) => <EventCard key={item.id} event={item} showFollow={false} />)}
                </div>
              </section>
            )}
          </div>

          {/* Sidebar ------------------------------------------- */}
          <aside className="detail-aside">
            <div className="panel panel--pad">
              <div className="row row--between mb-4">
                <span className="eyebrow">Tickets</span>
                <span className="section-link" style={{ cursor: 'default' }}>
                  {allFree ? 'Free entry' : `From ${formatMoney(lowestPrice, event.currency)}`}
                </span>
              </div>

              {tiers.length === 0 && (
                <p className="muted small">Ticket types will be announced soon.</p>
              )}

              {tiers.map((tier) => {
                const quantity = selection[tier.id] || 0;
                const disabled = tier.is_sold_out || event.is_past || event.status === 'cancelled';

                return (
                  <div
                    key={tier.id}
                    className={`tier ${quantity > 0 ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}
                    onClick={() => !disabled && setQuantity(tier, quantity > 0 ? 0 : 1)}
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    onKeyDown={(e) => {
                      if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        setQuantity(tier, quantity > 0 ? 0 : 1);
                      }
                    }}
                  >
                    <span className="tier__radio" aria-hidden="true" />
                    <span className="tier__info">
                      <span className="tier__name">{tier.name}</span>
                      {tier.description && <span className="tier__desc">{tier.description}</span>}
                      <span className="tier__meta">
                        {tier.is_sold_out
                          ? <span className="text-danger">Sold out</span>
                          : tier.quantity > 0
                            ? `${tier.remaining} of ${tier.quantity} left`
                            : 'Open capacity'}
                        <span>Max {tier.per_user_limit} per order</span>
                      </span>
                    </span>
                    <span className="tier__price">
                      {tier.price_cents === 0 ? 'Free' : formatMoney(tier.price_cents, tier.currency || event.currency)}
                    </span>
                  </div>
                );
              })}

              {selectionSummary.count > 0 && (
                <div className="mt-4">
                  {selectionSummary.lines.map(({ tier, quantity }) => (
                    <div className="buy-box__row" key={tier.id} style={{ marginBottom: 8 }}>
                      <span className="row row--tight" style={{ gap: 8 }}>
                        <span>{tier.name}</span>
                        <span className="qty">
                          <button onClick={() => setQuantity(tier, -1)} aria-label={`Fewer ${tier.name}`}>
                            <Minus size={13} />
                          </button>
                          <span>{quantity}</span>
                          <button onClick={() => setQuantity(tier, 1)} aria-label={`More ${tier.name}`}>
                            <Plus size={13} />
                          </button>
                        </span>
                      </span>
                      <b>{tier.price_cents === 0 ? 'Free' : formatMoney(tier.price_cents * quantity, tier.currency || event.currency)}</b>
                    </div>
                  ))}
                </div>
              )}

              <div className="buy-box mt-4">
                <div className="buy-box__total">
                  <span className="small muted">Total</span>
                  <strong>{formatMoney(selectionSummary.subtotal, event.currency)}</strong>
                </div>

                {event.has_ticket ? (
                  <Notice tone="ok" icon={<CheckCircle2 size={18} />} title="You have a ticket">
                    Your ticket is in <Link to="/tickets" className="text-brand">My tickets</Link>.
                  </Notice>
                ) : allFree ? (
                  <button
                    className="btn btn--primary btn--lg btn--block"
                    onClick={registerFree}
                    disabled={busy || event.is_past || event.status === 'cancelled'}
                  >
                    {busy ? <Spinner /> : <TicketIcon size={17} />} Register — free
                  </button>
                ) : (
                  <button
                    className="btn btn--primary btn--lg btn--block"
                    onClick={proceedToCheckout}
                    disabled={event.is_past || event.is_sold_out || event.status === 'cancelled'}
                  >
                    <TicketIcon size={17} />
                    {event.is_sold_out ? 'Sold out' : event.is_past ? 'Event finished' : 'Buy ticket'}
                  </button>
                )}

                <button className="btn btn--secondary btn--block" onClick={toggleFollow} disabled={busy}>
                  <Star size={16} fill={event.is_following ? 'currentColor' : 'none'} />
                  {event.is_following ? 'Following event' : 'Follow event'}
                </button>

                <p className="tiny dim" style={{ textAlign: 'center' }}>
                  {event.follower_count > 0 ? `${event.follower_count} following · ` : ''}
                  Secure checkout with M-Pesa or card
                </p>
              </div>
            </div>

            {/* Availability */}
            {capacity > 0 && (
              <div className="panel panel--pad">
                <div className="row row--between small">
                  <span className="medium">Availability</span>
                  <span className="muted">
                    {sold} / {capacity} {availability != null && !event.is_sold_out ? `· ${availability} left` : ''}
                  </span>
                </div>
                <div className="progress mt-3">
                  <div
                    className={`progress__bar ${fillPercent >= 95 ? 'is-full' : fillPercent >= 75 ? 'is-warn' : ''}`}
                    style={{ width: `${fillPercent}%` }}
                  />
                </div>
                <p className="tiny dim mt-2">
                  {event.is_sold_out ? 'All tickets have been issued.' : 'Live count of issued tickets.'}
                </p>
              </div>
            )}

            {/* Organiser */}
            <div className="panel panel--pad">
              <span className="eyebrow">Organiser</span>
              <div className="host-card mt-3">
                <Avatar user={{ name: event.host_name, avatar_url: event.host_avatar }} size="lg" />
                <div className="host-card__info">
                  <Link to={`/u/${event.host_username}`} className="host-card__name">{event.host_name}</Link>
                  <div className="host-card__handle">@{event.host_username}</div>
                  {event.host?.stats && (
                    <div className="host-card__stats">
                      <span>{event.host.stats.events} events</span>
                      <span>{event.host.stats.followers} followers</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="stack stack--sm mt-4">
                {(!user || user.id !== event.host_id) && (
                  <button className="btn btn--secondary btn--block" onClick={messageOrganiser}>
                    <MessageCircle size={16} /> Message organiser
                  </button>
                )}
                <button className="btn btn--ghost btn--block" onClick={openEventChat}>
                  <Users size={16} /> Event group chat
                </button>
              </div>
            </div>

            {/* Sharing */}
            <div className="panel panel--pad">
              <span className="eyebrow">Share</span>
              <div className="share-row mt-3">
                <button className="btn btn--secondary btn--sm" onClick={share}>
                  <Share2 size={15} /> {copied ? 'Copied' : 'Copy link'}
                </button>
                <a
                  className="btn btn--secondary btn--sm"
                  href={`https://wa.me/?text=${encodeURIComponent(`${event.title} — ${window.location.href}`)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  WhatsApp
                </a>
                <a
                  className="btn btn--secondary btn--sm"
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(event.title)}&url=${encodeURIComponent(window.location.href)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  X / Twitter
                </a>
              </div>
            </div>

            {/* Host tools */}
            {isHost && (
              <div className="panel panel--pad">
                <span className="eyebrow">Organiser tools</span>
                <div className="stack stack--sm mt-3">
                  <Link className="btn btn--secondary btn--block" to={`/events/${event.id}/edit`}>
                    <Pencil size={16} /> Edit event
                  </Link>
                  <Link className="btn btn--secondary btn--block" to={`/promotions?event=${event.id}`}>
                    <Megaphone size={16} /> Promote this event
                  </Link>
                  <button className="btn btn--secondary btn--block" onClick={openGuestList}>
                    <QrCode size={16} /> Guest list &amp; check-in
                  </button>

                  {event.check_in_stats && (
                    <div className="stat-strip mt-2">
                      <div className="stat-cell">
                        <strong>{event.check_in_stats.total}</strong>
                        <span>Tickets</span>
                      </div>
                      <div className="stat-cell">
                        <strong>{event.check_in_stats.checked_in}</strong>
                        <span>Checked in</span>
                      </div>
                    </div>
                  )}

                  {event.status !== 'cancelled' && (
                    <button className="btn btn--danger btn--block" onClick={cancelEvent} disabled={busy}>
                      <Ban size={16} /> Cancel event
                    </button>
                  )}
                  <button className="btn btn--ghost btn--block" onClick={() => setDeleteOpen(true)}>
                    <Trash2 size={16} /> Delete event
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* Guests modal */}
        <Modal
          open={guestListOpen}
          onClose={() => setGuestListOpen(false)}
          title="Guest list"
          size="wide"
        >
          {!guests && <LoadingBlock label="Loading guest list…" />}

          {guests && (
            <div className="stack">
              <div className="stat-strip">
                <div className="stat-cell"><strong>{guests.stats.total}</strong><span>Tickets issued</span></div>
                <div className="stat-cell"><strong>{guests.stats.checked_in}</strong><span>Checked in</span></div>
                <div className="stat-cell"><strong>{guests.stats.valid}</strong><span>Still valid</span></div>
                <div className="stat-cell"><strong>{guests.stats.refunded}</strong><span>Refunded</span></div>
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Attendee</th>
                      <th>Ticket</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Checked in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {guests.attendees.map((ticket) => (
                      <tr key={ticket.id}>
                        <td>
                          <strong>{ticket.holder?.name}</strong>
                          <div className="tiny dim mono">{ticket.code}</div>
                        </td>
                        <td><StatusPill status={ticket.payment?.status || 'successful'}>{ticket.payment?.status || 'paid'}</StatusPill></td>
                        <td>{ticket.ticket_type}</td>
                        <td><StatusPill status={ticket.status} /></td>
                        <td className="small muted">{ticket.checked_in_at || '—'}</td>
                      </tr>
                    ))}
                    {guests.attendees.length === 0 && (
                      <tr><td colSpan={5} className="muted">No tickets have been issued yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="row row--tight">
                <Link to="/verify" className="btn btn--primary btn--sm">
                  <QrCode size={15} /> Open check-in scanner
                </Link>
                <span className="small muted">Scan or type a ticket code at the door.</span>
              </div>
            </div>
          )}
        </Modal>

        <ConfirmDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          onConfirm={deleteEvent}
          title="Delete this event?"
          text="Deleting removes the event from discovery. Events with issued tickets cannot be deleted — cancel them instead so attendees keep their records."
          confirmLabel="Delete event"
          danger
          busy={busy}
        />
      </div>
    </div>
  );
}
