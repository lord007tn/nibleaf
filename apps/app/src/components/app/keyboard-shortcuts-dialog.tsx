import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { useT } from '@nibleaf/i18n/react';
import { useSearchShortcutLabel } from '@/lib/shortcut';

/** The dashboard's keyboard shortcuts, as the app actually binds them. */
export function KeyboardShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const search = useSearchShortcutLabel();
  const rows = [
    { keys: [search], label: t('shortcuts.commandPalette') },
    { keys: ['G', 'O'], label: t('shortcuts.switchOrganization') },
    { keys: ['G', 'W'], label: t('shortcuts.switchWebsite') },
    { keys: ['Esc'], label: t('shortcuts.close') },
  ];
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <div className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm" key={row.label}>
              <dt>{row.label}</dt>
              <dd className="flex shrink-0 items-center gap-1" dir="ltr">
                {row.keys.map((key, index) => (
                  <span className="flex items-center gap-1" key={key}>
                    {index > 0 ? <span className="text-muted-foreground text-xs">{t('shortcuts.then')}</span> : null}
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">{key}</kbd>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
