import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@nibleaf/design-system/components/ui/dropdown-menu';
import { Check, ChevronDown, Languages } from 'lucide-react';

export interface SiteLanguage {
  code: string;
  label: string;
  direction: 'LTR' | 'RTL';
  isDefault: boolean;
}

/**
 * Header control for switching the active site language. Renders nothing for
 * single-language sites, and a dropdown (Mintlify-style) whenever there are two
 * or more languages.
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
            <ChevronDown className="size-3.5 opacity-60" />
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
