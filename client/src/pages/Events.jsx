import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Clock, Grid2x2, List, Sparkles, Ticket } from 'lucide-react';

import EventCard from '../components/EventCard';
import { CardSkeletonGrid, EmptyState, Pagination } from '../components/UI';
import { useEventSearch } from '../hooks/useEventSearch';
import { useDocumentTitle } from '../hooks';

const QUICK_DATES = [
  { value: '', label: 'All upcoming' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'month', label: 'This month' },
  { value: 'past', label: 'Past' },
];

const SORTS = [
  { value: 'soon', label: 'Date · soonest' },
  { value: 'popular', label: 'Most popular' },
  { value: 'new', label: 'Newest listings' },
  { value: 'price_asc', label: 'Price · low to high' },
  { value: 'price_desc', label: 'Price · high to low' },
];

/**
 * `/events` — the ordered listing view.
 * Upcoming events by date by default, with a compact list layout that makes
 * the date, place and price easy to scan.
 */
export default function Events() {
  useDocumentTitle('Events');

  const {
    filters, update, reset, events, total, pages, loading, error,
  } = useEventSearch({ limit: 15 });

  const [layout, setLayout] = useLayout();

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <h1>All events</h1>
            <p>Every published event, ordered by date. Use the quick filters to narrow the list.</p>
          </div>
          <div className="row row--tight">
            <div className="segmented" role="group" aria-label="Layout">
              <button
                className={layout === 'list' ? 'active' : ''}
                onClick={() => setLayout('list')}
                aria-label="List layout"
              >
                <List size={15} />
              </button>
              <button
                className={layout === 'grid' ? 'active' : ''}
                onClick={() => setLayout('grid')}
                aria-label="Grid layout"
              >
                <Grid2x2 size={15} />
              </button>
            </div>
            <Link to="/discover" className="btn btn--secondary btn--sm">
              <Sparkles size={15} /> Advanced search
            </Link>
          </div>
        </div>

        <div className="filters">
          <div className="chip-row">
            {QUICK_DATES.map((option) => (
              <button
                key={option.value}
                className={`chip ${filters.when === option.value ? 'chip--active' : ''}`}
                onClick={() => update({ when: option.value })}
              >
                {option.label}
              </button>
            ))}
            <span className="nav__sep" aria-hidden="true" />
            <button
              className={`chip ${filters.price === 'free' ? 'chip--active' : ''}`}
              onClick={() => update({ price: filters.price === 'free' ? '' : 'free' })}
            >
              Free entry
            </button>
            <button
              className={`chip ${filters.price === 'paid' ? 'chip--active' : ''}`}
              onClick={() => update({ price: filters.price === 'paid' ? '' : 'paid' })}
            >
              Paid
            </button>
          </div>

          <div className="filters__row" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <div className="field">
              <label className="field__label" htmlFor="events-sort">Sort</label>
              <select
                id="events-sort"
                className="select"
                value={filters.sort}
                onChange={(event) => update({ sort: event.target.value })}
              >
                {SORTS.map((sort) => <option key={sort.value} value={sort.value}>{sort.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="events-limit">Per page</label>
              <select
                id="events-limit"
                className="select"
                value={filters.limit}
                onChange={(event) => update({ limit: Number(event.target.value) })}
              >
                {[9, 15, 24, 36].map((value) => <option key={value} value={value}>{value} events</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="results-head">
          <p className="results-count">
            {loading ? 'Loading…' : <><b>{total}</b> {total === 1 ? 'event' : 'events'}</>}
          </p>
          {filters.when === 'past' && <span className="badge">Past events</span>}
        </div>

        {loading && !events.length && <CardSkeletonGrid count={6} />}

        {!loading && !error && events.length === 0 && (
          <EmptyState
            icon={<CalendarDays size={22} />}
            title="Nothing scheduled here yet"
            text="No events match this combination of filters. Try another date range or clear the filters."
            action={<button className="btn btn--secondary" onClick={reset}>Reset filters</button>}
          />
        )}

        {events.length > 0 && (
          <>
            <div className={layout === 'grid' ? 'grid grid--events' : 'stack'}>
              {events.map((event) => (
                <EventCard key={event.id} event={event} variant={layout === 'grid' ? 'grid' : 'row'} />
              ))}
            </div>
            <Pagination page={Number(filters.page) || 1} pages={pages} onChange={(page) => update({ page })} />
          </>
        )}

        <div className="notice mt-8">
          <Clock size={18} />
          <div>
            <b>Not sure what you are looking for?</b>
            <div className="small muted">
              Discover lets you search by keyword, venue, city, price range and category at once.
            </div>
          </div>
          <Link to="/discover" className="btn btn--secondary btn--sm" style={{ marginLeft: 'auto' }}>
            <Ticket size={15} /> Open Discover
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Layout choice survives navigation within the session. */
function useLayout() {
  const key = 'eventtracker_events_layout';
  const [layout, setLayoutState] = useState(() => {
    try {
      return localStorage.getItem(key) || 'list';
    } catch {
      return 'list';
    }
  });

  const setLayout = (value) => {
    setLayoutState(value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  };

  return [layout, setLayout];
}
