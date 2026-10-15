import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, getToken, resetSessionNotice, setToken } from '../lib/api';

function unauthorizedResponse() {
  return {
    status: 401,
    headers: { get: () => null },
    json: async () => ({ error: 'SIGN_IN_REQUIRED' }),
    text: async () => ''
  };
}
function renewedResponse(token) {
  return {
    status: 200,
    ok: true,
    headers: { get: (name) => name.toLowerCase() === 'x-session-token' ? token : name.toLowerCase() === 'content-type' ? 'application/json' : null },
    json: async () => ({ ok: true }),
    text: async () => ''
  };
}
function cookieSessionResponse() {
  return { status: 200, ok: true, headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : null }, json: async () => ({ user: { id: 7 } }), text: async () => '' };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setToken('');
  resetSessionNotice();
});

describe('session renewal races', () => {
  it('does not overwrite a newer login with an older successful session-renewal response', async () => {
    setToken('old-session-token');
    let finishRequest;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finishRequest = resolve; })));

    const pending = api('/auth/me');
    setToken('fresh-login-token');
    finishRequest(renewedResponse('renewed-old-session-token'));

    await expect(pending).resolves.toEqual({ ok: true });
    expect(getToken()).toBe('fresh-login-token');
  });

  it('accepts a renewal when the response still belongs to the current session', async () => {
    setToken('current-session-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(renewedResponse('renewed-current-session-token')));

    await expect(api('/auth/me')).resolves.toEqual({ ok: true });
    expect(getToken()).toBe('renewed-current-session-token');
  });

  it('does not erase a newer login token when an older request returns 401 late', async () => {
    setToken('expired-token');
    const ended = vi.fn();
    window.addEventListener('eventtracker:session-ended', ended);
    let finishRequest;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finishRequest = resolve; })));

    const pending = api('/auth/me');
    expect(getToken()).toBe('expired-token');
    setToken('fresh-login-token');
    finishRequest(unauthorizedResponse());

    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe('fresh-login-token');
    expect(ended).not.toHaveBeenCalled();
    window.removeEventListener('eventtracker:session-ended', ended);
  });

  it('restores a cookie session without persisting a token and reports a later expiry', async () => {
    localStorage.setItem('eventtracker.session', 'legacy-persisted-token');
    setToken('');
    expect(localStorage.getItem('eventtracker.session')).toBeNull();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(cookieSessionResponse())
      .mockResolvedValueOnce(unauthorizedResponse()));
    await expect(api('/auth/me', { silentSessionEnd: true })).resolves.toEqual({ user: { id: 7 } });
    expect(getToken()).toBe('');
    const ended = vi.fn();
    window.addEventListener('eventtracker:session-ended', ended);
    await expect(api('/events/private')).rejects.toMatchObject({ status: 401 });
    expect(ended).toHaveBeenCalledTimes(1);
    window.removeEventListener('eventtracker:session-ended', ended);
  });

  it('silently clears an expired memory token during startup auth restoration', async () => {
    setToken('stale-startup-token');
    const ended = vi.fn();
    window.addEventListener('eventtracker:session-ended', ended);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unauthorizedResponse()));

    await expect(api('/auth/me', { silentSessionEnd: true })).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe('');
    expect(ended).not.toHaveBeenCalled();
    window.removeEventListener('eventtracker:session-ended', ended);
  });

  it('still clears the current token and emits one session-ended notice for its own 401', async () => {
    setToken('expired-token');
    const ended = vi.fn();
    window.addEventListener('eventtracker:session-ended', ended);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(unauthorizedResponse()));

    await expect(api('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe('');
    expect(ended).toHaveBeenCalledTimes(1);
    window.removeEventListener('eventtracker:session-ended', ended);
  });
});
