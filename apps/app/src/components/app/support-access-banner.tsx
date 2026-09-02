import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { ADMIN_URL } from '@/lib/links';
import { authClient } from '@/services/auth-client';

export function SupportAccessBanner({ customerId, customerName }: { customerId: string; customerName?: string | null }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayName = customerName?.trim() || t('support.banner.customerFallback');

  const stop = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await authClient.admin.stopImpersonating();
      if (response.error) throw new Error(response.error.message || t('support.banner.stopError'));
      window.location.assign(`${ADMIN_URL}/users/${customerId}`);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t('support.banner.stopError'));
      setPending(false);
    }
  };

  return (
    <aside
      aria-label={t('support.banner.sessionLabel')}
      className="fixed inset-x-0 bottom-0 z-50 flex min-h-12 flex-wrap items-center justify-center gap-x-4 gap-y-2 border-warning/30 border-t bg-warning/10 px-4 py-2 text-warning shadow-[0_-8px_24px_-18px_rgba(0,0,0,0.45)]"
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <ShieldAlert className="size-4 shrink-0" />
        <span>
          <strong>{t('support.banner.active')}</strong> {t('support.banner.viewingAs', { customerName: displayName })}
        </span>
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="h-8 bg-warning text-warning-foreground hover:bg-warning/90" disabled={pending} onClick={stop} size="sm">
        {pending ? t('support.banner.stopping') : t('support.banner.stop')}
      </Button>
    </aside>
  );
}
