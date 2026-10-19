/**
 * Thin API client: token storage, JSON helpers, uploads and payment polling.
 */

const TOKEN_KEY = 'eventtracker_token';

/**
 * Token storage with fallbacks.
 *
 * localStorage is the right home for a session, but it can be blocked
 * (private mode, partitioned iframes) or evicted underneath a running tab.
 * Falling back to sessionStorage and then to memory keeps a signed-in tab
 * usable, instead of leaving the app convinced it is authenticated while every
 * request goes out without a token.
 */
const memoryToken = { value: null };

function safeStorage(kind) {
  try {
    const store = window[kind];
    const probe = '__eventtracker_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

const HINT_KEY = 'eventtracker_session';

/**
 * Some browsers refuse storage entirely. A memory-only hint still tells the app
 * on the next load that a cookie session may exist, so it can ask the server
 * instead of assuming the visitor is a stranger.
 */
export function markSession(active) {
  memoryToken.hadSession = Boolean(active);
  for (const kind of ['localStorage', 'sessionStorage']) {
    const store = safeStorage(kind);
    if (!store) continue;
    try {
      if (active) store.setItem(HINT_KEY, '1');
      else store.removeItem(HINT_KEY);
    } catch {
      /* keep going */
    }
  }
}

/** Re-persist a token that storage lost while the tab kept working. */
function persistTokenIfMissing(token) {
  if (!token) return;
  for (const kind of ['localStorage', 'sessionStorage']) {
    try {
      if (window[kind].getItem(TOKEN_KEY) === token) return;   // already stored
    } catch {
      /* check the next store */
    }
  }
  setToken(token);
}

export function hadSession() {
  if (memoryToken.hadSession) return true;
  for (const kind of ['localStorage', 'sessionStorage']) {
    try {
      if (window[kind].getItem(HINT_KEY)) return true;
    } catch {
      /* try the next store */
    }
  }
  return false;
}

export function getToken() {
  for (const kind of ['localStorage', 'sessionStorage']) {
    try {
      const value = window[kind].getItem(TOKEN_KEY);
      if (value) return value;
    } catch {
      /* try the next store */
    }
  }
  return memoryToken.value;
}

export function setToken(token) {
  memoryToken.value = token || null;

  for (const kind of ['localStorage', 'sessionStorage']) {
    const store = safeStorage(kind);
    if (!store) continue;
    try {
      if (token) store.setItem(TOKEN_KEY, token);
      else store.removeItem(TOKEN_KEY);
    } catch {
      /* keep going — another store may accept it */
    }
  }

  if (token) markSession(true);
}

/* ------------------------------------------------------------------ *
 * Session expiry
 *
 * Any 401 means the session is gone, however it happened: another tab
 * signed out, storage was cleared, or the token expired. Listeners clear the
 * session and tell the user once, so a protected screen shows its sign-in
 * prompt instead of repeating a raw server message on every attempt.
 * ------------------------------------------------------------------ */

const unauthorizedListeners = new Set();

/** Shown when a request is rejected for a missing or expired session. */
export const SESSION_ENDED_MESSAGE = 'Your session has ended — sign in again to continue.';

/** Subscribe to 401s. Returns an unsubscribe function. */
export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function reportUnauthorized() {
  for (const listener of unauthorizedListeners) {
    try {
      listener();
    } catch {
      /* a failing listener must not break the request */
    }
  }
}

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, { method = 'GET', body, formData, auth = true, signal } = {}) {
  const headers = {
    // Marks the request as coming from the app itself: the server only accepts
    // a session cookie for state-changing calls when this header is present,
    // which a cross-site form cannot set.
    'X-Requested-With': 'eventtracker',
  };
  const token = getToken();
  const sentCredentials = Boolean(auth && token);

  if (sentCredentials) headers.Authorization = `Bearer ${token}`;
  if (body && !formData) headers['Content-Type'] = 'application/json';

  let res;

  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: formData ? body : body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Network unavailable — check your connection and try again.', 0);
  }

  // The server slides the session and hands back a fresh token when the
  // current one ages out; adopt it so storage never holds a stale value.
  const refreshed = res.headers?.get?.('X-Session-Token');
  if (refreshed) {
    setToken(refreshed);
    markSession(true);
  } else if (sentCredentials && res.ok) {
    persistTokenIfMissing(token);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON response */
  }

  if (!res.ok) {
    /**
     * A 401 means "your session ended" when this request carried a session, or
     * when the app believes one exists — the token may have been wiped from
     * storage under a running tab, which is exactly how people end up signed
     * out without being told. It never applies to the sign-in form itself, and
     * a visitor who was never signed in is simply a guest.
     */
    const credentialsAttempt = path === '/auth/login' || path === '/auth/register' || path === '/auth/refresh';
    const believesSignedIn = sentCredentials || hadSession();
    if (res.status === 401 && believesSignedIn && !credentialsAttempt) {
      setToken(null);
      markSession(false);
      reportUnauthorized();
      throw new ApiError(SESSION_ENDED_MESSAGE, 401, data);
    }

    throw new ApiError(
      data?.error || `Request failed (${res.status})`,
      res.status,
      data
    );
  }

  return data;
}

export const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  del: (path, options) => request(path, { ...options, method: 'DELETE' }),
  upload: (path, formData) => request(path, { method: 'POST', body: formData, formData }),
  uploadData: (path, data) => request(path, { method: 'POST', body: { data } }),
};

/** Absolute URL for a stored upload path (works for share links too). */
export function assetUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//.test(path) || path.startsWith('data:')) return path;
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Poll a payment until it reaches a terminal state.
 * The server is the only source of truth — the client merely asks for status.
 */
export function pollPayment(reference, { onUpdate, intervalMs = 2600, timeoutMs = 180000 } = {}) {
  let stopped = false;
  const startedAt = Date.now();

  const tick = async () => {
    if (stopped) return null;

    try {
      const data = await api.get(`/payments/${reference}`);
      onUpdate?.(data);

      const status = data?.transaction?.status;
      if (['successful', 'failed', 'cancelled', 'refunded'].includes(status)) return data;
    } catch (error) {
      if (error.status === 404) throw error;
    }

    if (Date.now() - startedAt > timeoutMs) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    return tick();
  };

  const promise = tick();
  promise.cancel = () => {
    stopped = true;
  };
  return promise;
}

export const money = (cents, currency = 'KES') => {
  const value = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(currency === 'KES' ? 'en-KE' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
      .format(value)
      .replace(/\u00a0/g, ' ');
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
};
