import { type StandaloneMessageKey, translateStandalone } from '@nibleaf/i18n/standalone';
import { shellAr } from '@/components/marketing/copy/shell.ar';
import { shellEn } from '@/components/marketing/copy/shell.en';
import { MarketingSiteShell } from '@/components/marketing/site/marketing-site-shell';

/**
 * The marketing site's "page not found" (MKT-003): inside the marketing shell
 * (header, footer, and the skip link to its `<main>`), in the visitor's marketing
 * language (`/ar/…` is Arabic), with ways back: home, pricing and the docs.
 * Loaded lazily by the router's default not-found, so marketing copy never
 * ships with published docs pages.
 */
export default function MarketingNotFound({ pathname }: { pathname: string }) {
  const arabic = pathname === '/ar' || pathname.startsWith('/ar/');
  const copy = arabic ? shellAr : shellEn;
  const t = (key: StandaloneMessageKey) => translateStandalone(key, arabic ? 'ar' : 'en');
  const pricing = copy.nav.find((link) => link.href.endsWith('/pricing'));
  const docs = copy.nav.find((link) => link.external);
  const links = [
    { label: t('notFound.backHome'), href: arabic ? '/ar' : '/', external: false },
    ...(pricing ? [{ label: pricing.label, href: pricing.href, external: false }] : []),
    ...(docs ? [{ label: docs.label, href: docs.href, external: true }] : []),
  ];
  return (
    <MarketingSiteShell lang={arabic ? 'ar' : 'en'} copy={copy} alternateHref={arabic ? '/' : '/ar'}>
      {/* The shell's <main> holds this. */}
      <section aria-labelledby="not-found-title" className="mx-auto grid min-h-[60vh] max-w-2xl place-items-center px-6 py-24 text-center">
        <div className="flex flex-col items-center gap-3">
          <span className="font-mono text-muted-foreground text-sm">{t('notFound.badge')}</span>
          <h1 id="not-found-title" className="font-semibold text-3xl tracking-tight">
            {t('notFound.title')}
          </h1>
          <p className="max-w-md text-muted-foreground">{t('notFound.body')}</p>
          <ul className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {links.map((link, index) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target={link.external ? '_blank' : undefined}
                  rel={link.external ? 'noreferrer' : undefined}
                  className={
                    index === 0
                      ? 'inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm hover:opacity-90'
                      : 'inline-flex min-h-11 items-center rounded-lg border border-border px-4 font-medium text-sm hover:bg-muted'
                  }
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </MarketingSiteShell>
  );
}
