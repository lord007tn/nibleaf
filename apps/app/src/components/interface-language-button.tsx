import { Button } from '@nibleaf/design-system/components/ui/button';
import { cn } from '@nibleaf/design-system/lib/utils';
import { INTERFACE_LOCALES, type Locale } from '@nibleaf/i18n/locales';
import { Languages } from 'lucide-react';
import { type ComponentType, useEffect, useRef, useState } from 'react';
import { loadInterfaceLanguagePicker } from '@/components/interface-language-picker';
import { useAuthLocale } from '@/lib/auth-messages';

type Picker = ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void }>;

// The picker dialog (cmdk plus its dialog and focus helpers, about 17 KiB gzip)
// loads on first open instead of with every sign-in and sign-up page. Hovering
// or focusing the button starts the download early, so it is usually there by
// the click. If the download fails (offline), the button becomes a plain select
// of the same languages, which needs nothing more from the network, and takes
// focus: the page never breaks and the language can still be changed. The
// dashboard imports the dialog directly; it ships cmdk anyway.
export function InterfaceLanguageButton({ className }: { className?: string }) {
  const { locale, setLocale, t } = useAuthLocale();
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<{ Dialog: Picker } | null>(null);
  const [fallback, setFallback] = useState(false);
  // One download at a time: a click during the hover/focus preload waits for it.
  const pending = useRef<Promise<boolean> | null>(null);
  const select = useRef<HTMLSelectElement>(null);
  const current = INTERFACE_LOCALES.find((option) => option.code === locale) ?? INTERFACE_LOCALES[0];

  const load = () => {
    pending.current ??= loadInterfaceLanguagePicker().then(
      (Dialog) => {
        setPicker((loaded) => loaded ?? { Dialog });
        return true;
      },
      () => {
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
    if (picker || (await load())) setOpen(true);
    else setFallback(true);
  };

  // The button the visitor pressed is gone; keep their place on its replacement.
  useEffect(() => {
    if (fallback) select.current?.focus();
  }, [fallback]);

  if (fallback) {
    return (
      <select
        ref={select}
        aria-label={t('account.language')}
        className={cn('h-8 rounded-md border border-border bg-background px-2 text-sm', className)}
        onChange={(event) => setLocale(event.target.value as Locale)}
        value={current.code}
      >
        {INTERFACE_LOCALES.map((option) => (
          <option dir={option.direction} key={option.code} lang={option.code} value={option.code}>
            {option.native}
          </option>
        ))}
      </select>
    );
  }

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
      {picker ? <picker.Dialog open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
