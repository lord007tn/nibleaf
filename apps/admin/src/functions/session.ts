import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import got from 'got';
import { z } from 'zod';

export const getSessionFn = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest();

  try {
    const response = await got(new URL('/api/auth/get-session', request.url), {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      responseType: 'json',
      retry: { limit: 0 },
      throwHttpErrors: false,
      timeout: { request: 5000 },
    });
    if (!response.ok) return null;

    const parsed = z
      .object({
        session: z.object({ id: z.string().trim().min(1), userId: z.string().trim().min(1) }),
        user: z.object({
          email: z.string().nullable().optional(),
          id: z.string().trim().min(1),
          name: z.string().nullable().optional(),
          role: z.string().nullable().optional(),
        }),
      })
      .safeParse(response.body);

    return parsed.success && parsed.data.session.userId === parsed.data.user.id ? parsed.data : null;
  } catch {
    return null;
  }
});
