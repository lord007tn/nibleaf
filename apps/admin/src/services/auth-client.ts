import { createNibleafAuthClientFn } from '@nibleaf/auth/client';
import { getLocale } from '@nibleaf/i18n';
import { apiOrigin } from './api-origin';

// Browsers use the customer app's shared auth origin so Better Auth's native
// impersonation session is available after the operator redirects there.
const API_URL = apiOrigin();

export const authClient = createNibleafAuthClientFn({ baseURL: API_URL, locale: getLocale });

export const { signOut, useSession } = authClient;
