import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@nibleaf/design-system/components/ui/sheet';
import { ExternalLink, Menu } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { SiteNav } from '@/components/site/site-nav';
import type { NavNode } from '@/hooks/api';

// Language and version choices load with the open drawer, keeping the Select
// primitive out of every public page's first load (see BUNDLE_BUDGET.md).
const MobileNavSettings = lazy(() => import('./mobile-nav-settings'));

export interface MobileNavLink {
  label: string;
  href: string;
  active: boolean;
  external: boolean;
}

/** A reader setting (language, version) that the header hides on phones. */
export interface MobileNavChoice {
  id: string;
  /** Visible section label, e.g. "Language". */
  label: string;
  value: string;
  options: Array<{ value: string; label: string; lang?: string; dir?: 'ltr' | 'rtl' }>;
  onChange: (value: string) => void;
}

/**
 * Hamburger + slide-in drawer that exposes the full page tree below `lg`, where
 * the desktop sidebar is hidden. Without it, multi-page sites are unnavigable on
 * phones (only search + the prev/next pager survive). The header's section links
 * (Docs/Changelog/custom) are mirrored at the top since they're hidden below `lg`.
 * On phones the header keeps a single row, so the language and version
 * switchers move in here as labelled settings.
 */
export function MobileNav({
  nodes,
  projectId,
  currentPath,
  lang,
  version,
  label,
  triggerLabel,
  navLabel,
  closeLabel,
  toggleLabel,
  isRtl,
  links = [],
  anchors = [],
  cta,
  choices = [],
}: {
  nodes: NavNode[];
  projectId: string;
  currentPath: string;
  lang?: string;
  version?: string;
  /** Drawer title, e.g. "Menu". */
  label: string;
  /** Accessible name of the hamburger button; defaults to `label`. */
  triggerLabel?: string;
  /** Accessible name of the page tree inside the drawer. */
  navLabel?: string;
  closeLabel?: string;
  toggleLabel: string;
  isRtl?: boolean;
  links?: MobileNavLink[];
  anchors?: MobileNavLink[];
  cta?: { label: string; href: string };
  choices?: MobileNavChoice[];
}) {
  const [open, setOpen] = useState(false);
  const navigationLinks = [...links, ...anchors];
  const settings = choices.filter((choice) => choice.options.length > 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer when the route (currentPath) changes.
  useEffect(() => {
    setOpen(false);
  }, [currentPath]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label={triggerLabel ?? label}
        className="-ms-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </SheetTrigger>
      {/* Open from the reading-start edge: left in LTR, right in RTL (Arabic). */}
      <SheetContent side={isRtl ? 'right' : 'left'} className="w-80 max-w-[calc(100vw-2rem)] p-0" dir={isRtl ? 'rtl' : 'ltr'} closeLabel={closeLabel}>
        <SheetHeader className="sr-only">
          <SheetTitle>{label}</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-full">
          <div className="px-4 pt-12 pb-8">
            {settings.length > 0 ? (
              // From `sm` up the header shows these switchers itself.
              <div className="mb-4 grid gap-3 border-border/60 border-b pb-4 sm:hidden" data-mobile-nav-settings="">
                {/* The fallback reserves the settings' height so nothing jumps when they load. */}
                <Suspense fallback={<div aria-hidden style={{ blockSize: `${settings.length * 4.25}rem` }} />}>
                  <MobileNavSettings settings={settings} onChosen={() => setOpen(false)} />
                </Suspense>
              </div>
            ) : null}
            {navigationLinks.length > 0 ? (
              <ul className="mb-4 space-y-0.5 border-border/60 border-b pb-4">
                {navigationLinks.map((link) => (
                  <li key={`${link.label}-${link.href}`}>
                    <a
                      href={link.href}
                      target={link.external ? '_blank' : undefined}
                      rel={link.external ? 'noreferrer' : undefined}
                      aria-current={link.active ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                      className={`flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-2 font-medium text-sm transition-colors ${
                        link.active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {link.label}
                      {link.external ? <ExternalLink className="size-3" aria-hidden /> : null}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {cta ? (
              <a
                href={cta.href}
                data-analytics-cta
                data-analytics-placement="mobile-navbar"
                target="_blank"
                rel="noreferrer"
                className="mb-5 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90"
                onClick={() => setOpen(false)}
              >
                {cta.label}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
            <SiteNav
              nodes={nodes}
              projectId={projectId}
              currentPath={currentPath}
              lang={lang}
              version={version}
              toggleLabel={toggleLabel}
              label={navLabel}
            />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
