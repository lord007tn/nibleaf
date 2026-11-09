import { Button } from '@nibleaf/design-system/components/ui/button';
import { useStandaloneT } from '@nibleaf/i18n/standalone';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { Link, useRouter } from '@tanstack/react-router';
import { useState } from 'react';

export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const t = useStandaloneT();
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  // People read a plain sentence, never an exception's (usually English, technical) text.
  // Developers get the real message below in development, and in the console.
  const detail = import.meta.env.DEV && error instanceof Error ? error.message : null;
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="font-mono text-muted-foreground text-sm">{t('error.badge')}</span>
        <h1 className="font-semibold text-2xl tracking-tight">{t('error.title')}</h1>
        <p className="max-w-sm text-muted-foreground text-sm">{t('error.unexpected')}</p>
        {detail ? <pre className="max-w-lg whitespace-pre-wrap break-all text-start text-muted-foreground text-xs">{detail}</pre> : null}
        <div className="mt-2 flex items-center gap-2">
          <Button
            loading={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await router.invalidate();
                reset();
              } finally {
                setRetrying(false);
              }
            }}
            variant="outline"
          >
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
