import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@nibleaf/design-system/components/ui/sheet';
import { cn } from '@nibleaf/design-system/lib/utils';
import { blockDirection } from '@nibleaf/shared/script-direction';
import { ExternalLink } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { type MobileNavProps, mobileNavTriggerProps } from '@/components/site/mobile-nav';
import { SiteNav } from '@/components/site/site-nav';
import type { IntentStart } from '@/lib/intent-module';

// Language and version choices load with the open drawer, keeping the Select
// primitive out of the drawer's own chunk (see BUNDLE_BUDGET.md).
const MobileNavSettings = lazy(() => import('./mobile-nav-settings'));

/**
 * The drawer behind the phone header's menu button (see mobile-nav.tsx). It
 * loads when a reader reaches for that button, and replaces the static one.
 */
export function MobileNavDrawer({
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
  start,
}: MobileNavProps & { start: IntentStart }) {
  const [open, setOpen] = useState(start.defaultOpen);
  const trigger = useRef<HTMLButtonElement>(null);
  // The real trigger takes focus over from the static one it replaced.
  useEffect(() => {
    if (start.focusTrigger) trigger.current?.focus();
  }, [start.focusTrigger]);
  const navigationLinks = [...links, ...anchors];
  const settings = choices.filter((choice) => choice.options.length > 1);
  // Close the drawer when the route changes. Not on mount: a reader who clicked
  // the menu button before this code loaded gets it open.
  const [openedPath, setOpenedPath] = useState(currentPath);
  if (openedPath !== currentPath) {
    setOpenedPath(currentPath);
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger ref={trigger} {...mobileNavTriggerProps(label, triggerLabel)} />
      {/* Open from the reading-start edge: left in LTR, right in RTL (Arabic). */}
      <SheetContent side={isRtl ? 'right' : 'left'} className="w-80 max-w-[calc(100vw-2rem)] p-0" dir={isRtl ? 'rtl' : 'ltr'} closeLabel={closeLabel}>
        <SheetHeader className="sr-only">
          <SheetTitle>{label}</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-full">
          <div className="px-4 pt-12 pb-8">
            {/* The documentation first (PUB-011): the page tree used to start halfway down a
                phone screen, under the language choice, the header links and the call to action. */}
            <SiteNav
              nodes={nodes}
              projectId={projectId}
              currentPath={currentPath}
              lang={lang}
              version={version}
              toggleLabel={toggleLabel}
              label={navLabel}
            />
            {settings.length > 0 || navigationLinks.length > 0 || cta ? (
              <div
                // Only the switchers: from `sm` up the header shows them, so the section goes too.
                className={cn('mt-6 grid gap-4 border-border/60 border-t pt-4', navigationLinks.length === 0 && !cta && 'sm:hidden')}
                data-mobile-nav-footer=""
              >
                {settings.length > 0 ? (
                  // From `sm` up the header shows these switchers itself.
                  <div className="grid gap-3 sm:hidden" data-mobile-nav-settings="">
                    {/* The fallback reserves the settings' height so nothing jumps when they load. */}
                    <Suspense fallback={<div aria-hidden style={{ blockSize: `${settings.length * 4.25}rem` }} />}>
                      <MobileNavSettings settings={settings} onChosen={() => setOpen(false)} />
                    </Suspense>
                  </div>
                ) : null}
                {navigationLinks.length > 0 ? (
                  <ul className="space-y-0.5">
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
                          <span dir={blockDirection(link.label)}>{link.label}</span>
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
                    className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90"
                    onClick={() => setOpen(false)}
                  >
                    {cta.label}
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
