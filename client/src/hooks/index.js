import { useCallback, useEffect, useRef, useState } from 'react';

/** Match a CSS media query, re-rendering when it changes. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
export const useIsMobile = () => useMediaQuery('(max-width: 860px)');

/** Pause expensive CSS animations while the tab is in the background. */
export function useDocumentVisible() {
  const [visible, setVisible] = useState(() => !document.hidden);

  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
}

/** Small data-fetching hook with manual reload and abort handling. */
export function useAsync(fn, deps = [], { immediate = true } = {}) {
  const [state, setState] = useState({ data: null, loading: immediate, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fnRef.current();
      setState({ data, loading: false, error: null });
      return data;
    } catch (error) {
      setState({ data: null, loading: false, error });
      return null;
    }
  }, []);

  useEffect(() => {
    if (!immediate) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await fnRef.current();
        if (!cancelled) setState({ data, loading: false, error: null });
      } catch (error) {
        if (!cancelled) setState({ data: null, loading: false, error });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data })) };
}

/** Run a callback on an interval, cleaning up on unmount. */
export function useInterval(callback, delay) {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
    if (delay == null) return undefined;
    const id = setInterval(() => ref.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

/** Lock body scroll (modals, drawer, camera sheets). */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · EventTracker` : 'EventTracker — discover what\'s happening around you';
  }, [title]);
}

/** Debounce a rapidly changing value (search inputs). */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}

/** Close on outside click / Escape. */
export function useDismiss(ref, onDismiss, active = true) {
  useEffect(() => {
    if (!active) return undefined;

    const onClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onDismiss();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') onDismiss();
    };

    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, onDismiss, active]);
}

/** Copy text with a short-lived "copied" flag. */
export function useCopy(timeout = 1800) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement('textarea');
        el.value = text;
        el.setAttribute('readonly', '');
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), timeout);
      return true;
    } catch {
      return false;
    }
  }, [timeout]);

  return { copied, copy };
}
