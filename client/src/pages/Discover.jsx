import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Filter, Search, SlidersHorizontal, X } from 'lucide-react';

import EventCard from '../components/EventCard';
import { CardSkeletonGrid, EmptyState, Pagination } from '../components/UI';
import { api } from '../api/client';
import { useEventSearch } from '../hooks/useEventSearch';
import { useAsync, useDocumentTitle } from '../hooks';

const DATE_OPTIONS = [
  { value: '', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'month', label: 'Next 30 days' },
  { value: 'past', label: 'Past events' },
];

const SORT_OPTIONS = [
  { value: 'soon', label: 'Starting soonest' },
  { value: 'popular', label: 'Most popular' },
  { value: 'new', label: 'Recently added' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

export default function Discover() {
  useDocumentTitle('Discover');

  const {
    filters, update, reset, clearFilter, activeFilters,
    events, total, pages, loading, error,
  } = useEventSearch();

  const { data: meta } = useAsync(
    async () => {
      const [categories, locations] = await Promise.all([
        api.get('/categories'),
        api.get('/events/locations'),
      ]);
      return { categories: categories.categories, locations: locations.locations };
    },
    []
  );

  const [showFilters, setShowFilters] = useState(false);

  // Show the filter panel by default on wide screens.
  useEffect(() => {
    if (window.matchMedia('(min-width: 861px)').matches) setShowFilters(true);
  }, []);

  const toggleCategory = (slug) => {
    const current = filters.category ? filters.category.split(',') : [];
    const next = current.includes(slug)
      ? current.filter((value) => value !== slug)
      : [...current, slug];
    update({ category: next.join(',') });
  };

  const selectedCategories = filters.category ? filters.category.split(',') : [];

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <h1>Discover events</h1>
            <p>
              Search by name, filter by date, place and price, then open an event to see the full
              programme, organiser and tickets.
            </p>
          </div>
          <Link to="/events" className="btn btn--secondary">
            <Filter size={16} /> Browse by list
          </Link>
        </div>

        <div className="filters">
          <form
            className="filters__search"
            onSubmit={(event) => event.preventDefault()}
            role="search"
          >
            <span className="input-icon">
              <Search size={17} />
              <input
                className="input"
                type="search"
                placeholder="Search events, venues, tags…"
                value={filters.search}
                onChange={(event) => update({ search: event.target.value })}
                aria-label="Search events"
              />
            </span>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setShowFilters((open) => !open)}
              aria-expanded={showFilters}
            >
              <SlidersHorizontal size={16} />
              {showFilters ? 'Hide filters' : 'Filters'}
              {activeFilters.length > 0 && <span className="badge badge--brand">{activeFilters.length}</span>}
            </button>
          </form>

          {showFilters && (
            <>
              <div className="chip-row" aria-label="Categories">
                <button
                  className={`chip ${!selectedCategories.length ? 'chip--active' : ''}`}
                  onClick={() => update({ category: '' })}
                >
                  All categories
                </button>
                {(meta?.categories || []).map((category) => (
                  <button
                    key={category.slug}
                    className={`chip ${selectedCategories.includes(category.slug) ? 'chip--active' : ''}`}
                    onClick={() => toggleCategory(category.slug)}
                    aria-pressed={selectedCategories.includes(category.slug)}
                  >
                    {category.name}
                  </button>
                ))}
              </div>

              <div className="filters__row">
                <div className="field">
                  <label className="field__label" htmlFor="filter-when">When</label>
                  <select
                    id="filter-when"
                    className="select"
                    value={filters.when}
                    onChange={(event) => update({ when: event.target.value })}
                  >
                    {DATE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="filter-location">Location</label>
                  <select
                    id="filter-location"
                    className="select"
                    value={filters.location}
                    onChange={(event) => update({ location: event.target.value })}
                  >
                    <option value="">Anywhere</option>
                    {(meta?.locations || []).map((location) => (
                      <option key={`${location.city}-${location.country}`} value={location.city}>
                        {location.city}{location.country ? `, ${location.country}` : ''} ({location.event_count})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="filter-price">Price</label>
                  <select
                    id="filter-price"
                    className="select"
                    value={filters.price}
                    onChange={(event) => update({ price: event.target.value })}
                  >
                    <option value="">Free and paid</option>
                    <option value="free">Free only</option>
                    <option value="paid">Paid only</option>
                  </select>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="filter-sort">Sort by</label>
                  <select
                    id="filter-sort"
                    className="select"
                    value={filters.sort}
                    onChange={(event) => update({ sort: event.target.value })}
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {activeFilters.length > 0 && (
                <div className="active-filters">
                  <span className="small muted">Active:</span>
                  {activeFilters.map((chip) => (
                    <span className="filter-tag" key={chip.key}>
                      {chip.label}
                      <button onClick={() => clearFilter(chip.key)} aria-label={`Remove ${chip.label} filter`}>
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  <button className="btn btn--ghost btn--sm" onClick={reset}>Clear all</button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="results-head">
          <p className="results-count">
            {loading ? 'Searching…' : <><b>{total}</b> {total === 1 ? 'event' : 'events'} found</>}
          </p>
          {filters.when !== 'past' && (
            <p className="small dim">Showing upcoming events first, promoted placements on top.</p>
          )}
        </div>

        {error && (
          <EmptyState
            icon={<Compass size={22} />}
            title="We could not load events"
            text={error.message}
            action={<button className="btn btn--primary" onClick={() => window.location.reload()}>Try again</button>}
          />
        )}

        {loading && !events.length && <CardSkeletonGrid count={6} />}

        {!loading && !error && events.length === 0 && (
          <EmptyState
            icon={<Search size={22} />}
            title="No events match those filters"
            text="Try widening the date range, clearing the location, or searching for something broader."
            action={<button className="btn btn--secondary" onClick={reset}>Clear all filters</button>}
          />
        )}

        {events.length > 0 && (
          <>
            <div className="grid grid--events">
              {events.map((event) => <EventCard key={event.id} event={event} />)}
            </div>
            <Pagination page={Number(filters.page) || 1} pages={pages} onChange={(page) => update({ page })} />
          </>
        )}
      </div>
    </div>
  );
}
