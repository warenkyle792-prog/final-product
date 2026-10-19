import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useDebounced } from './index';

const DEFAULTS = {
  search: '',
  category: '',
  when: '',
  location: '',
  price: '',
  sort: 'soon',
  page: 1,
  limit: 12,
};

/**
 * Event search state kept in the URL so filters are shareable and the back
 * button behaves. All filtering actually happens on the server.
 */
export function useEventSearch(overrides = {}) {
  const [params, setParams] = useSearchParams();
  const initial = useMemo(() => ({ ...DEFAULTS, ...overrides }), [overrides]);

  const [filters, setFilters] = useState(() => {
    const next = { ...initial };
    for (const key of Object.keys(DEFAULTS)) {
      const value = params.get(key);
      if (value != null && value !== '') next[key] = key === 'page' || key === 'limit' ? Number(value) : value;
    }
    return next;
  });

  const [state, setState] = useState({ events: [], total: 0, pages: 1, loading: true, error: null });
  const debouncedSearch = useDebounced(filters.search, 350);

  const query = useMemo(() => {
    const query = new URLSearchParams();
    const merged = { ...filters, search: debouncedSearch };
    for (const [key, value] of Object.entries(merged)) {
      if (value === '' || value == null) continue;
      if (key === 'page' && Number(value) === 1) continue;
      if (key === 'sort' && value === DEFAULTS.sort) continue;
      if (key === 'limit' && Number(value) === DEFAULTS.limit) continue;
      if (key === 'search' && !value) continue;
      query.set(key, String(value));
    }
    return query;
  }, [filters, debouncedSearch]);

  // Keep the address bar in sync (replaceState so typing does not spam history).
  useEffect(() => {
    setParams(query, { replace: true });
  }, [query, setParams]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setState((current) => ({ ...current, loading: true, error: null }));

    api.get(`/events?${query.toString()}`, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setState({
          events: data.events || [],
          total: data.total || 0,
          pages: data.pages || 1,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (error.name === 'AbortError' || !active) return;
        setState({ events: [], total: 0, pages: 1, loading: false, error });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [query]);

  const update = useCallback((patch) => {
    setFilters((current) => {
      const next = { ...current, ...patch };
      if (!('page' in patch)) next.page = 1;
      return next;
    });
  }, []);

  const reset = useCallback(() => setFilters({ ...initial }), [initial]);

  const activeFilters = useMemo(() => {
    const chips = [];
    if (filters.search) chips.push({ key: 'search', label: `“${filters.search}”` });
    if (filters.category) {
      chips.push({
        key: 'category',
        label: filters.category.split(',').map((slug) => slug.replace(/-/g, ' ')).join(', '),
      });
    }
    if (filters.when) {
      const labels = { today: 'Today', tomorrow: 'Tomorrow', weekend: 'This weekend', week: 'Next 7 days', month: 'Next 30 days', past: 'Past events' };
      chips.push({ key: 'when', label: labels[filters.when] || filters.when });
    }
    if (filters.location) chips.push({ key: 'location', label: filters.location });
    if (filters.price) chips.push({ key: 'price', label: filters.price === 'free' ? 'Free' : 'Paid' });
    return chips;
  }, [filters]);

  const clearFilter = useCallback((key) => update({ [key]: '' }), [update]);

  return {
    filters,
    update,
    reset,
    clearFilter,
    activeFilters,
    setFilters,
    ...state,
  };
}
