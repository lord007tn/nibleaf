import { siteT } from '@nibleaf/i18n/site';
import { ChevronDown, Languages } from 'lucide-react';
import type { ComponentProps } from 'react';
import { headerMenusModule } from '@/components/site/header-menus-module';
import { useIntentModule } from '@/lib/intent-module';

export interface SiteLanguage {
  code: string;
  label: string;
  direction: 'LTR' | 'RTL';
  isDefault: boolean;
}

/** The trigger's markup, shared by the static trigger and the menu's own. */
export function languageTriggerProps(languages: SiteLanguage[], activeCode: string): ComponentProps<'button'> {
  const active = languages.find((language) => language.code === activeCode);
  const t = siteT(active?.code);
  return {
    type: 'button',
    // The min width keeps the header from shifting when the label changes
    // script ("English" ↔ "العربية"); the chevron stays pinned at the end.
    // Touch screens get a 44px target; fine pointers keep the compact pill.
    className:
      'flex h-11 min-w-[7.5rem] cursor-pointer items-center gap-1.5 rounded-full border border-border/70 px-3 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground pointer-fine:h-8',
    // The name carries the current value, so a screen reader hears "Language: English".
    'aria-label': t('languageCurrent', { language: active?.label ?? activeCode }),
    title: t('changeLanguage'),
    children: (
      <>
        <Languages className="size-3.5 shrink-0" aria-hidden />
        <span className="max-w-[7rem] truncate" dir={active?.direction === 'RTL' ? 'rtl' : 'ltr'} lang={active?.code}>
          {active?.label ?? activeCode}
        </span>
        <ChevronDown className="ms-auto size-3.5 shrink-0 opacity-60" aria-hidden />
      </>
    ),
  };
}

/**
 * Header control for switching the active site language. Renders nothing for
 * single-language sites, and a dropdown (Mintlify-style) whenever there are two
 * or more languages. Phones get the same choice in the mobile drawer instead.
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
  const { loaded, start, trigger } = useIntentModule(headerMenusModule);
  if (languages.length < 2) {
    return null;
  }
  if (loaded) {
    return <loaded.LanguageMenu languages={languages} activeCode={activeCode} onChange={onChange} start={start} />;
  }
  return (
    <button
      {...languageTriggerProps(languages, activeCode)}
      data-slot="dropdown-menu-trigger"
      aria-haspopup="menu"
      aria-expanded={false}
      {...trigger}
    />
  );
}
