import { ConfirmProvider as DesignConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { DialogLabelsProvider } from '@nibleaf/design-system/components/ui/dialog';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { TooltipProvider } from '@nibleaf/design-system/components/ui/tooltip';
import { isRtl } from '@nibleaf/i18n/locales';
import type { ReactNode } from 'react';
import { useAuthLocale, useAuthT } from '@/lib/auth-messages';

export function LocalizedProductProviders({ children }: { children: ReactNode }) {
  // <html lang dir> follows the same locale from the root document, already in
  // the server render (lib/root-document.ts, staticData.interfaceLocale).
  const { locale } = useAuthLocale();
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
  const t = useAuthT();
  return (
    <DialogLabelsProvider close={t('deploy.close')}>
      <DesignConfirmProvider labels={{ cancel: t('common.cancel'), delete: t('common.delete'), save: t('common.save') }}>
        {children}
      </DesignConfirmProvider>
    </DialogLabelsProvider>
  );
}
