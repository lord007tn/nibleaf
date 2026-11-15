import { Button } from '@nibleaf/design-system/components/ui/button';
import { INTERFACE_LOCALES } from '@nibleaf/i18n/locales';
import { Languages } from 'lucide-react';
import { type ComponentType, useRef, useState } from 'react';
import { loadInterfaceLanguagePicker } from '@/components/interface-language-picker';
import { useAuthLocale } from '@/lib/auth-messages';

type Picker = ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void }>;

// The picker dialog (cmdk plus its dialog and focus helpers, about 17 KiB gzip)
// loads on first open instead of with every sign-in and sign-up page. Hovering
// or focusing the button starts the download early, so it is usually there by
// the click. A failed download (offline) never throws into the page: the form
// stays as it is, focus stays on the button and the failure is announced. The
// next press asks again, though a browser that keeps a failed module import
// failed (Chromium does, until the page reloads) won't open it before a reload.
// The dashboard imports the dialog directly; it ships cmdk anyway.
export function InterfaceLanguageButton({ className }: { className?: string }) {
  const { locale, t } = useAuthLocale();
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<{ Dialog: Picker } | null>(null);
  const [failed, setFailed] = useState(false);
  // One download at a time: a click during the hover/focus preload waits for it.
  const pending = useRef<Promise<boolean> | null>(null);
  const current = INTERFACE_LOCALES.find((option) => option.code === locale) ?? INTERFACE_LOCALES[0];

  const load = () => {
    pending.current ??= loadInterfaceLanguagePicker().then(
      (Dialog) => {
        setPicker((loaded) => loaded ?? { Dialog });
        return true;
      },
      () => {
        // Let the next press ask again.
        pending.current = null;
        return false;
      },
    );
    return pending.current;
  };
  const preload = () => {
    if (!picker) void load();
  };
  const openPicker = async () => {
    setFailed(false);
    if (picker || (await load())) setOpen(true);
    else setFailed(true);
  };

  return (
    <>
      <Button
        className={className}
        onClick={openPicker}
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
      <span className="sr-only" role="status">
        {failed ? t('auth.error.tryAgain') : ''}
      </span>
      {picker ? <picker.Dialog open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
