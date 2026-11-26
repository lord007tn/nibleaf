import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@nibleaf/design-system/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { INTERFACE_LOCALES, type InterfaceLocale, type Locale } from '@nibleaf/i18n/locales';
import { useAuthLocale } from '@/lib/auth-messages';

/** Two-line locale option: the language's own name (in its own script and
 * direction) over the muted English name. Shared by the picker surfaces. */
export function InterfaceLocaleLabel({ option }: { option: InterfaceLocale }) {
  return (
    <span className="min-w-0 flex-1">
      {/* Isolate the name's direction without changing the row's alignment, so
          "العربية" lines up with the other names in an LTR list (and vice versa). */}
      <span className="block truncate font-medium">
        <bdi dir={option.direction} lang={option.code}>
          {option.native}
        </bdi>
      </span>
      <span className="block truncate text-muted-foreground text-xs">{option.label}</span>
    </span>
  );
}

export function InterfaceLanguageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { locale, setLocale, t } = useAuthLocale();

  const choose = (next: Locale) => {
    setLocale(next);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-md">
        {/* End padding keeps a long title or description clear of the close button. */}
        <DialogHeader className="ps-4 pe-12 pt-4">
          <DialogTitle>{t('account.language')}</DialogTitle>
          <DialogDescription>{t('account.language.description')}</DialogDescription>
        </DialogHeader>
        {/* cmdk names its search box and list from `label`; a placeholder alone names nothing. */}
        <Command className="rounded-none bg-transparent" label={t('account.language.search')}>
          <CommandInput placeholder={t('account.language.search')} />
          <CommandList className="max-h-[min(24rem,60vh)] pb-1">
            <CommandEmpty>{t('account.language.noResults')}</CommandEmpty>
            <CommandGroup>
              {INTERFACE_LOCALES.map((option) => (
                <CommandItem
                  // The language in use is announced as checked; the item draws its own check mark from it.
                  aria-checked={option.code === locale}
                  className="min-h-11"
                  data-checked={option.code === locale}
                  key={option.code}
                  onSelect={() => choose(option.code)}
                  value={`${option.native} ${option.label} ${option.code}`}
                >
                  <InterfaceLocaleLabel option={option} />
                  <span className="font-mono text-muted-foreground text-xs" dir="ltr">
                    {option.code}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
