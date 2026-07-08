import { Button } from '@nibleaf/design-system/components/ui/button';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AuthLayout } from '@/layouts/auth';
import { signIn, signUp } from '@/lib/auth-client';
import { minLength, required, email as validateEmail } from '@/lib/form';
import { useT } from '@/lib/i18n';
import { readPendingInvitation } from '@/lib/invitations';

interface AuthSearch {
  invite?: string;
  email?: string;
}

export const Route = createFileRoute('/(auth)/sign-up')({
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    invite: typeof search.invite === 'string' ? search.invite : undefined,
    email: typeof search.email === 'string' ? search.email : undefined,
  }),
  component: SignUpPage,
});

function SignUpPage() {
  const t = useT();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const lockedEmail = Boolean(search.email);
  const [error, setError] = useState<string | null>(null);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  const afterAuthPath = () => {
    const inviteId = search.invite ?? readPendingInvitation() ?? undefined;
    return inviteId ? `/accept-invite/${inviteId}` : '/app';
  };

  const signUpWithGoogle = async () => {
    setError(null);
    setIsGoogleSubmitting(true);
    const { error: signInError } = await signIn.social({ provider: 'google', callbackURL: afterAuthPath() });
    if (signInError) {
      setError(signInError.message ?? t('auth.signUp.error'));
      setIsGoogleSubmitting(false);
    }
  };

  const form = useForm({
    defaultValues: { name: '', email: search.email ?? '', password: '' },
    onSubmit: async ({ value }) => {
      setError(null);
      const { error: signUpError } = await signUp.email({ name: value.name, email: value.email, password: value.password });
      if (signUpError) {
        setError(signUpError.message ?? t('auth.signUp.error'));
        return;
      }
      // If they arrived from an invite, send them to the accept page to join.
      const inviteId = search.invite ?? readPendingInvitation() ?? undefined;
      if (inviteId) {
        navigate({ to: '/accept-invite/$invitationId', params: { invitationId: inviteId } });
        return;
      }
      navigate({ to: '/app' });
    },
  });

  return (
    <AuthLayout subtitle={t('auth.signUp.subtitle')}>
      <Button className="mb-4 w-full" disabled={isGoogleSubmitting || lockedEmail} onClick={signUpWithGoogle} type="button" variant="outline">
        {isGoogleSubmitting ? t('auth.google.submitting') : t('auth.google.continue')}
      </Button>
      <div className="mb-4 flex items-center gap-3 text-muted-foreground text-xs">
        <span className="h-px flex-1 bg-border" />
        <span>{t('auth.divider.or')}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.Field name="name" validators={{ onChange: ({ value }) => required('Name')(value) }}>
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">{t('auth.field.name')}</Label>
              <Input
                autoComplete="name"
                autoFocus
                id="name"
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Ada Lovelace"
                value={field.state.value}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="email" validators={{ onChange: ({ value }) => validateEmail(value) }}>
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">{t('auth.field.email')}</Label>
              <Input
                autoComplete="email"
                id="email"
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="you@company.com"
                readOnly={lockedEmail}
                type="email"
                value={field.state.value}
              />
              {lockedEmail ? (
                <p className="text-muted-foreground text-xs">{t('auth.invite.invitedAs', { email: search.email ?? '' })}</p>
              ) : (
                <FieldError errors={field.state.meta.errors} />
              )}
            </div>
          )}
        </form.Field>
        <form.Field name="password" validators={{ onChange: ({ value }) => minLength(8)(value) }}>
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">{t('auth.field.password')}</Label>
              <Input
                autoComplete="new-password"
                id="password"
                minLength={8}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={t('auth.field.passwordMinPlaceholder')}
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
              {isSubmitting ? t('auth.signUp.submitting') : t('auth.signUp.submit')}
            </Button>
          )}
        </form.Subscribe>
      </form>
      <p className="mt-5 text-center text-muted-foreground text-sm">
        {t('auth.signUp.haveAccount')}{' '}
        <Link className="text-primary hover:underline" to="/sign-in">
          {t('auth.signIn.submit')}
        </Link>
      </p>
      <p className="mt-2 text-center text-muted-foreground text-xs">
        {t('auth.signUp.verifyNotice')}{' '}
        <Link className="hover:text-primary hover:underline" to="/verify-email" search={{ email: '', token: '' }}>
          {t('auth.signUp.verifyLink')}
        </Link>
        {t('auth.signUp.verifyNoticeEnd')}
      </p>
    </AuthLayout>
  );
}
