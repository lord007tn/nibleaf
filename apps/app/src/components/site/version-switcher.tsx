import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@nibleaf/design-system/components/ui/dropdown-menu';
import { siteT } from '@nibleaf/i18n/site';
import { Check, ChevronDown, Layers } from 'lucide-react';

export interface SiteVersion {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
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
  const t = siteT(lang);
  if (versions.length < 2) {
    return null;
  }

  const active = versions.find((version) => version.slug === activeSlug) ?? versions.find((version) => version.isDefault) ?? versions[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            // Touch screens get a 44px target; fine pointers keep the compact pill.
            className="flex h-11 cursor-pointer items-center gap-1.5 rounded-full border border-border/70 px-3 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground pointer-fine:h-8"
            // A bare branch name ("main") means little to most readers, so the
            // name says what it is and what is selected: "Version: main".
            aria-label={t('versionCurrent', { version: active?.name ?? activeSlug })}
            title={t('changeVersion')}
          >
            <Layers className="size-3.5 shrink-0" aria-hidden />
            <span className="hidden font-normal md:inline">{t('version')}</span>
            <span className="max-w-[7rem] truncate">{active?.name ?? activeSlug}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        {versions.map((version) => (
          <DropdownMenuItem key={version.id} onClick={() => onChange(version.slug)} className="pointer-coarse:min-h-11">
            <span className="flex-1 truncate">{version.name}</span>
            {version.isDefault ? <span className="text-[10px] text-muted-foreground">{t('defaultVersion')}</span> : null}
            {version.slug === active?.slug ? <Check className="size-4" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
