import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@nibleaf/design-system/components/ui/dropdown-menu';
import { Check, ChevronDown, GitBranch } from 'lucide-react';

export interface SiteVersion {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
}

export function VersionSwitcher({
  versions,
  activeSlug,
  onChange,
}: {
  versions: SiteVersion[];
  activeSlug: string;
  onChange: (slug: string) => void;
}) {
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
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
            aria-label="Change docs version"
          >
            <GitBranch className="size-3.5" />
            <span>{active?.name ?? activeSlug}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        {versions.map((version) => (
          <DropdownMenuItem key={version.id} onClick={() => onChange(version.slug)}>
            <span className="flex-1 truncate">{version.name}</span>
            {version.isDefault ? <span className="text-[10px] text-muted-foreground">Default</span> : null}
            {version.slug === active?.slug ? <Check className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
