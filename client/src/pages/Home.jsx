import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, CalendarPlus, Compass, MapPin, Megaphone, Search, ShieldCheck, Sparkles, Star, Ticket, Users,
} from 'lucide-react';

import EventCard from '../components/EventCard';
import { CardSkeletonGrid, EmptyState, SectionHead } from '../components/UI';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useAsync, useDocumentTitle } from '../hooks';
import { compactNumber, formatMoney, relativeDay, timeLabel } from '../utils/format';
import { assetUrl } from '../api/client';

const CATEGORY_ICONS = {
  music: '🎵', technology: '🖥️', sports: '🏃', business: '💼',
  food: '🍲', arts: '🎨', community: '🤝', wellness: '🌿',
};

export default function Home() {
  useDocumentTitle('');

  const navigate = useNavigate();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [place, setPlace] = useState('');

  const { data, loading } = useAsync(() => api.get('/feed'), []);

  const stats = data?.stats || {};
  const featured = data?.featured || [];
  const promoted = data?.promoted || [];
  const upcoming = data?.upcoming || [];
  const categories = data?.categories || [];
  const forYou = data?.for_you || [];

  const spotlight = promoted[0] || featured[0] || null;
  const weekAhead = upcoming.slice(0, 3);

  const submitSearch = (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (place.trim()) params.set('location', place.trim());
    navigate(`/discover?${params.toString()}`);
  };

  return (
    <div>
      {/* Hero ------------------------------------------------------ */}
      <section className="hero">
        <div className="container">
          <div className="hero__grid">
            <div>
              <span className="hero__badge">
                <i><Sparkles size={12} /></i>
                {stats.upcoming_events
                  ? <><b>{stats.upcoming_events} events</b>&nbsp;happening in {stats.cities} cities</>
                  : 'Discover events near you'}
              </span>

              <h1 className="hero__title">Discover What&apos;s Happening Around You</h1>

              <p className="hero__sub">
                EventTracker brings together everything worth showing up for — concerts, runs,
                workshops, supper clubs and community days. Follow the events you care about,
                get your ticket in a couple of taps, and keep the conversation going afterwards.
              </p>

              <div className="hero__actions">
                <Link to="/discover" className="btn btn--primary btn--lg">
                  <Compass size={18} /> Explore events
                </Link>
                <Link to={user ? '/events/new' : '/register'} className="btn btn--secondary btn--lg">
                  <CalendarPlus size={18} /> Create event
                </Link>
              </div>

              <form className="hero__search" onSubmit={submitSearch} role="search">
                <span className="input-icon">
                  <Search size={17} />
                  <input
                    className="input"
                    placeholder="Search events, organisers or venues"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="Search events"
                  />
                </span>
                <span className="input-icon">
                  <MapPin size={17} />
                  <input
                    className="input"
                    placeholder="Nairobi"
                    value={place}
                    onChange={(event) => setPlace(event.target.value)}
                    aria-label="Location"
                  />
                </span>
                <button className="btn btn--primary" type="submit">Search</button>
              </form>

              <div className="hero__stats">
                <div className="hero__stat">
                  <strong>{compactNumber(stats.upcoming_events || 0)}</strong>
                  <span>Upcoming events</span>
                </div>
                <div className="hero__stat">
                  <strong>{compactNumber(stats.tickets_issued || 0)}</strong>
                  <span>Tickets issued</span>
                </div>
                <div className="hero__stat">
                  <strong>{compactNumber(stats.members || 0)}</strong>
                  <span>Members</span>
                </div>
                <div className="hero__stat">
                  <strong>{stats.cities || 0}</strong>
                  <span>Cities</span>
                </div>
              </div>
            </div>

            {/* Spotlight: real content, not decoration */}
            <aside className="hero__spotlight">
              <div className="spotlight-label">
                <span>{promoted.length ? 'Sponsored placement' : 'Featured event'}</span>
                <Link to="/promotions/plans" className="section-link" style={{ fontSize: 'var(--fs-xs)' }}>
                  Promote yours <ArrowRight size={13} />
                </Link>
              </div>

              {loading && <div className="skeleton" style={{ height: 300, borderRadius: 'var(--r-lg)' }} />}

              {!loading && spotlight && (
                <EventCard event={spotlight} variant="grid" showFollow={false} />
              )}

              {!loading && weekAhead.length > 0 && (
                <>
                  <div className="spotlight-label" style={{ marginTop: 4 }}>
                    <span>Happening this week</span>
                  </div>
                  {weekAhead.map((event) => (
                    <Link key={event.id} to={`/events/${event.id}`} className="spotlight-mini">
                      <img src={assetUrl(event.image_url)} alt="" loading="lazy" />
                      <span className="info">
                        <b>{event.title}</b>
                        <span>
                          {relativeDay(event.starts_at)} · {timeLabel(event.starts_at)} ·{' '}
                          {event.is_free ? 'Free' : formatMoney(event.price_cents, event.currency)}
                        </span>
                      </span>
                      <ArrowRight size={16} className="dim" />
                    </Link>
                  ))}
                </>
              )}
            </aside>
          </div>
        </div>
      </section>

      {/* For you -------------------------------------------------- */}
      {forYou.length > 0 && (
        <section className="section">
          <div className="container">
            <SectionHead
              title="From people you follow"
              icon={<Star size={18} />}
              sub="New events from organisers and events you follow."
              link={<Link to="/profile/saved" className="section-link">Manage following <ArrowRight size={15} /></Link>}
            />
            <div className="grid grid--events">
              {forYou.slice(0, 4).map((event) => <EventCard key={event.id} event={event} />)}
            </div>
          </div>
        </section>
      )}

      {/* Featured ------------------------------------------------- */}
      <section className="section">
        <div className="container">
          <SectionHead
            title={promoted.length ? 'Featured & sponsored' : 'Featured events'}
            icon={<Sparkles size={18} />}
            sub="Hand-picked events and paid placements from organisers on EventTracker."
            link={<Link to="/events" className="section-link">All events <ArrowRight size={15} /></Link>}
          />

          {loading ? (
            <CardSkeletonGrid count={4} />
          ) : featured.length ? (
            <div className="grid grid--events">
              {featured.slice(0, 8).map((event) => <EventCard key={event.id} event={event} />)}
            </div>
          ) : (
            <EmptyState
              icon={<Compass size={22} />}
              title="No featured events yet"
              text="Featured placements appear here once organisers publish and promote their events."
              action={<Link to="/events/new" className="btn btn--primary">Create the first one</Link>}
            />
          )}
        </div>
      </section>

      {/* Categories ----------------------------------------------- */}
      <section className="section">
        <div className="container">
          <SectionHead
            title="Popular categories"
            icon={<Compass size={18} />}
            sub="Browse by what you are in the mood for."
            link={<Link to="/categories" className="section-link">All categories <ArrowRight size={15} /></Link>}
          />

          <div className="cat-grid">
            {categories.map((category) => (
              <Link key={category.slug} to={`/categories/${category.slug}`} className="cat-tile">
                <span className="cat-tile__icon" style={{ background: category.color || 'var(--brand)' }}>
                  <span aria-hidden="true" style={{ fontSize: 17 }}>{CATEGORY_ICONS[category.slug] || '✦'}</span>
                </span>
                <span className="flex-1">
                  <span className="cat-tile__name">{category.name}</span>
                  <span className="cat-tile__count">
                    {category.event_count} upcoming {category.event_count === 1 ? 'event' : 'events'}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Upcoming ------------------------------------------------- */}
      <section className="section">
        <div className="container">
          <SectionHead
            title="Upcoming events"
            icon={<Ticket size={18} />}
            sub="The next events on the calendar, nearest first."
            link={<Link to="/events?sort=soon" className="section-link">See all <ArrowRight size={15} /></Link>}
          />

          {loading ? (
            <CardSkeletonGrid count={4} />
          ) : (
            <div className="grid grid--events">
              {upcoming.slice(0, 8).map((event) => <EventCard key={event.id} event={event} />)}
            </div>
          )}
        </div>
      </section>

      {/* Organiser call to action -------------------------------- */}
      <section className="section">
        <div className="container">
          <div className="cta">
            <div>
              <h2>Running something? Sell tickets in minutes.</h2>
              <p>
                Publish your event, set ticket tiers in Kenyan Shillings, and we handle checkout
                with M-Pesa and card. Every payment is verified on the server before a ticket is
                issued, and you get a live guest list with QR check-in.
              </p>
              <div className="cta__actions mt-5">
                <Link to={user ? '/events/new' : '/register'} className="btn btn--primary">
                  <CalendarPlus size={17} /> Create an event
                </Link>
                <Link to="/promotions/plans" className="btn btn--secondary">
                  <Megaphone size={17} /> Promotion plans
                </Link>
              </div>
            </div>

            <ul className="cta__list">
              <li className="cta__item"><ShieldCheck size={18} /> Server-verified payments — no client-side confirmation</li>
              <li className="cta__item"><Ticket size={18} /> Signed QR tickets with single-use check-in</li>
              <li className="cta__item"><Users size={18} /> Guest list, sales and check-in reporting</li>
              <li className="cta__item"><Megaphone size={18} /> Featured, boosted and sponsored placements</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
