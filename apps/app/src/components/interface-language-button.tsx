import { Button } from '@nibleaf/design-system/components/ui/button';
import { INTERFACE_LOCALES } from '@nibleaf/i18n/locales';
import { Languages } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useAuthLocale } from '@/lib/auth-messages';

// The picker dialog (cmdk plus its dialog and focus helpers, about 17 KiB gzip)
// loads on first open instead of with every sign-in and sign-up page. Hovering
// or focusing the button starts the download early, so it is usually there by
// the click. The dashboard imports the dialog directly; it ships cmdk anyway.
const loadDialog = () => import('@/components/interface-language-dialog');
const InterfaceLanguageDialog = lazy(() => loadDialog().then((module) => ({ default: module.InterfaceLanguageDialog })));

export function InterfaceLanguageButton({ className }: { className?: string }) {
  const { locale, t } = useAuthLocale();
  const [open, setOpen] = useState(false);
  // Once opened, the dialog stays mounted, so closing animates and reopening is instant.
  const [requested, setRequested] = useState(false);
  const current = INTERFACE_LOCALES.find((option) => option.code === locale) ?? INTERFACE_LOCALES[0];
  const preload = () => {
    void loadDialog();
  };

  return (
    <>
      <Button
        className={className}
        onClick={() => {
          setRequested(true);
          setOpen(true);
        }}
        onFocus={preload}
        onPointerEnter={preload}
        size="sm"
        type="button"
        variant="outline"
        aria-label={t('account.language')}
      >
        <Languages aria-hidden className="size-4" />
        <span lang={current.code} dir={current.direction}>
          {current.native}
        </span>
      </Button>
      {requested ? (
        <Suspense fallback={null}>
          <InterfaceLanguageDialog open={open} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </>
  );
}
