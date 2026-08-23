import { adminClient, emailOTPClient, organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export type NibleafAuthClientOptions = {
  /** Browser-facing app origin. Admin uses this origin too so native Better Auth
   * impersonation creates the first-party session consumed after redirect. */
  baseURL: string;
};

const clientOptionsFn = ({ baseURL }: NibleafAuthClientOptions) => ({
  baseURL,
  basePath: '/api/auth' as const,
  plugins: [emailOTPClient(), organizationClient(), adminClient()] satisfies [
    ReturnType<typeof emailOTPClient>,
    ReturnType<typeof organizationClient>,
    ReturnType<typeof adminClient>,
  ],
  fetchOptions: { credentials: 'include' as const },
});

export const createNibleafAuthClientFn = (options: NibleafAuthClientOptions) => createAuthClient(clientOptionsFn(options));
export type NibleafAuthClient = ReturnType<typeof createNibleafAuthClientFn>;
