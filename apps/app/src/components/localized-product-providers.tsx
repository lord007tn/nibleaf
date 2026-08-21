import { ConfirmProvider as DesignConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { TooltipProvider } from '@nibleaf/design-system/components/ui/tooltip';
import type { ReactNode } from 'react';
import { DirectionProvider } from '@/components/direction-provider';
import { type LocaleCatalogLoader, LocaleProvider, useT } from '@/lib/i18n';

export function LocalizedProductProviders({
  children,
  englishMessages,
  loadMessages,
}: {
  children: ReactNode;
  englishMessages: Record<string, string>;
  loadMessages: LocaleCatalogLoader;
}) {
  return (
    <DirectionProvider>
      <LocaleProvider englishMessages={englishMessages} loadMessages={loadMessages}>
        <LocalizedSurfaces>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="bottom-right" richColors />
        </LocalizedSurfaces>
      </LocaleProvider>
    </DirectionProvider>
  );
}

function LocalizedSurfaces({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <DesignConfirmProvider labels={{ cancel: t('common.cancel'), delete: t('common.delete'), save: t('common.save') }}>
      {children}
    </DesignConfirmProvider>
  );
}
