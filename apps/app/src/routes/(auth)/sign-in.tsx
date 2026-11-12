import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { EmailCodeStep, ResendStatus, useEmailCode } from '@/components/auth-email-code';
import { AuthFormStatus, AuthTextField, useAuthFieldErrors } from '@/components/auth-form';
import { GoogleIcon } from '@/components/icons/brand';
import { TermsNotice } from '@/components/terms-notice';
import { useGetPublicMeta } from '@/hooks/api/public';
import { getPublicMetaQueryOptions } from '@/hooks/api/query-options';
import { loadRouteData } from '@/integrations/tanstack-query/query-client';
import { AuthLayout } from '@/layouts/auth';
import { friendlyAuthError } from '@/lib/auth-errors';
import { email as validateEmail } from '@/lib/form';
import { afterAuthDestination } from '@/lib/invitations';
import { currentOAuthQuery } from '@/lib/mcp-oauth';
import { authClient, signIn } from '@/services/auth-client';

export const Route = createFileRoute('/(auth)/sign-in')({
  validateSearch: (search) =>
    z
      .object({
        invite: z.string().optional().catch(undefined),
        // The dashboard page that sent a signed-out visitor here (checked by afterAuthDestination).
        next: z.string().optional().catch(undefined),
        email: z.string().optional().catch(undefined),
        // An MCP OAuth request handed off by the API (see lib/mcp-oauth).
        oauth_request: z.string().optional().catch(undefined),
      })
      .parse(search),
  // Whether to offer Google is known before the first render, on the server
  // too, so the button is in the first HTML instead of pushing the form down.
  loader: ({ context: { queryClient } }) => loadRouteData(queryClient, getPublicMetaQueryOptions()),
  // The same words the localized title uses in English (lib/auth-document-title).
  head: () => ({ meta: [{ title: 'Log in — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: SignInPage,
});

const isRedirect = (value: unknown) =>
  typeof value === 'object' &&
  value !== null &&
  (value as { redirect?: unknown }).redirect === true &&
  typeof (value as { url?: unknown }).url === 'string';

function SignInPage() {
  const t = useT();
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const [email, setEmail] = useState(search.email ?? '');
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const { data: publicMeta } = useGetPublicMeta({ initialData: Route.useLoaderData() });
  const googleEnabled = publicMeta?.providers.google ?? false;

  const normalizedEmail = email.trim().toLowerCase();
  // An MCP OAuth request: sign-in carries it so Better Auth resumes the flow.
  const [oauthQuery, setOauthQuery] = useState<string | null>(null);
  useEffect(() => setOauthQuery(currentOAuthQuery()), []);
  const connectingApp = oauthQuery !== null;
  const oauthBody = oauthQuery ? { oauth_query: oauthQuery } : {};
  // The invitation (or other page) that sent the visitor here; the (auth) guard uses the same answer.
  const destination = afterAuthDestination(search);
  const afterAuthPath = destination ?? '/app';

  const code = useEmailCode({
    flow: 'sign-in',
    email: normalizedEmail,
    verify: (otp, fetchOptions) => authClient.signIn.emailOtp({ email: normalizedEmail, otp, acceptTerms: true, ...oauthBody }, fetchOptions),
    onVerified: async (result) => {
      // During an MCP OAuth request Better Auth answers sign-in with the next
      // step ({ redirect, url }) and the auth client follows it.
      if (isRedirect(result)) return;
      if (destination) router.history.push(destination);
      else await navigate({ to: '/app' });
    },
  });
  const fields = useAuthFieldErrors({ email: validateEmail(email, t) });

  const signInWithGoogle = async () => {
    code.setError(null);
    setIsGoogleSubmitting(true);
    // With an OAuth request, Google's callback resumes it instead of opening callbackURL.
    const result = await signIn.social({ provider: 'google', callbackURL: afterAuthPath, additionalData: { acceptTerms: true }, ...oauthBody });
    if (result.error) {
      code.setError(friendlyAuthError(result.error, t, t('auth.signIn.error')));
      setIsGoogleSubmitting(false);
    }
  };

  if (code.codeSent) {
    return (
      <AuthLayout subtitle={t('auth.otp.checkEmail')}>
        <EmailCodeStep backLabel={t('auth.otp.differentEmail')} code={code} email={normalizedEmail} submitLabel={t('auth.otp.verifySignIn')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle={t('auth.signIn.subtitle')}>
      {connectingApp ? <p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">{t('auth.oauth.signInNotice')}</p> : null}
      {googleEnabled ? (
        <>
          <div className="mb-2">
            <TermsNotice />
          </div>
          <Button
            className="mb-4 w-full gap-2"
            loading={isGoogleSubmitting}
            loadingText={t('auth.google.submitting')}
            onClick={signInWithGoogle}
            type="button"
            variant="outline"
          >
            <GoogleIcon className="size-4" />
            {t('auth.google.signIn')}
          </Button>
          <div className="mb-4 flex items-center gap-3 text-muted-foreground text-xs">
            <span className="h-px flex-1 bg-border" />
            <span>{t('auth.divider.or')}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (fields.submit()) void code.requestCode();
        }}
      >
        <AuthTextField error={fields.visible('email')} id="email" label={t('auth.field.email')}>
          {(control) => (
            <Input
              {...control}
              autoComplete="email"
              autoFocus
              className="text-start"
              dir="ltr"
              onBlur={fields.onBlur('email')}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
              type="email"
              value={email}
            />
          )}
        </AuthTextField>
        {code.error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm" role="alert">
            {code.error}
          </p>
        ) : null}
        <TermsNotice />
        <ResendStatus resendIn={code.resendIn} />
        <AuthFormStatus message={fields.announcement} />
        {/* A send-wait (after a code or a rate limit) shows on this step too, and holds the button. */}
        <Button
          className="mt-1 w-full"
          disabled={code.busy !== null || code.resendIn > 0}
          loading={code.busy === 'send'}
          loadingText={t('auth.otp.sending')}
          type="submit"
        >
          {code.resendIn > 0 ? t('auth.otp.resendIn', { seconds: code.resendIn }) : t('auth.otp.sendSignIn')}
        </Button>
      </form>
      <p className="mt-5 text-center text-muted-foreground text-sm" hidden={connectingApp}>
        {t('auth.signIn.noAccount')}{' '}
        <Link className="text-primary hover:underline" search={search.next ? { next: search.next } : {}} to="/sign-up">
          {t('auth.signIn.createOne')}
        </Link>
      </p>
    </AuthLayout>
  );
}
