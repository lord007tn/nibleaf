import { Button } from '@nibleaf/design-system/components/ui/button';
import { useTheme } from '@nibleaf/design-system/theme';
import { useT } from '@nibleaf/i18n/react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

/** Cycles system → light → dark → system. Icon reflects the raw choice. */
export function ThemeToggle() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  // The raw theme is only known after hydration; keep a stable label/icon until then.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const nextLabel =
    next === 'light' ? t('settings.styling.theme.light') : next === 'dark' ? t('settings.styling.theme.dark') : t('settings.styling.theme.system');
  const Icon = !mounted || theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon;

  return (
    <Button
      size="icon-sm"
      variant="outline"
      aria-label={mounted ? t('admin.theme.switch', { theme: nextLabel }) : t('site.toggleTheme')}
      className="text-muted-foreground"
      onClick={() => setTheme(next)}
      type="button"
    >
      <Icon className="size-4" />
    </Button>
  );
}
