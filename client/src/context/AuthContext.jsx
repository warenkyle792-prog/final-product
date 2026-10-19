import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, hadSession, markSession, onUnauthorized, setToken } from '../api/client';

const AuthContext = createContext(null);

/** How often an open tab renews its session while it is being used. */
const RENEW_EVERY_MS = 6 * 60 * 60 * 1000;
/** Returning to a tab this long after the last check triggers a renewal. */
const STALE_AFTER_MS = 30 * 60 * 1000;

export function AuthProvider({ children }) {
  /**
   * Start in "loading" when this browser might already have a session, so the
   * interface never flashes a signed-out state at someone who is signed in.
   * A cookie session may exist with nothing in storage, which is exactly the
   * case where the app used to look signed out on every reload.
   */
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(getToken()) || hadSession());
  const [sessionExpired, setSessionExpired] = useState(false);
  const lastCheck = useRef(0);

  const refreshUser = useCallback(async () => {
    // No token and no hint of a session: there is nothing to restore.
    if (!getToken() && !hadSession()) {
      setUser(null);
      lastCheck.current = Date.now();
      return null;
    }

    try {
      const { user: fresh } = await api.get('/auth/me');
      lastCheck.current = Date.now();
      markSession(true);   // the server just confirmed a session exists
      setUser(fresh);
      return fresh;
    } catch (error) {
      lastCheck.current = Date.now();
      if (error.status === 401) {
        setToken(null);
        markSession(false);
        setUser(null);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshUser();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshUser]);

  /**
   * Renew while the tab is open. The server slides the session on every call
   * and hands back a fresh token, so long sessions stay alive and the stored
   * token is never left to expire underneath the user.
   */
  useEffect(() => {
    if (!user) return undefined;

    const renew = async () => {
      try {
        await api.post('/auth/refresh', {});
        lastCheck.current = Date.now();
      } catch (error) {
        // A 401 is handled centrally; network hiccups just retry next time.
      }
    };

    const interval = setInterval(renew, RENEW_EVERY_MS);

    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheck.current > STALE_AFTER_MS) renew();
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [user]);

  /**
   * A 401 to a request that carried a session means it really is gone. Clear
   * the cached user so screens show a sign-in prompt instead of failing every
   * action with a server error string.
   */
  useEffect(() => onUnauthorized(() => {
    setUser(null);
    setSessionExpired(true);
  }), []);

  /** Resolves with the signed-in user (not the raw { token, user } payload). */
  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setToken(data.token);
    markSession(true);
    setUser(data.user);
    setSessionExpired(false);
    lastCheck.current = Date.now();
    return data.user;
  }, []);

  /** Resolves with the newly registered user. */
  const register = useCallback(async (payload) => {
    const data = await api.post('/auth/register', payload);
    setToken(data.token);
    markSession(true);
    setUser(data.user);
    setSessionExpired(false);
    lastCheck.current = Date.now();
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    // Tell the server first so the session row is revoked and the cookie is
    // cleared; the local state goes regardless of the network.
    try {
      await api.post('/auth/logout', {});
    } catch {
      /* signing out locally still stands */
    }
    setToken(null);
    markSession(false);
    setUser(null);
    setSessionExpired(false); // a deliberate sign-out is not an expired session
  }, []);

  /** Merge server-returned fields into the cached profile. */
  const patchUser = useCallback((patch) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      sessionExpired,
      isAdmin: user?.role === 'admin',
      isOrganizer: user?.role === 'admin' || user?.role === 'organizer',
      login,
      register,
      logout,
      refreshUser,
      patchUser,
      setUser,
    }),
    [user, loading, sessionExpired, login, register, logout, refreshUser, patchUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
