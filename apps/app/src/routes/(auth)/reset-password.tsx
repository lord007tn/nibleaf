import { Button } from '@nibleaf/design-system/components/ui/button';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { AuthLayout } from '@/layouts/auth';
import { authClient } from '@/lib/auth-client';
import { minLength } from '@/lib/form';
import { useT } from '@/lib/i18n';
import { passwordsMatch, resetLinkIsInvalid } from '@/lib/password-reset';

export const Route = createFileRoute('/(auth)/reset-password')({
  component: ResetPasswordPage,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
    error: typeof search.error === 'string' ? search.error : '',
  }),
});

function ResetPasswordPage() {
  const t = useT();
  const navigate = useNavigate();
  const { token, error: callbackError } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [invalidated, setInvalidated] = useState(false);

  const form = useForm({
    defaultValues: { password: '', confirmPassword: '' },
    onSubmit: async ({ value }) => {
      setError(null);
      if (!passwordsMatch(value.password, value.confirmPassword)) {
        setError(t('auth.reset.passwordMismatch'));
        return;
      }
      const { error: resetError } = await authClient.resetPassword({ newPassword: value.password, token });
      if (resetError) {
        if (resetError.code === 'INVALID_TOKEN' || resetError.message?.toLowerCase().includes('invalid token')) {
          setInvalidated(true);
          return;
        }
        setError(resetError.message ?? t('auth.reset.error'));
        return;
      }
      toast.success(t('auth.reset.success'));
      await navigate({ to: '/sign-in', replace: true });
    },
  });

  if (resetLinkIsInvalid(token, callbackError, invalidated)) {
    return (
      <AuthLayout subtitle={t('auth.forgot.subtitle')}>
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-destructive text-sm">
          {t('auth.reset.invalidLink')}
        </p>
        <p className="mt-5 text-center text-muted-foreground text-sm">
          <Link className="text-primary hover:underline" to="/forgot-password">
            {t('auth.reset.requestNew')}
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle={t('auth.reset.subtitle')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.Field name="password" validators={{ onChange: ({ value }) => minLength(8)(value) }}>
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">{t('auth.reset.newPassword')}</Label>
              <Input
                autoComplete="new-password"
                autoFocus
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
        <form.Field name="confirmPassword" validators={{ onChange: ({ value }) => minLength(8)(value) }}>
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password">{t('auth.reset.confirmPassword')}</Label>
              <Input
                autoComplete="new-password"
                id="confirm-password"
                minLength={8}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder={t('auth.reset.confirmPasswordPlaceholder')}
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
              {isSubmitting ? t('auth.reset.submitting') : t('auth.reset.submit')}
            </Button>
          )}
        </form.Subscribe>
      </form>
      <p className="mt-5 text-center text-muted-foreground text-sm">
        <Link className="text-primary hover:underline" to="/sign-in">
          {t('auth.backToSignIn')}
        </Link>
      </p>
    </AuthLayout>
  );
}
