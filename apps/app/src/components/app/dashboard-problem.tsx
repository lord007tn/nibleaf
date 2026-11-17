import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { AccountLayout } from '@/layouts/account';

/**
 * A dashboard page that can't be shown (an unknown or unreachable organization
 * or website) inside the app's shell (P2-DASH-026): a header with the way back
 * to the last organization, a `main` landmark, and a link to your websites,
 * instead of the bare site-wide 404 with nowhere to go.
 */
export function DashboardProblem({
  kind = 'notFound',
  retry,
}: {
  /** `error`: the page couldn't load (offers `retry`); `notFound`: it doesn't exist or isn't yours. */
  kind?: 'notFound' | 'error';
  retry?: { onRetry: () => void; retrying: boolean };
}) {
  const t = useT();
  const title = t(kind === 'notFound' ? 'notFound.title' : 'error.title');
  return (
    <AccountLayout title="Nibleaf">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 py-16 text-center" data-testid="dashboard-problem" role="alert">
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{t(kind === 'notFound' ? 'notFound.body' : 'error.unexpected')}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {retry ? (
            <Button loading={retry.retrying} onClick={retry.onRetry} variant="outline">
              {t('error.tryAgain')}
            </Button>
          ) : null}
          <Button nativeButton={false} render={<Link to="/app" />}>
            {t('nav.sites')}
          </Button>
        </div>
      </div>
    </AccountLayout>
  );
}
