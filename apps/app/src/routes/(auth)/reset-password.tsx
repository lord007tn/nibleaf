import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { AuthLayout } from '@/layouts/auth';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { minLength } from '@/lib/form';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/(auth)/reset-password')({
  component: ResetPasswordPage,
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s.token === 'string' ? s.token : '' }),
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { password: '' },
    onSubmit: async ({ value }) => {
      setError(null);
      const { error: resetError } = await authClient.resetPassword({ newPassword: value.password, token });
      if (resetError) {
        setError(resetError.message ?? 'Could not reset your password');
        return;
      }
      toast.success('Password updated — sign in with your new password');
      navigate({ to: '/sign-in' });
    },
  });

  if (!token) {
    return (
      <AuthLayout subtitle="Reset your password">
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-destructive text-sm">
          This reset link is invalid or has expired.
        </p>
        <p className="mt-5 text-center text-muted-foreground text-sm">
          <Link className="text-primary hover:underline" to="/forgot-password">
            Request a new link
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout subtitle="Choose a new password">
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
              <Label htmlFor="password">New password</Label>
              <Input
                autoComplete="new-password"
                autoFocus
                id="password"
                minLength={8}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="At least 8 characters"
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
              {isSubmitting ? 'Updating…' : 'Update password'}
            </Button>
          )}
        </form.Subscribe>
      </form>
      <p className="mt-5 text-center text-muted-foreground text-sm">
        <Link className="text-primary hover:underline" to="/sign-in">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
