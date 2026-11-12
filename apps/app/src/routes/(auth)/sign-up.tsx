import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { EmailCodeStep, useEmailCode } from '@/components/auth-email-code';
import { AuthTextField, useAuthFieldErrors } from '@/components/auth-form';
import { GoogleIcon } from '@/components/icons/brand';
import { QueryErrorState } from '@/components/query-error-state';
import { TermsNotice } from '@/components/terms-notice';
import { useGetPublicMeta } from '@/hooks/api/public';
import { getPublicMetaQueryOptions } from '@/hooks/api/query-options';
import { loadRouteData } from '@/integrations/tanstack-query/query-client';
import { AuthLayout } from '@/layouts/auth';
import { friendlyAuthError } from '@/lib/auth-errors';
import { email as validateEmail } from '@/lib/form';
import { afterAuthDestination } from '@/lib/invitations';
import { authClient, signIn } from '@/services/auth-client';

export const Route = createFileRoute('/(auth)/sign-up')({
  validateSearch: (search) =>
    z
      .object({
        invite: z.string().optional().catch(undefined),
        // The dashboard page that sent a signed-out visitor here (checked by afterAuthDestination).
        next: z.string().optional().catch(undefined),
        email: z.string().optional().catch(undefined),
        intent: z.literal('first-publish').optional().catch(undefined),
      })
      .parse(search),
  // The form depends on the instance metadata (sign-up open? Google?). It is
  // known before the first render, on the server too, so the first HTML is the
  // final form, not a placeholder that the Google button later pushes down.
  loader: ({ context: { queryClient } }) => loadRouteData(queryClient, getPublicMetaQueryOptions()),
  // The same words the localized title uses in English (lib/auth-document-title).
  head: () => ({ meta: [{ title: 'Create account — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: SignUpPage,
});

const SIGN_UP_SKELETON_FIELDS = ['name', 'email'];

function SignUpPage() {
  const t = useT();
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const lockedEmail = Boolean(search.email);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(search.email ?? '');
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const {
    data: publicMeta,
    isPending: metaPending,
    isError: metaError,
    isFetching: metaFetching,
    refetch: retryMeta,
  } = useGetPublicMeta({ initialData: Route.useLoaderData() });
  const googleEnabled = publicMeta?.providers.google ?? false;
  const signupDisabled = publicMeta?.signupDisabled ?? true;

  const normalizedEmail = email.trim().toLowerCase();
  // The invitation (or other page) that sent the visitor here; the (auth) guard uses the same answer.
  const destination = afterAuthDestination(search);
  const firstPublish = search.intent === 'first-publish';
  const afterAuthPath = destination ?? (firstPublish ? '/app?firstPublish=true' : '/app');

  const code = useEmailCode({
    email: normalizedEmail,
    verify: (otp, fetchOptions) => authClient.signIn.emailOtp({ email: normalizedEmail, otp, acceptTerms: true, name: name.trim() }, fetchOptions),
    onVerified: async () => {
      if (destination) router.history.push(destination);
      else await navigate({ to: '/app', search: firstPublish ? { firstPublish: true } : {} });
    },
  });
  const fields = useAuthFieldErrors({ name: name.trim() ? undefined : t('auth.name.required'), email: validateEmail(email, t) });

  const signUpWithGoogle = async () => {
    code.setError(null);
    setIsGoogleSubmitting(true);
    const result = await signIn.social({ provider: 'google', callbackURL: afterAuthPath, additionalData: { acceptTerms: true } });
    if (result.error) {
      code.setError(friendlyAuthError(result.error, t, t('auth.signUp.error')));
      setIsGoogleSubmitting(false);
    }
  };

  if (metaPending) {
    // Only when the server couldn't read the instance metadata. Shaped like
    // the form below (name, email, terms, button).
    return (
      <AuthLayout subtitle={t('auth.signUp.subtitle')}>
        <div aria-busy="true" className="flex flex-col gap-4">
          <p className="sr-only" role="status">
            {t('common.loading')}
          </p>
          {SIGN_UP_SKELETON_FIELDS.map((field) => (
            <div aria-hidden className="flex flex-col gap-1.5" key={field}>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
          <div aria-hidden className="flex items-start gap-2.5">
            <Skeleton className="h-4 flex-1" />
          </div>
          <Skeleton aria-hidden className="mt-1 h-9 w-full" />
        </div>
      </AuthLayout>
    );
  }

  if (metaError || !publicMeta) {
    return (
      <AuthLayout subtitle={t('auth.signUp.subtitle')}>
        <QueryErrorState onRetry={() => void retryMeta()} retrying={metaFetching} />
      </AuthLayout>
    );
  }

  if (signupDisabled) {
    return (
      <AuthLayout subtitle={t('auth.signUp.subtitle')}>
        <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-center text-muted-foreground text-sm">
          {t('auth.legal.signupDisabled')}
        </p>
        <p className="mt-5 text-center text-muted-foreground text-sm">
          {t('auth.signUp.haveAccount')}{' '}
          <Link className="text-primary hover:underline" search={search.next ? { next: search.next } : {}} to="/sign-in">
            {t('auth.signIn.submit')}
          </Link>
        </p>
      </AuthLayout>
    );
  }

  if (code.codeSent) {
    return (
      <AuthLayout subtitle={t('auth.otp.checkEmail')}>
        <EmailCodeStep backLabel={t('auth.otp.changeDetails')} code={code} email={normalizedEmail} submitLabel={t('auth.otp.verifyCreate')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle={t('auth.signUp.subtitle')}>
      {/* An invitation is tied to one address, so Google (which may pick another) is hidden. */}
      {googleEnabled && !lockedEmail ? (
        <>
          <div className="mb-2">
            <TermsNotice />
          </div>
          <Button
            className="mb-4 w-full gap-2"
            loading={isGoogleSubmitting}
            loadingText={t('auth.google.submitting')}
            onClick={signUpWithGoogle}
            type="button"
            variant="outline"
          >
            <GoogleIcon className="size-4" />
            {t('auth.google.signUp')}
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
        <AuthTextField error={fields.visible('name')} id="name" label={t('auth.field.name')}>
          {(control) => (
            <Input
              {...control}
              autoComplete="name"
              autoFocus
              onBlur={fields.onBlur('name')}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('auth.field.namePlaceholder')}
              required
              value={name}
            />
          )}
        </AuthTextField>
        <AuthTextField
          description={lockedEmail ? t('auth.invite.invitedAs', { email: search.email ?? '' }) : undefined}
          error={fields.visible('email')}
          id="email"
          label={t('auth.field.email')}
        >
          {(control) => (
            <Input
              {...control}
              autoComplete="email"
              className="text-start"
              dir="ltr"
              onBlur={fields.onBlur('email')}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              readOnly={lockedEmail}
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
        <Button
          className="mt-1 w-full"
          disabled={code.busy !== null}
          loading={code.busy === 'send'}
          loadingText={t('auth.otp.sending')}
          type="submit"
        >
          {t('auth.otp.sendCreate')}
        </Button>
      </form>
      <p className="mt-5 text-center text-muted-foreground text-sm">
        {t('auth.signUp.haveAccount')}{' '}
        <Link className="text-primary hover:underline" search={search.next ? { next: search.next } : {}} to="/sign-in">
          {t('auth.signIn.submit')}
        </Link>
      </p>
    </AuthLayout>
  );
}
