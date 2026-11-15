import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@nibleaf/design-system/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { INTERFACE_LOCALES, type InterfaceLocale, type Locale } from '@nibleaf/i18n/locales';
import { Check } from 'lucide-react';
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
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>{t('account.language')}</DialogTitle>
          <DialogDescription>{t('account.language.description')}</DialogDescription>
        </DialogHeader>
        <Command className="rounded-none bg-transparent">
          <CommandInput placeholder={t('account.language.search')} />
          <CommandList className="max-h-[min(24rem,60vh)] pb-1">
            <CommandEmpty>{t('account.language.noResults')}</CommandEmpty>
            <CommandGroup>
              {INTERFACE_LOCALES.map((option) => (
                <CommandItem
                  key={option.code}
                  value={`${option.native} ${option.label} ${option.code}`}
                  onSelect={() => choose(option.code)}
                  className="min-h-11"
                >
                  <InterfaceLocaleLabel option={option} />
                  <span className="font-mono text-[11px] text-muted-foreground">{option.code}</span>
                  {option.code === locale ? <Check aria-hidden className="size-4 text-primary" /> : <span className="size-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
