import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@nibleaf/design-system/components/ui/sheet';
import { ExternalLink, Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SiteNav } from '@/components/site/site-nav';
import type { NavNode } from '@/hooks/api';

export interface MobileNavLink {
  label: string;
  href: string;
  active: boolean;
  external: boolean;
}

/**
 * Hamburger + slide-in drawer that exposes the full page tree below `lg`, where
 * the desktop sidebar is hidden. Without it, multi-page sites are unnavigable on
 * phones (only search + the prev/next pager survive). The header's section links
 * (Docs/Changelog/custom) are mirrored at the top since they're hidden below `md`.
 */
export function MobileNav({
  nodes,
  projectId,
  currentPath,
  lang,
  version,
  label,
  isRtl,
  links = [],
}: {
  nodes: NavNode[];
  projectId: string;
  currentPath: string;
  lang?: string;
  version?: string;
  label: string;
  isRtl?: boolean;
  links?: MobileNavLink[];
}) {
  const [open, setOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer when the route (currentPath) changes.
  useEffect(() => {
    setOpen(false);
  }, [currentPath]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label={label}
        className="-ms-1 inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
      >
        <Menu className="size-5" />
      </SheetTrigger>
      {/* Open from the reading-start edge: left in LTR, right in RTL (Arabic). */}
      <SheetContent side={isRtl ? 'right' : 'left'} className="w-80 p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>{label}</SheetTitle>
        </SheetHeader>
        <div className="h-full overflow-y-auto px-4 pt-12 pb-8">
          {links.length > 0 ? (
            <ul className="mb-4 space-y-0.5 border-border/60 border-b pb-4">
              {links.map((link) => (
                <li key={`${link.label}-${link.href}`}>
                  <a
                    href={link.href}
                    target={link.external ? '_blank' : undefined}
                    rel={link.external ? 'noreferrer' : undefined}
                    aria-current={link.active ? 'page' : undefined}
                    className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium text-sm transition-colors ${
                      link.active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {link.label}
                    {link.external ? <ExternalLink className="size-3" /> : null}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          <SiteNav nodes={nodes} projectId={projectId} currentPath={currentPath} lang={lang} version={version} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
