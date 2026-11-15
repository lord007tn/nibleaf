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
// the click. If the download fails (offline), the button becomes a plain native
// disclosure listing the same languages, which needs nothing more from the
// network, and takes focus: the page never breaks and the language can still be
// changed. (Not a native select: the app uses the shared Select, and that would
// load with every auth page.) The
// dashboard imports the dialog directly; it ships cmdk anyway.
export function InterfaceLanguageButton({ className }: { className?: string }) {
  const { locale, setLocale, t } = useAuthLocale();
  const [open, setOpen] = useState(false);
  const [picker, setPicker] = useState<{ Dialog: Picker } | null>(null);
  const [fallback, setFallback] = useState(false);
  // One download at a time: a click during the hover/focus preload waits for it.
  const pending = useRef<Promise<boolean> | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
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
    if (fallback) summary.current?.focus();
  }, [fallback]);

  if (fallback) {
    return (
      <details className={cn('relative', className)} open ref={details}>
        <summary
          aria-label={t('account.language')}
          className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-background px-2.5 font-medium text-sm pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden"
          ref={summary}
        >
          <Languages aria-hidden className="size-4" />
          <span lang={current.code} dir={current.direction}>
            {current.native}
          </span>
        </summary>
        <ul className="absolute end-0 top-full z-50 mt-1 max-h-[60vh] w-48 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          {INTERFACE_LOCALES.map((option) => (
            <li key={option.code}>
              <button
                aria-current={option.code === locale ? 'true' : undefined}
                className="flex min-h-9 w-full items-center rounded-sm px-2 text-start text-sm hover:bg-accent focus-visible:bg-accent pointer-coarse:min-h-11"
                onClick={() => {
                  setLocale(option.code as Locale);
                  details.current?.removeAttribute('open');
                  summary.current?.focus();
                }}
                type="button"
              >
                {/* Isolate the name's direction without moving the row, so the list
                    lines up in either page direction (as the picker does). */}
                <bdi dir={option.direction} lang={option.code}>
                  {option.native}
                </bdi>
              </button>
            </li>
          ))}
        </ul>
      </details>
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
