import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthLayout } from '@/layouts/auth';
import { authClient } from '@/lib/auth-client';
import { email as validateEmail } from '@/lib/form';
import { useT } from '@/lib/i18n';

export const Route = createFileRoute('/(auth)/forgot-password')({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const t = useT();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      setError(null);
      const { error: resetError } = await authClient.requestPasswordReset({
        email: value.email,
        redirectTo: window.location.origin + '/reset-password',
      });
      if (resetError) {
        setError(resetError.message ?? t('auth.forgot.error'));
        return;
      }
      setSentTo(value.email);
    },
  });

  if (sentTo) {
    return (
      <AuthLayout subtitle={t('auth.forgot.checkEmail')}>
        <p className="text-center text-muted-foreground text-sm">
          {t('auth.forgot.sentPrefix')} <span className="font-medium text-foreground">{sentTo}</span>
          {t('auth.forgot.sentSuffix')}
        </p>
        <p className="mt-5 text-center text-muted-foreground text-sm">
          <Link className="text-primary hover:underline" to="/sign-in">
            {t('auth.backToSignIn')}
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle={t('auth.forgot.subtitle')}>
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
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">{error}</p> : null}
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button className="mt-1 w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? t('auth.forgot.submitting') : t('auth.forgot.submit')}
            </Button>
          )}
        </form.Subscribe>
      </form>
      <p className="mt-5 text-center text-muted-foreground text-sm">
        {t('auth.forgot.remembered')}{' '}
        <Link className="text-primary hover:underline" to="/sign-in">
          {t('auth.signIn.submit')}
        </Link>
      </p>
    </AuthLayout>
  );
}
