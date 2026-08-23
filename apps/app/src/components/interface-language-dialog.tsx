import { Button } from '@nibleaf/design-system/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@nibleaf/design-system/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { INTERFACE_LOCALES, type Locale } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { Check, Languages } from 'lucide-react';
import { useState } from 'react';

export function InterfaceLanguageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { locale, setLocale, t } = useLocale();

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
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" lang={option.code} dir={option.direction}>
                      {option.native}
                    </span>
                    <span className="block truncate text-muted-foreground text-xs">{option.label}</span>
                  </span>
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

export function InterfaceLanguageButton({ className }: { className?: string }) {
  const { locale, t } = useLocale();
  const [open, setOpen] = useState(false);
  const current = INTERFACE_LOCALES.find((option) => option.code === locale) ?? INTERFACE_LOCALES[0];

  return (
    <>
      <Button className={className} onClick={() => setOpen(true)} size="sm" type="button" variant="outline" aria-label={t('account.language')}>
        <Languages aria-hidden className="size-4" />
        <span lang={current.code} dir={current.direction}>
          {current.native}
        </span>
      </Button>
      <InterfaceLanguageDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
