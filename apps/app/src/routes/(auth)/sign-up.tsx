import { Button } from '@midad/design-system/components/ui/button';
import { FieldError } from '@midad/design-system/components/ui/form-field';
import { Input } from '@midad/design-system/components/ui/input';
import { Label } from '@midad/design-system/components/ui/label';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AuthLayout } from '@/layouts/auth';
import { signUp } from '@/lib/auth-client';
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
