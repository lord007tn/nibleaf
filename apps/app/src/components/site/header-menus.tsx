import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@nibleaf/design-system/components/ui/dropdown-menu';
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@nibleaf/design-system/components/ui/dropdown-menu-radio';
import { siteT } from '@nibleaf/i18n/site';
import { useEffect, useRef } from 'react';
import { languageTriggerProps, type SiteLanguage } from '@/components/site/language-switcher';
import { activeSiteVersion, type SiteVersion, versionTriggerProps } from '@/components/site/version-switcher';
import type { IntentStart } from '@/lib/intent-module';

/*
 * The header's language and version menus, loaded when a reader reaches for
 * one: until then the header renders their triggers alone (see
 * language-switcher.tsx and lib/intent-module.ts).
 */

/** The real trigger takes focus over from the static one it replaced. */
function useTakeFocus(focusTrigger: boolean) {
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusTrigger) trigger.current?.focus();
  }, [focusTrigger]);
  return trigger;
}

export function LanguageMenu({
  languages,
  activeCode,
  onChange,
  start,
}: {
  languages: SiteLanguage[];
  activeCode: string;
  onChange: (code: string) => void;
  start: IntentStart;
}) {
  const trigger = useTakeFocus(start.focusTrigger);
  return (
    <DropdownMenu defaultOpen={start.defaultOpen}>
      <DropdownMenuTrigger ref={trigger} render={<button {...languageTriggerProps(languages, activeCode)} />} />
      <DropdownMenuContent align="end" className="w-44">
        {/* A radio group: the current language is announced as checked and marked (PUB-014). */}
        <DropdownMenuRadioGroup value={activeCode} onValueChange={(code) => onChange(String(code))}>
          {languages.map((language) => (
            <DropdownMenuRadioItem key={language.code} value={language.code} className="pointer-coarse:min-h-11">
              <span className="flex-1" dir={language.direction === 'RTL' ? 'rtl' : 'ltr'} lang={language.code}>
                {language.label}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function VersionMenu({
  versions,
  activeSlug,
  onChange,
  lang,
  start,
}: {
  versions: SiteVersion[];
  activeSlug: string;
  onChange: (slug: string) => void;
  lang?: string;
  start: IntentStart;
}) {
  const trigger = useTakeFocus(start.focusTrigger);
  const t = siteT(lang);
  const active = activeSiteVersion(versions, activeSlug);
  return (
    <DropdownMenu defaultOpen={start.defaultOpen}>
      <DropdownMenuTrigger ref={trigger} render={<button {...versionTriggerProps(versions, activeSlug, lang)} />} />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup value={active?.slug} onValueChange={(slug) => onChange(String(slug))}>
          {versions.map((version) => (
            <DropdownMenuRadioItem key={version.id} value={version.slug} className="pointer-coarse:min-h-11">
              <span className="flex-1 truncate">{version.name}</span>
              {version.isDefault ? <span className="text-[10px] text-muted-foreground">{t('defaultVersion')}</span> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
