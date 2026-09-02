import { ConfirmProvider as DesignConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { TooltipProvider } from '@nibleaf/design-system/components/ui/tooltip';
import { isRtl, synchronizeDocumentLanguageFn } from '@nibleaf/i18n';
import { useLocale, useT } from '@nibleaf/i18n/react';
import { type ReactNode, useEffect } from 'react';

export function LocalizedProductProviders({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  useEffect(() => synchronizeDocumentLanguageFn(locale), [locale]);
  return (
    <DirectionProvider direction={isRtl(locale) ? 'rtl' : 'ltr'}>
      <LocalizedSurfaces>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position={isRtl(locale) ? 'bottom-left' : 'bottom-right'} richColors />
      </LocalizedSurfaces>
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
