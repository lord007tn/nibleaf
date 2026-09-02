/** `src/components/*`: shared site chrome (search, switchers, navigation,
 * outline, theme toggle). Real components, no native selects; every visible
 * label comes from Paraglide so Arabic chrome stays Arabic. */
export const routeLinkTemplate = (): string => String.raw`import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export interface RouteLinkProps {
  route: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  'aria-current'?: 'page' | 'true';
  'aria-label'?: string;
  'data-search-result'?: boolean;
}

/** Typed navigation for content routes: "/" is the index route, everything else is the "$" splat. */
export function RouteLink({ route, ...props }: RouteLinkProps) {
  if (route === '/') return <Link to="/" {...props} />;
  return <Link params={{ _splat: route.replace(/^\/+/, '') }} to="/$" {...props} />;
}
`;

export const themeToggleTemplate = (): string => `import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as m from '../paraglide/messages.js';

const STORAGE_KEY = 'nibleaf-docs-theme';

/** Toggles the ".dark" class the inline bootstrap script in __root.tsx sets
 * before first paint; the choice persists per browser. */
export function ThemeToggle({ locale }: { locale: 'en' | 'ar' }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    document.documentElement.style.colorScheme = next ? 'dark' : 'light';
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this page.
    }
    setDark(next);
  };
  const label = dark ? m.switchToLight({}, { locale }) : m.switchToDark({}, { locale });
  return (
    <button
      aria-label={label}
      className="inline-flex size-9 items-center justify-center rounded-shell border border-border bg-surface text-muted-foreground hover:text-foreground"
      onClick={toggle}
      title={label}
      type="button"
    >
      {dark ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
    </button>
  );
}
`;

export const searchTemplate = (): string => `import { Search as SearchIcon } from 'lucide-react';
import { type KeyboardEvent, useId, useState } from 'react';
import { chromeLocale, searchPages, type SiteLanguage, type SiteVersion } from '../lib/site';
import * as m from '../paraglide/messages.js';
import { RouteLink } from './route-link';

/** Client-side search over the bundled pages of the current language/version.
 * ArrowDown moves focus to the first result, Escape clears the query. */
export function Search({ language, version }: { language: SiteLanguage; version: SiteVersion }) {
  const locale = chromeLocale(language.code);
  const [query, setQuery] = useState('');
  const id = useId();
  const results = searchPages(query, language, version);
  const open = query.trim().length > 0;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setQuery('');
      return;
    }
    if (event.key !== 'ArrowDown') return;
    const first = event.currentTarget.closest('[data-docs-search]')?.querySelector<HTMLAnchorElement>('[data-search-result]');
    if (first) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <form className="relative" data-docs-search onSubmit={(event) => event.preventDefault()} role="search">
      <label className="sr-only" htmlFor={id}>
        {m.search({}, { locale })}
      </label>
      <SearchIcon aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 my-auto text-muted-foreground" size={16} />
      <input
        aria-controls={id + '-results'}
        aria-expanded={open}
        autoComplete="off"
        className="w-full rounded-shell border border-border bg-surface py-2 pe-3 ps-9 text-sm text-foreground placeholder:text-muted-foreground"
        id={id}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={m.search({}, { locale })}
        type="search"
        value={query}
      />
      {open ? (
        <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-80 overflow-auto rounded-shell border border-border bg-surface shadow-lg" id={id + '-results'}>
          {results.length > 0 ? (
            <ul aria-label={m.searchResults({}, { locale })} className="py-1">
              {results.map((page) => (
                <li key={page.file}>
                  <RouteLink className="block px-3 py-2 text-sm hover:bg-muted focus-visible:bg-muted" data-search-result onClick={() => setQuery('')} route={page.route}>
                    <span className="block font-medium">{page.title}</span>
                    {page.description ? <span className="block text-xs text-muted-foreground">{page.description}</span> : null}
                  </RouteLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-sm text-muted-foreground" role="status">
              {m.noSearchResults({}, { locale })}
            </p>
          )}
        </div>
      ) : null}
    </form>
  );
}
`;

export const switchersTemplate =
  (): string => `import { chromeLocale, counterpartRoute, site, type SiteLanguage, type SitePage, type SiteVersion } from '../lib/site';
import * as m from '../paraglide/messages.js';
import { RouteLink } from './route-link';

interface SwitcherProps {
  language: SiteLanguage;
  page: SitePage | null;
  version: SiteVersion;
}

/** Link lists instead of native selects: crawlable for prerendering and
 * usable with a keyboard. The current item is marked with aria-current. */
export function LanguageSwitcher({ language, page, version }: SwitcherProps) {
  const enabled = site.languages.filter((item) => item.enabled !== false);
  if (enabled.length < 2) return null;
  return (
    <nav aria-label={m.language({}, { locale: chromeLocale(language.code) })} className="segmented">
      {enabled.map((item) => (
        <RouteLink aria-current={item.code === language.code ? 'true' : undefined} key={item.code} route={counterpartRoute(page, item, version)}>
          <span dir={item.direction === 'RTL' ? 'rtl' : 'ltr'} lang={item.code}>
            {item.label}
          </span>
        </RouteLink>
      ))}
    </nav>
  );
}

export function VersionSwitcher({ language, page, version }: SwitcherProps) {
  if (site.versions.length < 2) return null;
  return (
    <nav aria-label={m.version({}, { locale: chromeLocale(language.code) })} className="segmented">
      {site.versions.map((item) => (
        <RouteLink aria-current={item.slug === version.slug ? 'true' : undefined} key={item.slug} route={counterpartRoute(page, language, item)}>
          {item.name}
        </RouteLink>
      ))}
    </nav>
  );
}
`;

export const navTreeTemplate = (): string => `import type { NavItem } from '../lib/site';
import { RouteLink } from './route-link';

interface NavTreeProps {
  activeRoute: string | null;
  items: NavItem[];
  label: string;
  numbered?: boolean;
}

export function NavTree({ activeRoute, items, label, numbered = false }: NavTreeProps) {
  return (
    <nav aria-label={label}>
      <NavList activeRoute={activeRoute} depth={0} items={items} numbered={numbered} />
    </nav>
  );
}

function NavList({ activeRoute, depth, items, numbered }: { activeRoute: string | null; depth: number; items: NavItem[]; numbered: boolean }) {
  let position = 0;
  return (
    <ul className={depth > 0 ? 'ms-3 border-s border-border ps-2' : 'space-y-0.5'}>
      {items.map((item) => {
        if (item.kind === 'group') {
          return (
            <li className="mt-5 first:mt-0" key={'group:' + item.title}>
              <p className="eyebrow mb-1">{item.title}</p>
              <NavList activeRoute={activeRoute} depth={depth + 1} items={item.items} numbered={numbered} />
            </li>
          );
        }
        position += 1;
        const active = item.page.route === activeRoute;
        return (
          <li key={item.page.file}>
            <RouteLink aria-current={active ? 'page' : undefined} className={active ? 'nav-link nav-link-active' : 'nav-link'} route={item.page.route}>
              {numbered ? <span className="me-2 font-mono text-xs text-muted-foreground">{String(position).padStart(2, '0')}</span> : null}
              {item.page.title}
            </RouteLink>
          </li>
        );
      })}
    </ul>
  );
}
`;

export const tocTemplate = (): string => `import type { Heading } from '../lib/site';

export function Toc({ headings, label }: { headings: Heading[]; label: string }) {
  if (headings.length === 0) return null;
  return (
    <nav aria-label={label}>
      <p className="eyebrow">{label}</p>
      <ul className="space-y-1 text-sm">
        {headings.map((heading) => (
          <li className={heading.depth === 3 ? 'ps-3' : ''} key={heading.id}>
            <a className="block py-0.5 text-muted-foreground hover:text-foreground" href={'#' + heading.id}>
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
`;

export const mobileMenuTemplate = (): string => `import { Menu, X } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';

/** Small-screen navigation disclosure. The parent header must be positioned
 * (relative) so the panel attaches below it. */
export function MobileMenu({ children, closeLabel, label }: { children: ReactNode; closeLabel: string; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="lg:hidden">
      <button
        aria-controls={id}
        aria-expanded={open}
        className="inline-flex size-9 items-center justify-center rounded-shell border border-border bg-surface"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? <X aria-hidden="true" size={18} /> : <Menu aria-hidden="true" size={18} />}
        <span className="sr-only">{open ? closeLabel : label}</span>
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full z-30 max-h-[70vh] overflow-auto border-b border-border bg-canvas p-4 shadow-lg" id={id}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
`;

export const notFoundTemplate = (): string => `import * as m from '../paraglide/messages.js';
import { RouteLink } from './route-link';

export function NotFound({ locale, startRoute }: { locale: 'en' | 'ar'; startRoute: string }) {
  return (
    <div className="py-16 text-center">
      <p className="eyebrow">404</p>
      <h1 className="text-3xl font-bold">{m.notFoundTitle({}, { locale })}</h1>
      <p className="lede mx-auto mt-3">{m.notFoundBody({}, { locale })}</p>
      <RouteLink className="mt-6 inline-flex rounded-shell bg-accent px-4 py-2 font-semibold text-accent-foreground" route={startRoute}>
        {m.backToStart({}, { locale })}
      </RouteLink>
    </div>
  );
}
`;

export const docsPageTemplate = (): string => `import { Markdown } from '../lib/markdown';
import { chromeLocale, extractHeadings, firstPage, navFor, scopeFor, scopeForRoute, type SitePage } from '../lib/site';
import { Layout } from './layout';
import { NotFound } from './not-found';

/** One content page inside the shell selected by docs.json. */
export function DocsPage({ page }: { page: SitePage }) {
  const { language, version } = scopeFor(page.file);
  return (
    <Layout headings={extractHeadings(page.body)} language={language} nav={navFor(language, version)} page={page} version={version}>
      <Markdown body={page.body} />
    </Layout>
  );
}

export function NotFoundPage({ pathname }: { pathname: string }) {
  const { language, version } = scopeForRoute(pathname);
  return (
    <Layout headings={[]} language={language} nav={navFor(language, version)} page={null} version={version}>
      <NotFound locale={chromeLocale(language.code)} startRoute={firstPage(language, version)?.route ?? '/'} />
    </Layout>
  );
}
`;
