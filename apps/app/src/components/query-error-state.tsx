import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';

/** A failed request is recoverable; it must never look like an empty account. */
export function QueryErrorState({
  title,
  description,
  onRetry,
  retrying,
}: {
  title?: string;
  description?: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
      <div>
        <p className="font-medium text-sm">{title ?? t('error.title')}</p>
        <p className="mt-1 text-muted-foreground text-sm">{description ?? t('error.unexpected')}</p>
      </div>
      <Button disabled={retrying} onClick={onRetry} type="button" variant="outline">
        {retrying ? t('common.loading') : t('error.tryAgain')}
      </Button>
    </div>
  );
}
