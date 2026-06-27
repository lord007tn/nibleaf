import { Check } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { SettingsSection } from './section';

interface ThemeOption {
  id: 'light' | 'dark';
  label: string;
  surface: string;
  border: string;
  bars: [string, string, string];
}

const THEMES: ThemeOption[] = [
  { id: 'light', label: 'Light', surface: '#fbfbfc', border: '#ececef', bars: ['#d8d8e0', '#e6e6ec', '#e6e6ec'] },
  { id: 'dark', label: 'Dark', surface: '#131318', border: '#2a2a33', bars: ['#3a3a46', '#2c2c36', '#2c2c36'] },
];

function ThemeCard({ option, selected, onSelect }: { option: ThemeOption; selected: boolean; onSelect: () => void }) {
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
        {option.label}
        {selected ? <Check className="ms-auto size-4 text-primary" /> : null}
      </span>
    </button>
  );
}

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();

  return (
    <SettingsSection
      title="Theme"
      description="How the Plume dashboard, editor, and settings look for you. This doesn't change your published doc sites."
    >
      <div className="grid grid-cols-2 gap-4">
        {THEMES.map((option) => (
          <ThemeCard key={option.id} onSelect={() => setTheme(option.id)} option={option} selected={theme === option.id} />
        ))}
      </div>
    </SettingsSection>
  );
}
