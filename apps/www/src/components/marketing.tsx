import { NibleafMark, NibleafWordmark } from '@nibleaf/design-system/brand';
import { ArrowRight, Languages, Sparkles } from 'lucide-react';
import type { ReactNode, SVGProps } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import type { MessageKey } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n';
import { appHref, GITHUB_STARS, GITHUB_URL } from '@/lib/links';

/**
 * Shared marketing chrome — the nav, footer, announcement bar, button styles and
 * section helpers reused across every page in apps/www so they stay consistent.
 * Buttons mirror the @nibleaf/design-system (shadcn) Button; colours come from the
 * tokens in styles.css.
 */
export const BTN_BASE =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4';
export const BTN_DEFAULT = 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90';
export const BTN_OUTLINE = 'border-border bg-background shadow-xs hover:bg-muted hover:text-foreground';
export const BTN_GHOST = 'hover:bg-muted hover:text-foreground';
export const SZ_SM = 'h-8 px-3 text-sm';
export const SZ_DEFAULT = 'h-9 px-4 text-sm';
export const SZ_LG = 'h-10 px-6 text-sm';
export const btn = (...parts: string[]) => `${BTN_BASE} ${parts.join(' ')}`;

export function Github(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2 0 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.4-1.3-5.4-5.9 0-1.3.5-2.4 1.2-3.2 0-.4-.5-1.6.2-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 6.6 18 7 18 7c.7 1.6.2 2.8.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.3v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}

/** Small uppercase label that sits above a section heading. */
export function Eyebrow({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-medium text-primary text-xs uppercase tracking-[0.16em]">
      <span className="h-px w-6 bg-primary/40" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Thin site-wide bar reinforcing the live Nibleaf Cloud positioning. */
export function AnnouncementBar() {
  const t = useT();
  return (
    <a
      href="/cloud"
      aria-label={t('banner.ariaLabel')}
      className="group flex items-center justify-center gap-2 border-border/70 border-b bg-muted/60 px-4 py-2 text-center text-muted-foreground text-xs transition-colors hover:text-foreground"
    >
      <Sparkles className="size-3.5 text-primary" />
      <span>{t('banner.cloud')}</span>
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        {t('banner.cloudCta')}
        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
      </span>
    </a>
  );
}

function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <button
      aria-label={t('nav.switchLanguage')}
      className={btn(BTN_OUTLINE, SZ_SM, 'text-muted-foreground')}
      onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      type="button"
    >
      <Languages className="size-4" />
      {t('nav.language')}
    </button>
  );
}

const NAV_LINKS: { href: string; label: MessageKey }[] = [
  { href: '/#features', label: 'nav.features' },
  { href: '/cloud', label: 'nav.cloud' },
  { href: '/pricing', label: 'nav.pricing' },
  { href: '/self-hosting', label: 'nav.selfHost' },
];

export function SiteNav() {
  const t = useT();
  return (
    <header className="sticky top-0 z-40 border-border/70 border-b bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-6">
        <a className="flex items-center gap-2 font-semibold text-lg tracking-tight" href="/">
          <NibleafMark className="size-8" />
          <NibleafWordmark />
        </a>
        <nav className="ms-8 hidden items-center gap-7 text-muted-foreground text-sm md:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} className="transition-colors hover:text-foreground" href={link.href}>
              {t(link.label)}
            </a>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <a
            aria-label={t('nav.github')}
            className={btn(BTN_OUTLINE, SZ_SM, 'hidden text-muted-foreground sm:inline-flex')}
            href={GITHUB_URL}
            rel="noreferrer"
            target="_blank"
          >
            <Github className="size-4" /> {t('nav.githubStars', { count: GITHUB_STARS })}
          </a>
          <LanguageToggle />
          <ThemeToggle />
          <a className={btn(BTN_GHOST, SZ_SM, 'hidden sm:inline-flex')} href={appHref()}>
            {t('nav.signIn')}
          </a>
          <a className={btn(BTN_DEFAULT, SZ_SM, 'whitespace-nowrap')} href={appHref('/sign-up')}>
            {t('nav.getStarted')}
          </a>
        </div>
      </div>
    </header>
  );
}

const FOOTER_PRODUCT: { href: string; label: MessageKey }[] = [
  { href: '/#features', label: 'nav.features' },
  { href: '/cloud', label: 'nav.cloud' },
  { href: '/pricing', label: 'nav.pricing' },
  { href: '/self-hosting', label: 'nav.selfHost' },
];
const FOOTER_RESOURCES: { href: string; label: MessageKey; external?: boolean }[] = [
  { href: '/about', label: 'about.eyebrow' },
  { href: GITHUB_URL, label: 'footer.github', external: true },
  { href: appHref(), label: 'footer.dashboard' },
];
const FOOTER_LEGAL: { href: string; label: MessageKey; external?: boolean }[] = [
  { href: '/terms', label: 'footer.terms' },
  { href: '/privacy', label: 'footer.privacy' },
  { href: `${GITHUB_URL}/blob/main/LICENSE`, label: 'footer.license', external: true },
];

export function SiteFooter() {
  const t = useT();
  return (
    <footer className="border-border border-t bg-card/30">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-14 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <div className="flex items-center gap-2">
            <NibleafMark className="size-6" />
            <NibleafWordmark className="font-medium text-foreground" />
          </div>
          <p className="mt-3 max-w-xs text-muted-foreground text-sm leading-relaxed">{t('footer.blurb')}</p>
          <p className="mt-4 flex items-center gap-1.5 text-muted-foreground text-xs">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> {t('footer.status')}
          </p>
        </div>
        <FooterCol title={t('footer.col.product')} links={FOOTER_PRODUCT} />
        <FooterCol title={t('footer.col.resources')} links={FOOTER_RESOURCES} />
        <FooterCol title={t('footer.col.legal')} links={FOOTER_LEGAL} />
      </div>
      <div className="border-border/60 border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-5 text-muted-foreground text-xs sm:flex-row">
          <span>{t('footer.copyright')}</span>
          <span className="font-mono">{t('footer.builtWith')}</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: MessageKey; external?: boolean }[] }) {
  const t = useT();
  return (
    <div>
      <p className="font-semibold text-foreground text-sm">{title}</p>
      <ul className="mt-3 space-y-2.5 text-sm">
        {links.map((link) => (
          <li key={link.href + link.label}>
            <a
              className="text-muted-foreground transition-colors hover:text-foreground"
              href={link.href}
              {...(link.external ? { rel: 'noreferrer', target: '_blank' } : {})}
            >
              {t(link.label)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Page shell: announcement bar + nav + main + footer. */
export function MarketingShell({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {t('nav.skipToContent')}
      </a>
      <AnnouncementBar />
      <SiteNav />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

/** A tidy page header (eyebrow + title + lead) for non-landing marketing pages. */
export function PageHeader({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: string }) {
  return (
    <section className="relative overflow-hidden border-border border-b">
      <div className="bg-dotgrid pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <div className="flex justify-center">
          <Eyebrow>{eyebrow}</Eyebrow>
        </div>
        <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">{title}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">{lead}</p>
      </div>
    </section>
  );
}
