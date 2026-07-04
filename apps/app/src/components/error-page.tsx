import { Button } from '@midad/design-system/components/ui/button';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { translateStandalone as t } from '@/lib/i18n';

export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : t('error.unexpected');
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="font-mono text-muted-foreground text-sm">{t('error.badge')}</span>
        <h1 className="font-semibold text-2xl tracking-tight">{t('error.title')}</h1>
        <p className="max-w-sm text-muted-foreground text-sm">{message}</p>
        <div className="mt-2 flex items-center gap-2">
          <Button onClick={() => reset()} variant="outline">
            {t('error.tryAgain')}
          </Button>
          <Button nativeButton={false} render={<Link to="/" />}>
            {t('error.backHome')}
          </Button>
        </div>
      </div>
    </div>
  );
}
