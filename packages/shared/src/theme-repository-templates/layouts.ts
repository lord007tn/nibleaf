/** `src/components/layout/*`: the three Nibleaf shells rebuilt with Tailwind
 * utilities and the docs.json theme tokens. Logical utilities (ms-/pe-/start-)
 * keep every shell RTL-correct without a second stylesheet. */
export const layoutSharedTemplate = (): string => `import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { chromeLocale, type Heading, type NavItem, siblings, site, type SiteLanguage, type SitePage, type SiteVersion } from '../../lib/site';
import * as m from '../../paraglide/messages.js';
import { RouteLink } from '../route-link';
import { LanguageSwitcher, VersionSwitcher } from '../switchers';
import { ThemeToggle } from '../theme-toggle';

export interface LayoutProps {
  /** null renders the not-found state inside the shell. */
  page: SitePage | null;
  language: SiteLanguage;
  version: SiteVersion;
  nav: NavItem[];
  headings: Heading[];
  children: ReactNode;
}

export type Locale = 'en' | 'ar';
export const localeOf = (language: SiteLanguage): Locale => chromeLocale(language.code);

export function SkipLink({ locale }: { locale: Locale }) {
  return (
    <a className="skip-link" href="#content">
      {m.skipToContent({}, { locale })}
    </a>
  );
}

export function Brand({ locale }: { locale: Locale }) {
  return (
    <RouteLink className="flex items-center gap-2 font-semibold text-foreground" route="/">
      <span aria-hidden="true" className="inline-block size-6 rounded-shell bg-accent" />
      <span>{site.name}</span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">{m.themeLabel({}, { locale })}</span>
    </RouteLink>
  );
}

export function HeaderTools({ language, page, version }: Pick<LayoutProps, 'language' | 'page' | 'version'>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <LanguageSwitcher language={language} page={page} version={version} />
      <VersionSwitcher language={language} page={page} version={version} />
      <ThemeToggle locale={localeOf(language)} />
    </div>
  );
}

export function Scope({ language, version }: Pick<LayoutProps, 'language' | 'version'>) {
  return (
    <p className="eyebrow">
      {language.label} · {version.name}
    </p>
  );
}

export function PrevNext({ locale, page }: { locale: Locale; page: SitePage }) {
  const { next, previous } = siblings(page);
  if (!(next || previous)) return null;
  const card = 'flex items-center gap-3 rounded-shell border border-border p-3 text-foreground hover:border-accent';
  return (
    <nav aria-label={m.previous({}, { locale }) + ' / ' + m.next({}, { locale })} className="mt-12 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
      {previous ? (
        <RouteLink className={card} route={previous.route}>
          <ChevronLeft aria-hidden="true" className="shrink-0 rtl:-scale-x-100" size={16} />
          <span>
            <span className="block text-xs text-muted-foreground">{m.previous({}, { locale })}</span>
            <span className="font-medium">{previous.title}</span>
          </span>
        </RouteLink>
      ) : (
        <span />
      )}
      {next ? (
        <RouteLink className={card + ' sm:flex-row-reverse sm:text-end'} route={next.route}>
          <ChevronRight aria-hidden="true" className="shrink-0 rtl:-scale-x-100" size={16} />
          <span>
            <span className="block text-xs text-muted-foreground">{m.next({}, { locale })}</span>
            <span className="font-medium">{next.title}</span>
          </span>
        </RouteLink>
      ) : null}
    </nav>
  );
}

export function SiteFooter({ locale }: { locale: Locale }) {
  return (
    <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
      <a className="hover:text-foreground" href="https://nibleaf.com" rel="noreferrer">
        {m.builtWith({}, { locale })}
      </a>
    </footer>
  );
}
`;

export const harborLayoutTemplate = (): string => `import { MobileMenu } from '../mobile-menu';
import { NavTree } from '../nav-tree';
import { Search } from '../search';
import { Toc } from '../toc';
import * as m from '../../paraglide/messages.js';
import { Brand, HeaderTools, type LayoutProps, localeOf, PrevNext, Scope, SiteFooter, SkipLink } from './shared';

/** Reference shell: sticky top bar, persistent library navigation, reading column, page outline. */
export function HarborLayout({ children, headings, language, nav, page, version }: LayoutProps) {
  const locale = localeOf(language);
  const navigation = <NavTree activeRoute={page?.route ?? null} items={nav} label={m.documentation({}, { locale })} />;
  return (
    <div className="flex min-h-screen flex-col" data-shell="reference">
      <SkipLink locale={locale} />
      <header className="sticky top-0 z-30 border-b border-border bg-canvas/90 backdrop-blur">
        <div className="relative mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Brand locale={locale} />
          <div className="order-last w-full md:order-none md:ms-auto md:w-72">
            <Search language={language} version={version} />
          </div>
          <HeaderTools language={language} page={page} version={version} />
          <MobileMenu closeLabel={m.closeMenu({}, { locale })} label={m.menu({}, { locale })}>
            {navigation}
          </MobileMenu>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[16rem_minmax(0,1fr)_12rem]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-auto pe-2">{navigation}</div>
        </aside>
        <main className="min-w-0" id="content">
          {page ? (
            <>
              <header className="mb-8">
                <Scope language={language} version={version} />
                <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{page.title}</h1>
                {page.description ? <p className="lede mt-4">{page.description}</p> : null}
              </header>
              <article className="prose">{children}</article>
              <PrevNext locale={locale} page={page} />
            </>
          ) : (
            children
          )}
        </main>
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <Toc headings={headings} label={m.onThisPage({}, { locale })} />
          </div>
        </aside>
      </div>
      <SiteFooter locale={locale} />
    </div>
  );
}
`;

export const manuscriptLayoutTemplate = (): string => `import { flattenNav } from '../../lib/site';
import * as m from '../../paraglide/messages.js';
import { MobileMenu } from '../mobile-menu';
import { NavTree } from '../nav-tree';
import { RouteLink } from '../route-link';
import { Search } from '../search';
import { Toc } from '../toc';
import { Brand, HeaderTools, type LayoutProps, localeOf, PrevNext, Scope, SiteFooter, SkipLink } from './shared';

/** Editorial shell: masthead, horizontal chapter deck, paper-like reading column with margin notes. */
export function ManuscriptLayout({ children, headings, language, nav, page, version }: LayoutProps) {
  const locale = localeOf(language);
  const chapters = flattenNav(nav);
  return (
    <div className="min-h-screen" data-shell="editorial">
      <SkipLink locale={locale} />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="relative flex flex-wrap items-center justify-between gap-4 border border-border border-b-0 bg-surface px-5 py-4">
          <Brand locale={locale} />
          <div className="flex flex-wrap items-center gap-3">
            <div className="hidden w-64 md:block">
              <Search language={language} version={version} />
            </div>
            <HeaderTools language={language} page={page} version={version} />
            <MobileMenu closeLabel={m.closeMenu({}, { locale })} label={m.menu({}, { locale })}>
              <Search language={language} version={version} />
              <div className="mt-4">
                <NavTree activeRoute={page?.route ?? null} items={nav} label={m.chapters({}, { locale })} />
              </div>
            </MobileMenu>
          </div>
        </header>
        <nav aria-label={m.chapters({}, { locale })} className="hidden overflow-x-auto border border-border bg-muted lg:flex">
          <strong className="flex shrink-0 items-center px-4 text-[0.68rem] uppercase tracking-widest text-muted-foreground">{m.chapters({}, { locale })}</strong>
          {chapters.map((chapter, index) => {
            const active = chapter.route === page?.route;
            return (
              <RouteLink
                aria-current={active ? 'page' : undefined}
                className={
                  'flex min-w-44 shrink-0 items-center gap-2 border-s border-border px-4 py-3 text-sm ' +
                  (active ? 'bg-surface font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground')
                }
                key={chapter.file}
                route={chapter.route}
              >
                <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                {chapter.title}
              </RouteLink>
            );
          })}
        </nav>
        <div className="grid border border-border bg-surface shadow-xl lg:grid-cols-[12rem_minmax(0,1fr)]">
          <aside className="hidden border-e border-border p-6 lg:block">
            <div className="sticky top-6">
              <Toc headings={headings} label={m.onThisPage({}, { locale })} />
            </div>
          </aside>
          <main className="min-w-0 px-5 py-10 sm:px-10 lg:px-16" id="content">
            {page ? (
              <>
                <header className="mb-10">
                  <Scope language={language} version={version} />
                  <h1 className="font-heading text-4xl font-medium leading-none tracking-tight sm:text-6xl">{page.title}</h1>
                  {page.description ? <p className="lede mt-5 italic">{page.description}</p> : null}
                  <div aria-hidden="true" className="mt-8 h-0.5 w-20 bg-accent" />
                </header>
                <article className="prose">{children}</article>
                <PrevNext locale={locale} page={page} />
              </>
            ) : (
              children
            )}
          </main>
        </div>
        <SiteFooter locale={locale} />
      </div>
    </div>
  );
}
`;

export const signalLayoutTemplate = (): string => `import * as m from '../../paraglide/messages.js';
import { MobileMenu } from '../mobile-menu';
import { NavTree } from '../nav-tree';
import { Search } from '../search';
import { Brand, HeaderTools, type LayoutProps, localeOf, PrevNext, SiteFooter, SkipLink } from './shared';

/** Console shell: compact command bar, numbered library rail, wide canvas with an inline command index. */
export function SignalLayout({ children, headings, language, nav, page, version }: LayoutProps) {
  const locale = localeOf(language);
  const navigation = <NavTree activeRoute={page?.route ?? null} items={nav} label={m.documentation({}, { locale })} numbered />;
  const sections = headings.filter((heading) => heading.depth === 2);
  return (
    <div className="flex min-h-screen flex-col" data-shell="console">
      <SkipLink locale={locale} />
      <header className="relative border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-4 px-4 py-2">
          <Brand locale={locale} />
          <div className="order-last w-full md:order-none md:ms-auto md:w-80">
            <Search language={language} version={version} />
          </div>
          <HeaderTools language={language} page={page} version={version} />
          <MobileMenu closeLabel={m.closeMenu({}, { locale })} label={m.menu({}, { locale })}>
            {navigation}
          </MobileMenu>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-[100rem] flex-1 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden border-e border-border bg-muted/40 lg:block">
          <div className="sticky top-0 max-h-screen overflow-auto p-4">{navigation}</div>
        </aside>
        <main className="min-w-0 p-4 sm:p-6" id="content">
          {page ? (
            <>
              {sections.length > 0 ? (
                <nav aria-label={m.onThisPage({}, { locale })} className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 border border-border bg-muted px-4 py-2 font-mono text-xs">
                  <strong className="uppercase tracking-widest text-muted-foreground">{m.onThisPage({}, { locale })}</strong>
                  {sections.map((heading, index) => (
                    <a className="text-muted-foreground hover:text-foreground" href={'#' + heading.id} key={heading.id}>
                      {String(index + 1).padStart(2, '0')} {heading.text}
                    </a>
                  ))}
                </nav>
              ) : null}
              <section className="border border-border bg-surface px-5 py-8 sm:px-10 sm:py-12">
                <p className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
                  <span aria-hidden="true" className="size-2 rounded-full bg-success" />
                  {language.label} / {version.name}
                </p>
                <h1 className="mt-3 max-w-4xl text-4xl font-bold leading-none tracking-tight sm:text-6xl">{page.title}</h1>
                {page.description ? <p className="lede mt-4">{page.description}</p> : null}
                <article className="prose mt-8 max-w-4xl">{children}</article>
                <PrevNext locale={locale} page={page} />
              </section>
            </>
          ) : (
            children
          )}
        </main>
      </div>
      <SiteFooter locale={locale} />
    </div>
  );
}
`;

export const layoutIndexTemplate = (): string => `import { site } from '../../lib/site';
import { HarborLayout } from './HarborLayout';
import { ManuscriptLayout } from './ManuscriptLayout';
import { SignalLayout } from './SignalLayout';

export type { LayoutProps } from './shared';

const SHELLS = { reference: HarborLayout, editorial: ManuscriptLayout, console: SignalLayout } as const;

/** docs.json → x-nibleaf.theme.layout.shell selects the shell. Change the map to
 * use another layout (or your own) regardless of what Nibleaf regenerates. */
export const Layout = SHELLS[site.theme.layout.shell] ?? HarborLayout;
`;
