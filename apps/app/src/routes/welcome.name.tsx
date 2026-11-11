import { Button } from '@nibleaf/design-system/components/ui/button';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { AuthProviders } from '@/components/auth-providers';
import { getSessionFn } from '@/functions/session';
import { AuthLayout } from '@/layouts/auth';
import { authClient } from '@/services/auth-client';

export const Route = createFileRoute('/welcome/name')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();
    const { nameReturnPath } = await import('@/lib/name-onboarding');
    const nameDestination = nameReturnPath(search.redirect);
    if (!session) throw redirect({ to: '/sign-in', search: { next: nameDestination } });
    if (session.user.name?.trim()) throw redirect({ href: nameDestination });
    return { nameDestination };
  },
  head: () => ({ meta: [{ title: 'Welcome — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: () => (
    <AuthProviders>
      <NamePage />
    </AuthProviders>
  ),
});

function NamePage() {
  const t = useT();
  const router = useRouter();
  const { nameDestination } = Route.useRouteContext();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t('auth.name.required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.updateUser({ name: name.trim() });
      if (result.error) {
        setError(t('auth.error.tryAgain'));
        return;
      }
      await router.navigate({ href: nameDestination, replace: true });
    } catch {
      setError(t('auth.error.tryAgain'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout subtitle={t('auth.name.title')}>
      <p className="mb-4 text-muted-foreground text-sm">{t('auth.name.description')}</p>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="welcome-name">{t('auth.field.name')}</Label>
          <Input
            autoComplete="name"
            autoFocus
            id="welcome-name"
            value={name}
            aria-describedby={error ? 'welcome-name-error' : undefined}
            aria-invalid={Boolean(error)}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <FieldError id="welcome-name-error" errors={[error]} role="alert" />
        </div>
        <Button className="min-h-11" loading={busy} loadingText={t('common.saving')} type="submit">
          {t('auth.name.continue')}
        </Button>
      </form>
      <Button
        className="mt-4 min-h-11 w-full"
        variant="ghost"
        onClick={async () => {
          await authClient.signOut();
          await router.navigate({ to: '/sign-in', replace: true });
        }}
      >
        {t('account.signOut')}
      </Button>
    </AuthLayout>
  );
}
