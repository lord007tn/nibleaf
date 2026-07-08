import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@nibleaf/design-system/components/ui/sheet';
import { Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SiteNav } from '@/components/site/site-nav';
import type { NavNode } from '@/hooks/api';

/**
 * Hamburger + slide-in drawer that exposes the full page tree below `lg`, where
 * the desktop sidebar is hidden. Without it, multi-page sites are unnavigable on
 * phones (only search + the prev/next pager survive).
 */
export function MobileNav({
  nodes,
  projectId,
  currentPath,
  lang,
  version,
  label,
  isRtl,
}: {
  nodes: NavNode[];
  projectId: string;
  currentPath: string;
  lang?: string;
  version?: string;
  label: string;
  isRtl?: boolean;
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
          <SiteNav nodes={nodes} projectId={projectId} currentPath={currentPath} lang={lang} version={version} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
