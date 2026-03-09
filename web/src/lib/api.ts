import { z } from 'zod';

import { apiFetch } from './auth';

const sessionsSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string(),
      deviceId: z.string().nullable().optional(),
      userAgent: z.string().nullable().optional(),
      ip: z.string().nullable().optional(),
      lastSeenAt: z.string(),
      revokedAt: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export async function getSessions(apiUrl: string) {
  const res = await apiFetch(apiUrl, '/auth/sessions');
  if (!res.ok) throw new Error(`sessions failed (${res.status})`);

  const json: unknown = await res.json();
  const parsed = sessionsSchema.safeParse(json);
  if (!parsed.success) throw new Error('Invalid sessions response');

  return parsed.data.sessions;
}
