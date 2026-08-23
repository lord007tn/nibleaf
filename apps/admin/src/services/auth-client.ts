import { createNibleafAuthClientFn } from '@nibleaf/auth/client';
import { APP_URL } from '@/lib/links';

// Use the customer app's shared auth origin so Better Auth's native
// impersonation session is available after the operator redirects there.
const API_URL = APP_URL;

export const authClient = createNibleafAuthClientFn({ baseURL: API_URL });

export const { signOut, useSession } = authClient;
