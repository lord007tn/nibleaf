import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { AuthLayout } from '@/layouts/auth';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { email as validateEmail } from '@/lib/form';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/(auth)/forgot-password')({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
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
        setError(resetError.message ?? 'Could not send the reset email');
        return;
      }
      setSentTo(value.email);
    },
  });

  if (sentTo) {
    return (
      <AuthLayout subtitle="Check your email">
        <p className="text-center text-muted-foreground text-sm">
          If an account exists for <span className="font-medium text-foreground">{sentTo}</span>, we've sent a link to reset your password.
        </p>
        <p className="mt-5 text-center text-muted-foreground text-sm">
          <Link className="text-primary hover:underline" to="/sign-in">
            Back to sign in
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle="Reset your password">
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
              <Label htmlFor="email">Email</Label>
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
              {isSubmitting ? 'Sending…' : 'Send reset link'}
            </Button>
          )}
        </form.Subscribe>
      </form>
      <p className="mt-5 text-center text-muted-foreground text-sm">
        Remembered it?{' '}
        <Link className="text-primary hover:underline" to="/sign-in">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
