import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useTheme } from '@nibleaf/design-system/theme';
import { INTERFACE_LOCALES, type MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { Check } from 'lucide-react';
import { InterfaceLocaleLabel } from '@/components/interface-language-dialog';
import { SettingsSection } from './section';

interface ThemeOption {
  id: 'light' | 'dark';
  labelKey: MessageKey;
  surface: string;
  border: string;
  bars: [string, string, string];
}

const THEMES: ThemeOption[] = [
  {
    id: 'light',
    labelKey: 'settings.appearance.theme.light',
    surface: '#fbfbfc',
    border: '#ececef',
    bars: ['#d8d8e0', '#e6e6ec', '#e6e6ec'],
  },
  {
    id: 'dark',
    labelKey: 'settings.appearance.theme.dark',
    surface: '#131318',
    border: '#2a2a33',
    bars: ['#3a3a46', '#2c2c36', '#2c2c36'],
  },
];

// Base UI's <SelectValue /> renders the raw value ("ar") unless the root knows
// the items, so the trigger can show the language's own name instead.
const LOCALE_ITEMS = INTERFACE_LOCALES.map((option) => ({ value: option.code, label: option.native }));

function ThemeCard({ option, label, selected, onSelect }: { option: ThemeOption; label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      className={cn(
        'rounded-xl border p-3 text-start transition-colors',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-muted/40',
      )}
      onClick={onSelect}
      type="button"
    >
      <span className="block overflow-hidden rounded-lg border p-2.5" style={{ background: option.surface, borderColor: option.border }}>
        <span className="mb-1.5 block h-2 rounded" style={{ width: '38%', background: option.bars[0] }} />
        <span className="mb-1.5 block h-2 rounded" style={{ width: '70%', background: option.bars[1] }} />
        <span className="block h-2 rounded" style={{ width: '55%', background: option.bars[2] }} />
      </span>
      <span className="mt-3 flex items-center font-medium text-sm">
        {label}
        {selected ? <Check className="ms-auto size-4 text-primary" /> : null}
      </span>
    </button>
  );
}

export function AppearanceTab() {
  const { locale, setLocale, t } = useLocale();
  const { theme, setTheme } = useTheme();
  const current = INTERFACE_LOCALES.find((option) => option.code === locale) ?? INTERFACE_LOCALES[0];

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t('settings.appearance.theme.title')} description={t('settings.appearance.theme.description')}>
        <div className="grid grid-cols-2 gap-4">
          {THEMES.map((option) => (
            <ThemeCard
              key={option.id}
              label={t(option.labelKey)}
              onSelect={() => setTheme(option.id)}
              option={option}
              selected={theme === option.id}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t('account.language')} description={t('settings.appearance.language.description')}>
        <Select
          items={LOCALE_ITEMS}
          onValueChange={(value) => {
            if (value) setLocale(value);
          }}
          value={locale}
        >
          <SelectTrigger aria-label={t('account.language')} className="w-full sm:w-72">
            <SelectValue dir={current.direction} lang={current.code} />
          </SelectTrigger>
          <SelectContent>
            {INTERFACE_LOCALES.map((option) => (
              <SelectItem key={option.code} value={option.code}>
                <InterfaceLocaleLabel option={option} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsSection>
    </div>
  );
}
