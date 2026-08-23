import { Button } from '@nibleaf/design-system/components/ui/button';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { ADMIN_URL } from '@/lib/links';
import { authClient } from '@/services/auth-client';

export function SupportAccessBanner({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await authClient.admin.stopImpersonating();
      if (response.error) throw new Error(response.error.message || 'Could not stop support access. Sign out if the problem continues.');
      window.location.assign(`${ADMIN_URL}/users/${customerId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not stop support access.');
      setPending(false);
    }
  };

  return (
    <aside
      aria-label="Support access session"
      className="fixed inset-x-0 bottom-0 z-50 flex min-h-12 flex-wrap items-center justify-center gap-x-4 gap-y-2 border-warning/30 border-t bg-warning/10 px-4 py-2 text-warning shadow-[0_-8px_24px_-18px_rgba(0,0,0,0.45)]"
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <ShieldAlert className="size-4 shrink-0" />
        <span>
          <strong>Support access active.</strong> Viewing Nibleaf as {customerName}. The session expires within one hour.
        </span>
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="h-8 bg-warning text-warning-foreground hover:bg-warning/90" disabled={pending} onClick={stop} size="sm">
        {pending ? 'Stopping…' : 'Stop support access'}
      </Button>
    </aside>
  );
}
