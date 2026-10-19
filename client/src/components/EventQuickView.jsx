import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Bookmark, CalendarDays, Clock, MapPin, Star, Ticket, Users, X,
} from 'lucide-react';

import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatMoney, relativeDay, timeLabel } from '../utils/format';

/**
 * Quick view — the morphing dialog behind the event tabs.
 *
 * Opening one expands out of the card you clicked and collapses back into it on
 * close, so the card and the dialog read as the same surface changing size.
 * The morph itself is a FLIP: the card's rectangle is measured, the dialog is
 * pinned to it, then it eases to its natural size while the contents fade in.
 * Only transform and opacity animate, so it stays on the compositor.
 *
 * Under `prefers-reduced-motion` the morph is skipped and the dialog simply
 * appears. Escape and a click on the backdrop close it; body scroll is locked
 * while it is open.
 */

const QuickViewContext = createContext(null);

/**
 * Morph durations in milliseconds. The panel receives these as CSS variables, so
 * the animation and the phase timers that drive it can never drift apart.
 */
const MORPH = { open: 340, close: 240 };

/** The dialog's resting box: a comfortable reading width, kept inside the viewport. */
function restingBox() {
  const width = Math.min(660, window.innerWidth - 32);
  const height = Math.min(620, window.innerHeight - 48);
  return {
    width,
    height,
    left: (window.innerWidth - width) / 2,
    top: Math.max(24, (window.innerHeight - height) / 2),
  };
}

const rectOf = (element) => {
  const r = element.getBoundingClientRect();
  return { width: r.width, height: r.height, left: r.left, top: r.top };
};

export function EventQuickViewProvider({ children }) {
  const [active, setActive] = useState(null);
  const [phase, setPhase] = useState('closed');
  const [origin, setOrigin] = useState(null);
  const [details, setDetails] = useState(null);
  const [error, setError] = useState('');
  const panelRef = useRef(null);
  const openerRef = useRef(null);
  const detailCache = useRef(new Map());

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  const open = useCallback((event, element) => {
    if (!event) return;
    openerRef.current = element || null;
    setOrigin(element ? rectOf(element) : null);
    setDetails(detailCache.current.get(event.id) || null);
    setError('');
    setActive(event);
    setPhase('opening');
  }, []);

  const close = useCallback(() => {
    if (!active) return;
    setOrigin(openerRef.current && document.body.contains(openerRef.current)
      ? rectOf(openerRef.current)
      : null);
    setPhase('closing');
  }, [active]);

  /* ---- fetch the full record (list payloads omit ticket types) ---- */
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;

    const cached = detailCache.current.get(active.id);
    if (cached) {
      setDetails(cached);
      return undefined;
    }

    api.get(`/events/${active.id}`)
      .then((data) => {
        const record = data.event || data;
        detailCache.current.set(active.id, record);
        if (!cancelled) setDetails(record);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load this event.');
      });

    return () => { cancelled = true; };
  }, [active]);

  /**
   * Drive the morph.
   *
   * The phase class has to stay on the panel for as long as its animation runs —
   * switching it early cuts the animation off mid-flight — so each phase is held
   * for exactly its duration before moving on.
   */
  useEffect(() => {
    if (phase !== 'opening' && phase !== 'closing') return undefined;

    const settle = () => setPhase(phase === 'opening' ? 'open' : 'closed');
    if (reducedMotion) {
      const id = requestAnimationFrame(settle);
      return () => cancelAnimationFrame(id);
    }

    const id = setTimeout(settle, phase === 'opening' ? MORPH.open : MORPH.close);
    return () => clearTimeout(id);
  }, [phase, reducedMotion]);

  // unmount the panel content once the close animation has finished
  useEffect(() => {
    if (phase === 'closed') {
      setActive(null);
      setDetails(null);
    }
  }, [phase]);

  /* ---- escape to close, and lock the page behind the dialog ---- */
  useEffect(() => {
    if (!active) return undefined;

    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [active, close]);

  const event = details || active;
  const style = morphStyle({ origin });

  const value = useMemo(() => open, [open]);

  return (
    <QuickViewContext.Provider value={value}>
      {children}

      {active && (
        <div className={`quick-view quick-view--${phase}`} role="presentation">
          <button
            type="button"
            className="quick-view__scrim"
            aria-label="Close quick view"
            onClick={close}
          />

          <div
            ref={panelRef}
            className="quick-view__panel"
            style={style}
            role="dialog"
            aria-modal="true"
            aria-label={active.title}
          >
            <div className="quick-view__inner">
              {event && <QuickViewBody event={event} full={details} error={error} onClose={close} />}
            </div>
          </div>
        </div>
      )}
    </QuickViewContext.Provider>
  );
}

/**
 * Where to draw the panel right now.
 *
 * Opening: start at the card's rectangle and ease to the resting box, so the
 * card appears to grow into the dialog. Closing: the reverse.
 */
function morphStyle({ origin }) {
  const rest = typeof window === 'undefined' ? null : restingBox();
  if (!rest) return undefined;

  const style = {
    left: rest.left,
    top: rest.top,
    width: rest.width,
    height: rest.height,
    '--qv-in': `${MORPH.open}ms`,
    '--qv-out': `${MORPH.close}ms`,
  };
  if (!origin) return style;

  // Offsets from the resting box back to the card that was clicked, expressed as
  // a transform so the panel never re-lays out while it morphs.
  return {
    ...style,
    '--morph-dx': `${(origin.left - rest.left).toFixed(1)}px`,
    '--morph-dy': `${(origin.top - rest.top).toFixed(1)}px`,
    '--morph-sx': (origin.width / Math.max(1, rest.width)).toFixed(4),
    '--morph-sy': (origin.height / Math.max(1, rest.height)).toFixed(4),
  };
}

/* --------------------------------------------------------------- contents */

function QuickViewBody({ event: summary, full, error, onClose }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const event = full || summary;
  const [saved, setSaved] = useState(Boolean(event.is_saved));
  const [following, setFollowing] = useState(Boolean(event.is_following));
  const [busy, setBusy] = useState(false);

  const tiers = Array.isArray(event.ticket_types) ? event.ticket_types : [];
  const price = event.is_free ? 'Free' : `From ${formatMoney(event.price_cents, event.currency)}`;

  const requireAuth = (message) => {
    if (user) return true;
    toast(message, 'info');
    return false;
  };

  const toggleSave = async () => {
    if (!requireAuth('Sign in to save events')) return;
    setBusy(true);
    try {
      const res = await api.post(`/events/${event.id}/save`);
      setSaved(res.is_saved);
      toast(res.is_saved ? 'Saved to your events' : 'Removed from saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleFollow = async () => {
    if (!requireAuth('Sign in to follow events')) return;
    setBusy(true);
    try {
      const res = await api.post(`/events/${event.id}/follow`);
      setFollowing(res.is_following);
      toast(res.is_following ? 'Following this event' : 'No longer following', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="quick-view__head">
        <div className="quick-view__cover">
          <img
            src={event.image_url || '/uploads/covers/event-01-music.svg'}
            alt=""
            onError={(err) => { err.currentTarget.src = '/uploads/covers/event-01-music.svg'; }}
          />
          <span className="quick-view__cat">
            <i style={{ background: event.category_color || 'var(--brand)' }} />
            {event.category_name}
          </span>
        </div>

        <button type="button" className="quick-view__close" onClick={onClose} aria-label="Close quick view">
          <X size={17} />
        </button>
      </header>

      <div className="quick-view__body">
        <h2 className="quick-view__title">{event.title}</h2>
        {event.tagline && <p className="quick-view__tagline">{event.tagline}</p>}

        <dl className="quick-view__facts">
          <div>
            <dt><CalendarDays size={15} /> When</dt>
            <dd>{relativeDay(event.starts_at)} · {timeLabel(event.starts_at)}</dd>
          </div>
          <div>
            <dt><MapPin size={15} /> Where</dt>
            <dd>{[event.venue, event.city, event.country].filter(Boolean).join(', ') || 'To be announced'}</dd>
          </div>
          <div>
            <dt><Ticket size={15} /> Tickets</dt>
            <dd>
              {price}
              {event.available != null && <span className="dim"> · {event.available} left</span>}
            </dd>
          </div>
          <div>
            <dt><Users size={15} /> Host</dt>
            <dd>{event.host_name || 'EventTracker organiser'}</dd>
          </div>
        </dl>

        {event.description && (
          <p className="quick-view__description clamp-4">{event.description}</p>
        )}

        {error && (
          <p className="quick-view__note">
            <Clock size={14} /> {error} Pull-to-refresh the page to try again.
          </p>
        )}

        {tiers.length > 0 && !error && (
          <ul className="quick-view__tiers">
            {tiers.slice(0, 4).map((tier) => (
              <li key={tier.id}>
                <span>{tier.name}</span>
                <span className="dim">{tier.remaining > 0 ? `${tier.remaining} left` : 'Sold out'}</span>
                <b>{tier.price_cents === 0 ? 'Free' : formatMoney(tier.price_cents, tier.currency)}</b>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="quick-view__actions">
        <button
          type="button"
          className={`btn btn--ghost btn--sm ${saved ? 'is-active' : ''}`}
          onClick={toggleSave}
          disabled={busy}
          aria-pressed={saved}
        >
          <Bookmark size={15} fill={saved ? 'currentColor' : 'none'} />
          {saved ? 'Saved' : 'Save'}
        </button>
        <button
          type="button"
          className={`btn btn--ghost btn--sm ${following ? 'is-active' : ''}`}
          onClick={toggleFollow}
          disabled={busy}
          aria-pressed={following}
        >
          <Star size={15} fill={following ? 'currentColor' : 'none'} />
          {following ? 'Following' : 'Follow'}
        </button>

        <Link to={`/events/${event.id}`} className="btn btn--primary btn--sm quick-view__full">
          {event.is_free ? 'Register' : 'Buy ticket'} <ArrowRight size={15} />
        </Link>
      </footer>
    </>
  );
}

/** Hook used by the cards: `const openQuickView = useQuickView()`. */
export function useQuickView() {
  const open = useContext(QuickViewContext);
  return useCallback((event, element) => {
    if (!open) return;
    open(event, element || document.activeElement);
  }, [open]);
}
