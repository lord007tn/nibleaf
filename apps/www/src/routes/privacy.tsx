import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { MessageKey } from '@/lib/i18n';
import { useT } from '@/lib/i18n';

export const Route = createFileRoute('/privacy')({
  head: () => ({
    meta: [{ title: 'Privacy Policy — Plume' }, { name: 'description', content: 'How Plume handles your data.' }],
  }),
  component: PrivacyPage,
});

const LAST_UPDATED = 'June 19, 2026';

const SECTIONS: { heading: MessageKey; body: MessageKey }[] = [
  { heading: 'privacy.s1.heading', body: 'privacy.s1.body' },
  { heading: 'privacy.s2.heading', body: 'privacy.s2.body' },
  { heading: 'privacy.s3.heading', body: 'privacy.s3.body' },
  { heading: 'privacy.s4.heading', body: 'privacy.s4.body' },
  { heading: 'privacy.s5.heading', body: 'privacy.s5.body' },
  { heading: 'privacy.s6.heading', body: 'privacy.s6.body' },
];

function PrivacyPage() {
  const t = useT();
  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-3xl px-6 py-20">
        <a className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground" href="/">
          <ArrowLeft className="size-4" /> {t('legal.back')}
        </a>
        <h1 className="mt-8 font-semibold text-4xl tracking-tight">{t('privacy.title')}</h1>
        <p className="mt-2 text-muted-foreground text-sm">{t('legal.lastUpdated', { date: LAST_UPDATED })}</p>

        <div className="mt-10 space-y-8 text-muted-foreground leading-relaxed">
          {SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="font-semibold text-foreground text-xl tracking-tight">{t(section.heading)}</h2>
              <p className="mt-3">{t(section.body)}</p>
            </section>
          ))}
        </div>

        <div className="mt-12 border-border border-t pt-8">
          <a className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground" href="/">
            <ArrowLeft className="size-4" /> {t('legal.back')}
          </a>
        </div>
      </main>
    </div>
  );
}
