import { auth } from '@nibleaf/auth/server';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';

export const getSessionFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    return await auth.api.getSession({ headers: getRequestHeaders() });
  } catch {
    return null;
  }
});
