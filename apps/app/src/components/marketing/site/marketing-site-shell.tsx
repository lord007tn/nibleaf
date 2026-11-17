import { NibleafMark, NibleafWordmark } from '@nibleaf/design-system/brand';
import { useTheme } from '@nibleaf/design-system/theme';
import { Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { GITHUB_URL } from '@/lib/links';
import { MARKETING_BUILD } from '@/lib/marketing-build';
import type { MarketingLang, ShellCopy } from '../copy/types';
import { MobileNavigation } from '../mobile-navigation';
import { PrivacyChoices } from '../privacy-choices';
import { GitHubStarLink } from './github-star-link';
import { MarketingLink } from './marketing-link';
import { primaryButton } from './primitives';

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function ThemeToggle({ copy }: { copy: ShellCopy['theme'] }) {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  // One toggle pattern across Nibleaf's public sites (P3-MKT-009): a constant
  // name, pressed while dark, as the docs reader's toggle; the tooltip says
  // what a click does.
  return (
    <button
      type="button"
      aria-label={copy.darkMode}
      aria-pressed={dark}
      title={dark ? copy.toLight : copy.toDark}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className={`grid size-11 shrink-0 place-items-center rounded-md border border-border bg-background hover:bg-muted ${focus}`}
    >
      {dark ? <Sun aria-hidden="true" className="size-4" /> : <Moon aria-hidden="true" className="size-4" />}
    </button>
  );
}

function LanguageSwitch({ copy, href }: { copy: ShellCopy['languageSwitch']; href: string }) {
  return (
    <a
      href={href}
      hrefLang={copy.hrefLang}
      lang={copy.hrefLang}
      aria-label={`${copy.label} — ${copy.ariaLabel}`}
      className={`inline-flex min-h-11 items-center rounded-md px-2 text-sm hover:bg-muted ${focus}`}
    >
      {copy.label}
    </a>
  );
}

export function MarketingSiteShell({
  lang,
  copy,
  alternateHref,
  stars = 0,
  children,
}: {
  lang: MarketingLang;
  copy: ShellCopy;
  alternateHref: string;
  stars?: number;
  children: ReactNode;
}) {
  return (
    <div
      lang={lang}
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-screen bg-background text-start text-foreground [overflow-wrap:break-word] [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-ring [&_a]:focus-visible:outline-offset-4"
    >
      <a href="#main" className="sr-only z-50 rounded-md bg-background p-4 focus:not-sr-only focus:fixed focus:start-4 focus:top-4">
        {copy.skipToContent}
      </a>
      <header className="sticky top-0 z-40 border-border/70 border-b bg-background/95 supports-[backdrop-filter]:bg-background/85 supports-[backdrop-filter]:backdrop-blur-lg">
        <div className="mx-auto flex min-h-20 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <a href={lang === 'ar' ? '/ar' : '/'} aria-label={copy.homeLabel} className="flex min-h-11 shrink-0 items-center gap-2">
            <NibleafMark aria-hidden="true" className="size-8" />
            {/* Sized by its text: a fixed-width box left a gap beside the mark in RTL (P3-MKT-008). */}
            <NibleafWordmark aria-hidden="true" />
          </a>
          <nav aria-label={copy.primaryNavLabel} className="ms-2 hidden items-center gap-3 text-muted-foreground text-sm lg:flex xl:ms-6 xl:gap-5">
            {copy.nav.slice(0, 5).map((link) => (
              <a key={link.href} href={link.href} className="inline-flex min-h-11 items-center hover:text-foreground">
                {link.label}
              </a>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <div className="hidden items-center gap-1 lg:flex">
              <LanguageSwitch copy={copy.languageSwitch} href={alternateHref} />
              <ThemeToggle copy={copy.theme} />
            </div>
            <GitHubStarLink stars={stars} label={copy.github.label} starsLabel={copy.github.starsLabel} compact className="hidden 2xl:inline-flex" />
            <a href={copy.login.href} className="hidden min-h-11 items-center rounded-md px-2 text-sm hover:bg-muted lg:inline-flex">
              {copy.login.label}
            </a>
            <MarketingLink cta={copy.start} lang={lang} placement="header" className={`${primaryButton} px-3`} />
            <MobileNavigation
              language={lang}
              labels={copy.menu}
              navLabel={copy.primaryNavLabel}
              className="lg:hidden"
              links={[...copy.nav.slice(0, 5), copy.login]}
            >
              <div className="flex flex-wrap items-center gap-3 border-border border-t pt-4">
                <LanguageSwitch copy={copy.languageSwitch} href={alternateHref} />
                <ThemeToggle copy={copy.theme} />
                <GitHubStarLink stars={stars} label={copy.github.label} starsLabel={copy.github.starsLabel} compact />
              </div>
            </MobileNavigation>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="border-border border-t bg-card/40">
        <div className="mx-auto max-w-7xl px-5 sm:px-6">
          <div className="grid gap-5 border-border border-b py-12 md:grid-cols-[1fr_1.2fr] md:items-center md:gap-12">
            <div>
              <p className="font-medium text-primary text-sm">{copy.footer.openSource.badge}</p>
              <h2 className="mt-3 font-semibold text-2xl leading-relaxed">{copy.footer.openSource.heading}</h2>
            </div>
            <p className="max-w-[72ch] text-muted-foreground leading-7">{copy.footer.openSource.body}</p>
          </div>
          <div className="grid gap-10 py-12 lg:grid-cols-[1.2fr_3fr]">
            <div>
              <a href={lang === 'ar' ? '/ar' : '/'} aria-label={copy.homeLabel} className="inline-flex min-h-11 items-center gap-2">
                <NibleafMark aria-hidden="true" className="size-7" />
                <NibleafWordmark aria-hidden="true" />
              </a>
              <p className="mt-4 max-w-xs text-muted-foreground text-sm leading-7">{copy.footer.tagline}</p>
            </div>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              {copy.footer.columns.map((column) => (
                <div key={column.title}>
                  <h3 className="font-semibold text-sm">{column.title}</h3>
                  <ul className="mt-3">
                    {column.links.map((link) => (
                      <li key={link.href}>
                        <a className="inline-flex min-h-11 items-center py-2 text-muted-foreground text-sm hover:text-foreground" href={link.href}>
                          {link.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-border border-t py-6 text-muted-foreground text-xs leading-7">
            <p>{copy.footer.legalLine(MARKETING_BUILD.year)}</p>
            <div className="flex flex-wrap items-center gap-x-5 [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center [&>button]:min-h-11">
              <a href={`${GITHUB_URL}/blob/main/LICENSE`}>{copy.footer.licenseLabel}</a>
              <a href={GITHUB_URL}>{copy.footer.sourceLabel}</a>
              <PrivacyChoices language={lang} />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
