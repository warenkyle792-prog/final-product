import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bookmark, CalendarDays, MapPin, Star, Ticket, Users } from 'lucide-react';

import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatMoney, monthDay, relativeDay, timeLabel } from '../utils/format';
import { useQuickView } from './EventQuickView';

const FALLBACK_COVER = '/uploads/covers/event-01-music.svg';

/**
 * Event card used across home, discover, category and profile pages.
 * Shows cover, title, category, date, location, price, organiser and the
 * save / follow controls.
 */
export default function EventCard({
  event,
  variant = 'grid',
  onSaved,
  onFollowed,
  showFollow = true,
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const openQuickView = useQuickView();

  const [saved, setSaved] = useState(Boolean(event.is_saved));
  const [following, setFollowing] = useState(Boolean(event.is_following));
  const [followers, setFollowers] = useState(Number(event.follower_count || 0));
  const [busy, setBusy] = useState(false);

  const { mon, day } = monthDay(event.starts_at);
  const isRow = variant === 'row';

  const requireAuth = (message) => {
    if (user) return true;
    toast(message, 'info');
    navigate('/login', { state: { from: `/events/${event.id}` } });
    return false;
  };

  const toggleSave = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!requireAuth('Sign in to save events')) return;

    setBusy(true);
    try {
      const res = await api.post(`/events/${event.id}/save`);
      setSaved(res.is_saved);
      onSaved?.(event.id, res.is_saved);
      toast(res.is_saved ? 'Saved to your events' : 'Removed from saved', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleFollow = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!requireAuth('Sign in to follow events')) return;

    setBusy(true);
    try {
      const res = await api.post(`/events/${event.id}/follow`);
      setFollowing(res.is_following);
      setFollowers(res.follower_count);
      onFollowed?.(event.id, res.is_following);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  /**
   * The card body opens the quick view; its own links and buttons are left
   * alone so the cover and the title still go straight to the full page.
   */
  const openDetails = (target, card) => {
    if (target?.closest('a, button, [role="button"]')) return;
    openQuickView(event, card);
  };

  return (
    <article
      className={`event-card ${isRow ? 'event-card--row' : ''}`}
      onClick={(clickEvent) => openDetails(clickEvent.target, clickEvent.currentTarget)}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === 'Enter') openDetails(keyEvent.target, keyEvent.currentTarget);
      }}
      tabIndex={0}
      aria-label={`${event.title} — open quick view`}
    >
      <Link to={`/events/${event.id}`} className="event-card__media" aria-label={event.title}>
        <img
          src={event.image_url || FALLBACK_COVER}
          alt=""
          loading="lazy"
          onError={(err) => {
            err.currentTarget.src = FALLBACK_COVER;
          }}
        />

        <span className="event-card__top">
          <span className="event-card__date" aria-hidden="true">
            <span className="mon">{mon}</span>
            <span className="day">{day}</span>
          </span>
          <span
            role="button"
            tabIndex={0}
            className={`event-card__fav ${saved ? 'is-saved' : ''}`}
            onClick={toggleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') toggleSave(e);
            }}
            aria-label={saved ? 'Remove from saved events' : 'Save event'}
            aria-pressed={saved}
            style={busy ? { opacity: 0.6 } : undefined}
          >
            <Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />
          </span>
        </span>

        <span className="event-card__flags">
          {event.is_promoted && (
            <span className="flag flag--promoted">
              <Star size={11} fill="currentColor" />
              {event.promotion_plan === 'sponsored' ? 'Sponsored' : 'Featured'}
            </span>
          )}
          {event.is_free && <span className="flag flag--free">Free entry</span>}
          {event.is_sold_out && <span className="flag flag--soldout">Sold out</span>}
        </span>
      </Link>

      <div className="event-card__body">
        <span className="event-card__cat">
          <i style={{ background: event.category_color || 'var(--brand)' }} />
          {event.category_name}
        </span>

        <h3 className="event-card__title">
          <Link to={`/events/${event.id}`}>{event.title}</Link>
        </h3>

        {isRow && event.tagline && <p className="muted clamp-2">{event.tagline}</p>}

        <p className="event-card__meta">
          <CalendarDays size={14} />
          <span>{relativeDay(event.starts_at)} · {timeLabel(event.starts_at)}</span>
        </p>

        {(event.venue || event.city) && (
          <p className="event-card__meta">
            <MapPin size={14} />
            <span>{[event.venue, event.city].filter(Boolean).join(', ')}</span>
          </p>
        )}

        {isRow && (
          <p className="event-card__meta">
            <Users size={14} />
            <span>
              {event.sold || 0} going
              {event.available != null ? ` · ${event.available} tickets left` : ''}
            </span>
          </p>
        )}

        <div className="event-card__foot">
          <Link to={`/u/${event.host_username}`} className="event-card__host">
            {event.host_avatar ? (
              <img className="avatar avatar--sm" src={event.host_avatar} alt="" loading="lazy" />
            ) : (
              <span className="avatar-fallback avatar--sm">{(event.host_name || '?').slice(0, 1)}</span>
            )}
            <b>{event.host_name}</b>
          </Link>

          <div className="row row--tight" style={{ gap: 8 }}>
            {showFollow && (
              <button
                className={`event-card__follow ${following ? 'is-on' : ''}`}
                onClick={toggleFollow}
                disabled={busy}
                aria-pressed={following}
                title={following ? 'Following this event' : 'Follow this event for updates'}
              >
                <Star size={12} fill={following ? 'currentColor' : 'none'} />
                {following ? 'Following' : 'Follow'}
              </button>
            )}
            <span className={`event-card__price ${event.is_free ? 'is-free' : ''}`}>
              {event.is_free ? 'Free' : `From ${formatMoney(event.price_cents, event.currency)}`}
            </span>
          </div>
        </div>

        {showFollow && followers > 0 && !isRow && (
          <p className="tiny dim">
            <Ticket size={12} style={{ display: 'inline', verticalAlign: -2 }} /> {followers} following
          </p>
        )}
      </div>
    </article>
  );
}
