import { Button } from '@nibleaf/design-system/components/ui/button';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { GoogleIcon } from '@/components/icons/brand';
import { AuthLayout } from '@/layouts/auth';
import { signIn } from '@/lib/auth-client';
import { required, email as validateEmail } from '@/lib/form';
import { useT } from '@/lib/i18n';
import { readPendingInvitation } from '@/lib/invitations';

interface AuthSearch {
  invite?: string;
  email?: string;
}

export const Route = createFileRoute('/(auth)/sign-in')({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    invite: typeof search.invite === 'string' ? search.invite : undefined,
    email: typeof search.email === 'string' ? search.email : undefined,
  }),
  head: () => ({
    meta: [{ title: 'Sign in — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: SignInPage,
});

/** Shape of GET /api/public/meta (instance capabilities). */
interface PublicMeta {
  providers?: { google?: boolean };
}

/** Whether the Google provider is configured on this instance. Defensive: if
 *  /api/public/meta is missing or fails, keep the current behaviour (show it). */
function useGoogleEnabled() {
  const [googleEnabled, setGoogleEnabled] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/public/meta');
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as PublicMeta;
        if (!cancelled) {
          setGoogleEnabled(data.providers?.google === true);
        }
      } catch {
        // Endpoint unavailable — keep the permissive default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return googleEnabled;
}

function SignInPage() {
  const t = useT();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const googleEnabled = useGoogleEnabled();

  const afterAuthPath = () => {
    const inviteId = search.invite ?? readPendingInvitation() ?? undefined;
    return inviteId ? `/accept-invite/${inviteId}` : '/app';
  };

  const signInWithGoogle = async () => {
    setError(null);
    setIsGoogleSubmitting(true);
    const { error: signInError } = await signIn.social({ provider: 'google', callbackURL: afterAuthPath() });
    if (signInError) {
      setError(signInError.message ?? t('auth.signIn.error'));
      setIsGoogleSubmitting(false);
    }
  };

  const form = useForm({
    defaultValues: { email: search.email ?? '', password: '' },
    onSubmit: async ({ value }) => {
      setError(null);
      const { error: signInError } = await signIn.email({ email: value.email, password: value.password });
      if (signInError) {
        setError(signInError.message ?? t('auth.signIn.error'));
        return;
      }
      const inviteId = search.invite ?? readPendingInvitation() ?? undefined;
      if (inviteId) {
        navigate({ to: '/accept-invite/$invitationId', params: { invitationId: inviteId } });
        return;
      }
      navigate({ to: '/app' });
    },
  });

  return (
    <AuthLayout subtitle={t('auth.signIn.subtitle')}>
      {googleEnabled ? (
        <>
          <Button className="mb-2 w-full gap-2" disabled={isGoogleSubmitting} onClick={signInWithGoogle} type="button" variant="outline">
            <GoogleIcon className="size-4" />
            {isGoogleSubmitting ? t('auth.google.submitting') : t('auth.google.continue')}
          </Button>
          {/* Google sign-in registers first-time users, so consent must be
              obtained here too — /sign-up's checkbox does not cover this path. */}
          <p className="mb-4 text-center text-muted-foreground text-xs leading-relaxed">
            {t('auth.legal.socialNoticePrefix')}
            <Link className="underline hover:text-primary" to="/terms">
              {t('auth.legal.terms')}
            </Link>
            {t('auth.legal.and')}
            <Link className="underline hover:text-primary" to="/privacy">
              {t('auth.legal.privacy')}
            </Link>
            {t('auth.legal.agreeSuffix')}
          </p>
          <div className="mb-4 flex items-center gap-3 text-muted-foreground text-xs">
            <span className="h-px flex-1 bg-border" />
            <span>{t('auth.divider.or')}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.Field name="email" validators={{ onChange: ({ value }) => validateEmail(value) }}>
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">{t('auth.field.email')}</Label>
              <Input
                autoComplete="email"
                autoFocus
                id="email"
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="you@company.com"
                type="email"
                value={field.state.value}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="password" validators={{ onChange: ({ value }) => required('Password')(value) }}>
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t('auth.field.password')}</Label>
                <Link className="text-muted-foreground text-xs hover:text-primary hover:underline" to="/forgot-password">
                  {t('auth.signIn.forgotPassword')}
                </Link>
              </div>
              <Input
                autoComplete="current-password"
                id="password"
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={t('auth.signIn.passwordPlaceholder')}
                type="password"
                value={field.state.value}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">{error}</p> : null}
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button className="mt-1 w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? t('auth.signIn.submitting') : t('auth.signIn.submit')}
            </Button>
          )}
        </form.Subscribe>
      </form>
      <p className="mt-5 text-center text-muted-foreground text-sm">
        {t('auth.signIn.noAccount')}{' '}
        <Link className="text-primary hover:underline" to="/sign-up">
          {t('auth.signIn.createOne')}
        </Link>
      </p>
    </AuthLayout>
  );
}
