import { ConfirmProvider as DesignConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { TooltipProvider } from '@nibleaf/design-system/components/ui/tooltip';
import type { ReactNode } from 'react';
import { DirectionProvider } from '@/components/direction-provider';
import { LocaleProvider, type MessageCatalogLoader, useT } from '@/lib/i18n';

export function LocalizedProductProviders({
  children,
  englishMessages,
  loadArabicMessages,
}: {
  children: ReactNode;
  englishMessages: Record<string, string>;
  loadArabicMessages: MessageCatalogLoader;
}) {
  return (
    <DirectionProvider>
      <LocaleProvider englishMessages={englishMessages} loadArabicMessages={loadArabicMessages}>
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
