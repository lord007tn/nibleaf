import { createFileRoute } from '@tanstack/react-router';
import { MarketingShell } from '@/components/marketing';
import type { MessageKey } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n';
import { canonicalHref } from '@/lib/links';

export const Route = createFileRoute('/terms')({
  head: () => ({
    meta: [{ title: 'Terms of Service — Midad' }, { name: 'description', content: 'The terms governing your use of Midad.' }],
    links: [{ rel: 'canonical', href: canonicalHref('/terms') }],
  }),
  component: TermsPage,
});

const LAST_UPDATED_ISO = '2026-06-19';

const SECTIONS: { heading: MessageKey; body: MessageKey }[] = [
  { heading: 'terms.s1.heading', body: 'terms.s1.body' },
  { heading: 'terms.s2.heading', body: 'terms.s2.body' },
  { heading: 'terms.s3.heading', body: 'terms.s3.body' },
  { heading: 'terms.s4.heading', body: 'terms.s4.body' },
  { heading: 'terms.s5.heading', body: 'terms.s5.body' },
  { heading: 'terms.s6.heading', body: 'terms.s6.body' },
];

function TermsPage() {
  const t = useT();
  const { locale } = useLocale();
  const lastUpdated = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(LAST_UPDATED_ISO));
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="font-semibold text-4xl tracking-tight">{t('terms.title')}</h1>
        <p className="mt-2 text-muted-foreground text-sm">{t('legal.lastUpdated', { date: lastUpdated })}</p>
        <div className="mt-10 space-y-8 text-muted-foreground leading-relaxed">
          {SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="font-semibold text-foreground text-xl tracking-tight">{t(section.heading)}</h2>
              <p className="mt-3">{t(section.body)}</p>
            </section>
          ))}
        </div>
      </article>
    </MarketingShell>
  );
}
