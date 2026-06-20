import { Check, Languages } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export interface SiteLanguage {
  code: string;
  label: string;
  direction: 'LTR' | 'RTL';
  isDefault: boolean;
}

/**
 * Header control for switching the active site language. Renders nothing for
 * single-language sites (legacy snapshots), a compact segmented EN | العربية
 * toggle for exactly two languages, and a dropdown for three or more.
 */
export function LanguageSwitcher({
  languages,
  activeCode,
  onChange,
}: {
  languages: SiteLanguage[];
  activeCode: string;
  onChange: (code: string) => void;
}) {
  if (languages.length < 2) {
    return null;
  }

  if (languages.length === 2) {
    return (
      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
        {languages.map((language) => {
          const active = language.code === activeCode;
          return (
            <button
              key={language.code}
              type="button"
              dir={language.direction === 'RTL' ? 'rtl' : 'ltr'}
              onClick={() => onChange(language.code)}
              className={`cursor-pointer rounded-md px-2.5 py-1 font-medium text-xs transition-colors ${
                active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={active}
            >
              {language.label}
            </button>
          );
        })}
      </div>
    );
  }

  const active = languages.find((language) => language.code === activeCode);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
            aria-label="Change language"
          >
            <Languages className="size-3.5" />
            <span dir={active?.direction === 'RTL' ? 'rtl' : 'ltr'}>{active?.label ?? activeCode}</span>
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        {languages.map((language) => (
          <DropdownMenuItem key={language.code} onClick={() => onChange(language.code)}>
            <span className="flex-1" dir={language.direction === 'RTL' ? 'rtl' : 'ltr'}>
              {language.label}
            </span>
            {language.code === activeCode ? <Check className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
