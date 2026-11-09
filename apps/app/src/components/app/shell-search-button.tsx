import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { Search } from 'lucide-react';
import { useOpenCommandPalette } from '@/components/app/command-palette';
import { useSearchShortcutLabel } from '@/lib/shortcut';

/** The same search affordance in the workspace and per-site headers. */
export function ShellSearchButton() {
  const t = useT();
  const openPalette = useOpenCommandPalette();
  const searchShortcut = useSearchShortcutLabel();
  return (
    <Button
      aria-label={t('command.dialog.title')}
      className="ms-auto h-8 shrink-0 gap-2 px-2.5 text-muted-foreground md:w-40 md:px-3 xl:w-56 pointer-coarse:h-10 pointer-coarse:min-w-10"
      onClick={() => openPalette?.()}
      size="sm"
      variant="outline"
    >
      <Search aria-hidden className="size-3.5" />
      <span aria-hidden className="hidden flex-1 text-start md:inline">
        {t('dashboard.search.placeholder')}
      </span>
      <kbd
        aria-hidden
        className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] xl:inline pointer-coarse:hidden"
        dir="ltr"
      >
        {searchShortcut}
      </kbd>
    </Button>
  );
}
