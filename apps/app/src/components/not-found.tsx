import { Button } from '@nibleaf/design-system/components/ui/button';
import { useStandaloneT } from '@nibleaf/i18n/standalone';
import { Link } from '@tanstack/react-router';

export function NotFound() {
  const t = useStandaloneT();
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="font-mono text-muted-foreground text-sm">{t('notFound.badge')}</span>
        <h1 className="font-semibold text-2xl tracking-tight">{t('notFound.title')}</h1>
        <p className="max-w-sm text-muted-foreground text-sm">{t('notFound.body')}</p>
        <Button className="mt-2" nativeButton={false} render={<Link to="/" />}>
          {t('notFound.backHome')}
        </Button>
      </div>
    </div>
  );
}
