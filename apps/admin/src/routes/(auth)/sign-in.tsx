import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { signIn } from '@/lib/auth-client';

export const Route = createFileRoute('/(auth)/sign-in')({
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: '', password: '' },
    onSubmit: async ({ value }) => {
      setError(null);
      const { error: signInError } = await signIn.email({ email: value.email, password: value.password });
      if (signInError) {
        setError(signInError.message ?? 'Could not sign in.');
        return;
      }
      navigate({ to: '/' });
    },
  });

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </span>
          <h1 className="mt-2 font-semibold text-2xl tracking-tight">Nibleaf Admin</h1>
          <p className="text-muted-foreground text-sm">Sign in to the platform admin panel.</p>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <form.Field name="email">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  autoComplete="email"
                  autoFocus
                  id="email"
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="you@company.com"
                  type="email"
                  value={field.state.value}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="password">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  autoComplete="current-password"
                  id="password"
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Your password"
                  type="password"
                  value={field.state.value}
                />
              </div>
            )}
          </form.Field>
          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">{error}</p> : null}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button className="mt-1 w-full" disabled={isSubmitting} type="submit">
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </div>
    </main>
  );
}
