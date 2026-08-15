import { ConfirmProvider as DesignConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { TooltipProvider } from '@nibleaf/design-system/components/ui/tooltip';
import type { ReactNode } from 'react';
import { DirectionProvider } from '@/components/direction-provider';
import { LocaleProvider, useT } from '@/lib/i18n';

/** Dashboard and auth providers kept out of public marketing and reader chunks. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <DirectionProvider>
      <LocaleProvider>
        <LocalizedProviders>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="bottom-right" richColors />
        </LocalizedProviders>
      </LocaleProvider>
    </DirectionProvider>
  );
}

function LocalizedProviders({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <DesignConfirmProvider labels={{ cancel: t('common.cancel'), delete: t('common.delete'), save: t('common.save') }}>
      {children}
    </DesignConfirmProvider>
  );
}
