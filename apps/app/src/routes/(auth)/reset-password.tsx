import { Button } from '@midad/design-system/components/ui/button';
import { FieldError } from '@midad/design-system/components/ui/form-field';
import { Input } from '@midad/design-system/components/ui/input';
import { Label } from '@midad/design-system/components/ui/label';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { AuthLayout } from '@/layouts/auth';
import { authClient } from '@/lib/auth-client';
import { minLength } from '@/lib/form';
import { useT } from '@/lib/i18n';

export const Route = createFileRoute('/(auth)/reset-password')({
  component: ResetPasswordPage,
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s.token === 'string' ? s.token : '' }),
});

function ResetPasswordPage() {
  const t = useT();
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { password: '' },
    onSubmit: async ({ value }) => {
      setError(null);
      const { error: resetError } = await authClient.resetPassword({ newPassword: value.password, token });
      if (resetError) {
        setError(resetError.message ?? t('auth.reset.error'));
        return;
      }
      toast.success(t('auth.reset.success'));
      navigate({ to: '/sign-in' });
    },
  });

  if (!token) {
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
