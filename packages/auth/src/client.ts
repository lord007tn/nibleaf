import { REQUEST_LOCALE_HEADER } from '@nibleaf/i18n/locales';
import { adminClient, emailOTPClient, organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export type NibleafAuthClientOptions = {
  /** Browser-facing app origin. Admin uses this origin too so native Better Auth
   * impersonation creates the first-party session consumed after redirect. */
  baseURL: string;
  locale?: () => string;
};

export const createNibleafAuthClientFn = (options: NibleafAuthClientOptions) =>
  createAuthClient({
    baseURL: options.baseURL,
    basePath: '/api/auth',
    plugins: [emailOTPClient(), organizationClient(), adminClient()],
    fetchOptions: {
      credentials: 'include',
      ...(options.locale
        ? {
            onRequest: (context) => {
              context.headers.set(REQUEST_LOCALE_HEADER, options.locale?.() ?? 'en');
              return context;
            },
          }
        : {}),
    },
  });
