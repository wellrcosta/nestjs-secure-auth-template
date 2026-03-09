import { z } from 'zod';

const loginResponseSchema = z.object({
  access_token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
  }),
});

type LoginResponse = z.infer<typeof loginResponseSchema>;

let accessToken: string | null = null;
let refreshing: Promise<void> | null = null;

export type AccessTokenUser = { sub: string; sid: string; email: string };

function base64UrlToBase64(input: string) {
  return input.replace(/-/g, '+').replace(/_/g, '/');
}

export function getUserFromAccessToken(token: string | null): AccessTokenUser | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1];
    const json = atob(base64UrlToBase64(payload));
    const data = JSON.parse(json) as Partial<AccessTokenUser>;

    if (!data.sub || !data.sid || !data.email) return null;
    return { sub: data.sub, sid: data.sid, email: data.email };
  } catch {
    return null;
  }
}

function safeRandomId() {
  // Prefer Web Crypto
  const webCrypto = (globalThis as any).crypto as Crypto | undefined;

  if (webCrypto?.randomUUID) return webCrypto.randomUUID();

  if (webCrypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Fallback (not cryptographically strong, but ok for a demo deviceId)
  return `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
}

export function getOrCreateDeviceId() {
  const key = 'secure_auth_device_id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const id = `web_${safeRandomId()}`;
  localStorage.setItem(key, id);
  return id;
}


export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function getCsrfTokenFromCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function login(input: {
  apiUrl: string;
  email: string;
  password: string;
}) {
  const prefix = input.apiUrl ? input.apiUrl : '';
  const res = await fetch(`${prefix}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      deviceId: getOrCreateDeviceId(),
    }),
  });

  if (!res.ok) throw new Error(`Login failed (${res.status})`);

  const json: unknown = await res.json();
  const parsed = loginResponseSchema.safeParse(json);
  if (!parsed.success) throw new Error('Invalid login response');

  const data: LoginResponse = parsed.data;
  setAccessToken(data.access_token);
  return data.user;
}

async function doRefreshAccessToken(apiUrl: string) {
  const csrf = getCsrfTokenFromCookie();
  if (!csrf) throw new Error('Missing csrf_token cookie');

  const prefix = apiUrl ? apiUrl : '';
  const res = await fetch(`${prefix}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-csrf-token': csrf,
    },
  });

  if (!res.ok) {
    let details = '';
    try {
      const json = (await res.json()) as { message?: string };
      details = json?.message ? `: ${json.message}` : '';
    } catch {
      // ignore
    }

    throw new Error(`Refresh failed (${res.status})${details}`);
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Invalid refresh response');

  setAccessToken(json.access_token);
}

/**
 * Ensures only one refresh happens at a time.
 * This prevents refresh-token rotation races that would otherwise cause a 401.
 */
export async function refreshAccessToken(apiUrl: string) {
  refreshing ??= doRefreshAccessToken(apiUrl).finally(() => {
    refreshing = null;
  });

  await refreshing;
}

export async function apiFetch(apiUrl: string, path: string, init: RequestInit = {}) {
  async function doRequest() {
    const headers = new Headers(init.headers);
    const token = getAccessToken();
    if (token) headers.set('authorization', `Bearer ${token}`);

    const prefix = apiUrl ? apiUrl : '';
    return fetch(`${prefix}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  }

  let res = await doRequest();
  if (res.status !== 401) return res;

  await refreshAccessToken(apiUrl);

  // Retry once
  return doRequest();
}

export async function logout(apiUrl: string) {
  // Logout should be best-effort and idempotent.
  // If the user is already logged out (missing cookies / session revoked), we still clear local state.
  const csrf = getCsrfTokenFromCookie();
  const prefix = apiUrl ? apiUrl : '';

  try {
    const res = await fetch(`${prefix}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: csrf
        ? {
            'x-csrf-token': csrf,
          }
        : undefined,
    });

    // If cookies are missing or CSRF is invalid, the API returns 401.
    // For UX, we still consider the user logged out on the client.
    if (!res.ok && res.status !== 401) {
      const text = await res.text().catch(() => '');
      throw new Error(`Logout failed (${res.status})${text ? `: ${text}` : ''}`);
    }
  } finally {
    setAccessToken(null);
  }
}
