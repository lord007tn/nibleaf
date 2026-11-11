import { siteT } from '@nibleaf/i18n/site';
import { ChevronDown, Layers } from 'lucide-react';
import type { ComponentProps } from 'react';
import { headerMenusModule } from '@/components/site/header-menus-module';
import { useIntentModule } from '@/lib/intent-module';

export interface SiteVersion {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
}

/** The version a switcher shows as selected. */
export const activeSiteVersion = (versions: SiteVersion[], activeSlug: string): SiteVersion | undefined =>
  versions.find((version) => version.slug === activeSlug) ?? versions.find((version) => version.isDefault) ?? versions[0];

/** The trigger's markup, shared by the static trigger and the menu's own. */
export function versionTriggerProps(versions: SiteVersion[], activeSlug: string, lang?: string): ComponentProps<'button'> {
  const t = siteT(lang);
  const active = activeSiteVersion(versions, activeSlug);
  return {
    type: 'button',
    // Touch screens get a 44px target; fine pointers keep the compact pill.
    className:
      'flex h-11 cursor-pointer items-center gap-1.5 rounded-full border border-border/70 px-3 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground pointer-fine:h-8',
    // A bare branch name ("main") means little to most readers, so the
    // name says what it is and what is selected: "Version: main".
    'aria-label': t('versionCurrent', { version: active?.name ?? activeSlug }),
    title: t('changeVersion'),
    children: (
      <>
        <Layers className="size-3.5 shrink-0" aria-hidden />
        <span className="hidden font-normal md:inline">{t('version')}</span>
        <span className="max-w-[7rem] truncate">{active?.name ?? activeSlug}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </>
    ),
  };
}

/** Header control for switching the docs version. Renders nothing for a single
 * version; phones get the same choice in the mobile drawer instead. */
export function VersionSwitcher({
  versions,
  activeSlug,
  onChange,
  lang,
}: {
  versions: SiteVersion[];
  activeSlug: string;
  onChange: (slug: string) => void;
  lang?: string;
}) {
  const { loaded, start, trigger } = useIntentModule(headerMenusModule);
  if (versions.length < 2) {
    return null;
  }
  if (loaded) {
    return <loaded.VersionMenu versions={versions} activeSlug={activeSlug} onChange={onChange} lang={lang} start={start} />;
  }
  return (
    <button
      {...versionTriggerProps(versions, activeSlug, lang)}
      data-slot="dropdown-menu-trigger"
      aria-haspopup="menu"
      aria-expanded={false}
      {...trigger}
    />
  );
}
