import { useEffect, useMemo, useState } from 'react';

import './App.css';

import { getSessions } from './lib/api';
import {
  getUserFromAccessToken,
  getAccessToken,
  login,
  logout,
  refreshAccessToken,
  setAccessToken,
} from './lib/auth';

import { apiFetch } from './lib/auth';

function getApiUrl() {
  // If VITE_API_URL is empty, we use same-origin and rely on the Vite proxy.
  const v = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
  return v.trim() ? v : '';
}

export default function App() {
  const apiUrl = useMemo(() => getApiUrl(), []);

  const [email, setEmail] = useState('demo@local.test');
  const [password, setPassword] = useState('ChangeMe123!');

  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [sessions, setSessions] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onLogin() {
    setError(null);
    setLoading(true);
    try {
      const u = await login({
        apiUrl,
        email,
        password,
      });
      setUser(u);
      const s = await getSessions(apiUrl);
      setSessions(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onLoadSessions() {
    setError(null);
    setLoading(true);
    try {
      const s = await getSessions(apiUrl);
      setSessions(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onRefresh() {
    setError(null);
    setLoading(true);
    try {
      await refreshAccessToken(apiUrl);
      await onLoadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onLogout() {
    setError(null);
    setLoading(true);
    try {
      await logout(apiUrl);
      setUser(null);
      setSessions([]);
      setAccessToken(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onLogoutAll() {
    setError(null);
    setLoading(true);
    try {
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      await apiFetch(apiUrl, '/auth/logout-all', {
        method: 'POST',
        headers: csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : undefined,
      });

      // Clear local state regardless of response (best-effort)
      setUser(null);
      setSessions([]);
      setAccessToken(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function onRevokeSession(sessionId: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch(apiUrl, `/auth/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Revoke failed (${res.status})`);
      await onLoadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Silent session restore: refresh access token using httpOnly refresh cookie.
    // If it works, we keep the user logged in across reloads.
    async function boot() {
      setError(null);
      setLoading(true);
      try {
        await refreshAccessToken(apiUrl);

        const decoded = getUserFromAccessToken(getAccessToken());
        if (decoded) setUser({ id: decoded.sub, email: decoded.email });

        const s = await getSessions(apiUrl);
        setSessions(s);
      } catch {
        // ignore: user is not logged in
      } finally {
        setLoading(false);
      }
    }

    void boot();
  }, [apiUrl]);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1>NestJS Secure Auth Template — Demo Web</h1>
      <p style={{ opacity: 0.8 }}>
        API: <code>{apiUrl ? apiUrl : '(same-origin via Vite proxy)'}</code>
      </p>

      {!user ? (
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          <h2>Login</h2>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
            />
          </label>
          <button onClick={onLogin} disabled={loading}>
            {loading ? 'Loading…' : 'Login'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          <h2>Session</h2>
          <div>
            Logged in as <strong>{user.email}</strong>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={onLoadSessions} disabled={loading}>
              Load sessions
            </button>
            <button onClick={onRefresh} disabled={loading}>
              Refresh token (CSRF)
            </button>
            <button onClick={onLogout} disabled={loading}>
              Logout
            </button>
            <button onClick={onLogoutAll} disabled={loading}>
              Logout all
            </button>
          </div>

          <h3>Sessions</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {(sessions as any[]).map((s) => (
              <div
                key={s.id}
                style={{
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8,
                  padding: 12,
                  display: 'grid',
                  gap: 6,
                }}
              >
                <div>
                  <strong>{s.id}</strong>
                </div>
                <div style={{ opacity: 0.85, fontSize: 13 }}>
                  {s.deviceId ?? '-'} · {s.ip ?? '-'}
                </div>
                <div style={{ opacity: 0.85, fontSize: 13 }}>
                  lastSeenAt: {s.lastSeenAt}
                </div>
                <div style={{ opacity: 0.85, fontSize: 13 }}>
                  revokedAt: {s.revokedAt ?? 'null'}
                </div>

                <div>
                  <button
                    onClick={() => onRevokeSession(s.id)}
                    disabled={loading}
                    style={{ background: '#222', color: '#fff' }}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error ? (
        <p style={{ color: 'tomato', marginTop: 16 }}>
          <strong>Error:</strong> {error}
        </p>
      ) : null}

      <hr style={{ margin: '24px 0' }} />
      <p style={{ opacity: 0.8, fontSize: 14 }}>
        This demo uses option A: on 401 it calls <code>/auth/refresh</code> (cookies + CSRF header)
        and retries once.
      </p>
    </div>
  );
}
