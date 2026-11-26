import { Button } from '@nibleaf/design-system/components/ui/button';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@nibleaf/design-system/components/ui/sheet';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useTheme } from '@nibleaf/design-system/theme';
import type { MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { Eye } from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { type SectionScope, SectionScopeProvider } from '@/components/project-settings/shared';
import { BannerSettings } from '@/features/site-banner/components/banner-settings';
import { BrandingSettings } from '@/features/site-branding/components/branding-settings';
import { FooterSettings } from '@/features/site-footer/components/footer-settings';
import { NavbarSettings } from '@/features/site-navbar/components/navbar-settings';
import type { AppearanceSectionId as AppearanceGroupId, AppearanceLink } from '@/features/site-settings/model/ids';
import { StylingSettings } from '@/features/site-styling/components/styling-settings';
import { LivePreview } from '@/features/site-theme/components/live-preview';
import { ThemeSettings } from '@/features/site-theme/components/theme-settings';
import { TypographySettings } from '@/features/site-typography/components/typography-settings';
import type { Project } from '@/hooks/api';
import { SaveRegionProvider } from '@/lib/forms/save-region';
import { appearancePart } from '../model/parts';
import { previewWithDrafts } from '../model/preview-config';
import { AppearanceDraftsProvider, useAppearanceDrafts } from './preview-drafts';

/** The id of a part's element, for the page's anchors and old links. */
const appearanceAnchor = (id: AppearanceGroupId) => `appearance-${id}`;

/** Where the page renders: Settings → Appearance, or the editor's Configuration tab. */
export type AppearanceHost = 'settings' | 'editor';

const GROUPS: ReadonlyArray<{ id: AppearanceGroupId; label: MessageKey }> = [
  { id: 'brand', label: 'settings.branding.title' },
  { id: 'theme', label: 'settings.appearance.group.theme' },
  { id: 'typography', label: 'settings.typography.title' },
  { id: 'chrome', label: 'settings.appearance.group.chrome' },
];

/**
 * Appearance as one page (operations/ui-overhaul.md §5.7, B5): Brand, Theme
 * (accent colour, corners and the theme), Typography, and the header, footer
 * and banner, as headings on one page instead of seven tabs. Every form keeps
 * its own draft, and all of them share the page's one save bar and leave guard.
 *
 * One live preview shows every unsaved change together (colour, corners,
 * theme, fonts) before Save: beside the forms where the page is wide enough,
 * otherwise behind a Preview button. The same page renders in the editor's
 * Configuration tab, with plain panels.
 */
export function AppearancePage({ project, host, initialGroup }: { project: Project; host: AppearanceHost; initialGroup?: AppearanceLink }) {
  const { t } = useLocale();
  const plain = host === 'editor';
  const chrome: SectionScope['chrome'] = plain ? 'plain' : 'panel';
  const rootRef = useRef<HTMLDivElement>(null);

  // An old link to one of the former tabs (`appearanceSection=navbar`) opens the page at that section,
  // after the route has focused the page heading (its effect runs after this one).
  useEffect(() => {
    if (!initialGroup) return;
    const frame = requestAnimationFrame(() =>
      rootRef.current?.querySelector(`#${appearanceAnchor(appearancePart(initialGroup))}`)?.scrollIntoView({ block: 'start' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [initialGroup]);

  /**
   * "On this page" jumps within the page without changing the URL: a hash
   * navigation would go through the route's unsaved-changes guard. Focus moves
   * to the part's heading, so keyboard and screen reader users land there too.
   */
  const jumpTo = (id: AppearanceGroupId) => (event: MouseEvent<HTMLAnchorElement>) => {
    const part = rootRef.current?.querySelector<HTMLElement>(`#${appearanceAnchor(id)}`);
    if (!part) return;
    event.preventDefault();
    part.scrollIntoView({ block: 'start' });
    const heading = part.querySelector<HTMLElement>('h2');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  };

  return (
    <AppearanceDraftsProvider>
      <SaveRegionProvider>
        <div className="@container/appearance flex min-w-0 flex-col gap-8" data-appearance-host={host} ref={rootRef}>
          <PageHeader description={t('settings.appearance.summary')} title={t('settings.tab.appearance')} />
          {/* Below the two-column width the page is long (eight screens on a phone): the parts and the
              preview stay one tap away while scrolling, in a bar that sticks under the dashboard header. */}
          <div
            className={cn(
              'sticky z-10 -mt-4 flex min-w-0 items-center gap-2 rounded-b-xl border border-border border-t-0 bg-background/95 p-1.5 shadow-sm backdrop-blur @3xl/appearance:hidden',
              // Flush under the header, so nothing scrolls into a gap above it.
              plain ? 'top-0' : 'top-12',
            )}
            data-appearance-jump=""
          >
            <nav aria-label={t('settings.appearance.sections')} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
              <ul className="flex w-max gap-1">
                {GROUPS.map((group) => (
                  <li key={group.id}>
                    <a
                      className="inline-flex h-9 items-center whitespace-nowrap rounded-lg px-3 text-muted-foreground text-sm outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-11"
                      href={`#${appearanceAnchor(group.id)}`}
                      onClick={jumpTo(group.id)}
                    >
                      {t(group.label)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <PreviewSheet className="shrink-0" config={project.config} />
          </div>
          <div className="grid min-w-0 gap-8 @3xl/appearance:grid-cols-[minmax(0,1fr)_20rem] @5xl/appearance:grid-cols-[minmax(0,1fr)_24rem] @6xl/appearance:grid-cols-[minmax(0,1fr)_28rem]">
            <div className="flex min-w-0 max-w-[47.5rem] flex-col gap-10">
              <Group id="brand">
                <SectionScopeProvider value={{ headingLevel: 2, chrome }}>
                  <BrandingSettings project={project} />
                </SectionScopeProvider>
              </Group>
              <Group description={t('settings.appearance.group.themeHint')} id="theme" title={t('settings.appearance.group.theme')}>
                <SectionScopeProvider value={{ headingLevel: 3, chrome }}>
                  <StylingSettings project={project} />
                  <ThemeSettings project={project} />
                </SectionScopeProvider>
              </Group>
              <Group id="typography">
                <SectionScopeProvider value={{ headingLevel: 2, chrome }}>
                  <TypographySettings project={project} />
                </SectionScopeProvider>
              </Group>
              <Group description={t('settings.appearance.group.chromeHint')} id="chrome" title={t('settings.appearance.group.chrome')}>
                <SectionScopeProvider value={{ headingLevel: 3, chrome }}>
                  <NavbarSettings project={project} />
                  <FooterSettings project={project} />
                  <BannerSettings project={project} />
                </SectionScopeProvider>
              </Group>
            </div>
            <aside aria-label={t('settings.appearance.preview.title')} className="hidden min-w-0 @3xl/appearance:block">
              {/* Sticks below the dashboard's 3rem header on the settings page; the editor's canvas scrolls on its own. */}
              <div
                className={cn(
                  'sticky flex flex-col gap-6 overflow-y-auto overscroll-contain',
                  plain ? 'top-4 max-h-[calc(100dvh-2rem)]' : 'top-16 max-h-[calc(100dvh-5rem)]',
                )}
              >
                <nav aria-label={t('settings.appearance.sections')}>
                  <p className="mb-2 font-medium text-muted-foreground text-xs">{t('settings.appearance.onThisPage')}</p>
                  <ul className="flex flex-col gap-0.5 border-border border-s">
                    {GROUPS.map((group) => (
                      <li key={group.id}>
                        <a
                          className="-ms-px block border-transparent border-s-2 py-1 ps-3 text-muted-foreground text-sm outline-none hover:border-border hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                          href={`#${appearanceAnchor(group.id)}`}
                          onClick={jumpTo(group.id)}
                        >
                          {t(group.label)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
                <PreviewPanel config={project.config} />
              </div>
            </aside>
          </div>
        </div>
      </SaveRegionProvider>
    </AppearanceDraftsProvider>
  );
}

/** One of the page's four parts. Brand and Typography are a single section whose own heading is the part's; the other two group several. */
function Group({ id, title, description, children }: { id: AppearanceGroupId; title?: string; description?: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={title ? `${appearanceAnchor(id)}-title` : undefined}
      className="flex min-w-0 scroll-mt-32 flex-col gap-6 @3xl/appearance:scroll-mt-16"
      id={appearanceAnchor(id)}
    >
      {title ? (
        <div className="border-border border-b pb-3">
          <h2 className="font-semibold text-base" id={`${appearanceAnchor(id)}-title`}>
            {title}
          </h2>
          {description ? <p className="mt-1 text-muted-foreground text-sm">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** The preview with every unsaved change on the page applied. */
function PreviewPanel({ config }: { config: Project['config'] }) {
  const { t, locale } = useLocale();
  const { resolvedTheme } = useTheme();
  const drafts = useAppearanceDrafts();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div>
        <h2 className="font-semibold text-sm">{t('settings.appearance.preview.title')}</h2>
        <p className="mt-0.5 text-muted-foreground text-xs">{t('settings.appearance.preview.hint')}</p>
      </div>
      <LivePreview config={previewWithDrafts(config, drafts)} dashboardArabic={locale === 'ar'} dashboardMode={resolvedTheme} />
    </div>
  );
}

/** Below the two-column width: a Preview button that opens the same live preview in a sheet. */
function PreviewSheet({ config, className }: { config: Project['config']; className?: string }) {
  const { t, locale } = useLocale();
  const { resolvedTheme } = useTheme();
  const drafts = useAppearanceDrafts();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className={className} onClick={() => setOpen(true)} type="button" variant="outline">
        <Eye aria-hidden className="size-4" />
        {t('project.preview')}
      </Button>
      <Sheet onOpenChange={setOpen} open={open}>
        <SheetContent className="max-h-[90dvh] gap-0 overflow-y-auto data-[side=bottom]:rounded-t-xl" side="bottom">
          <SheetHeader className="pe-12">
            <SheetTitle>{t('settings.appearance.preview.title')}</SheetTitle>
            <SheetDescription>{t('settings.appearance.preview.hint')}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {open ? <LivePreview config={previewWithDrafts(config, drafts)} dashboardArabic={locale === 'ar'} dashboardMode={resolvedTheme} /> : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
