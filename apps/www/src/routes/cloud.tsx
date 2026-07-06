import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, Check, Cloud, Layers, Sparkles } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { useState } from 'react';
import { BTN_DEFAULT, btn, Eyebrow, MarketingShell, SZ_DEFAULT } from '@/components/marketing';
import type { MessageKey } from '@/lib/i18n';
import { useLocale, useT } from '@/lib/i18n';
import { canonicalHref } from '@/lib/links';
import { breadcrumbLd, hreflangLinks, pageMeta } from '@/lib/seo';

export const Route = createFileRoute('/cloud')({
  head: () => ({
    meta: pageMeta({
      title: 'Midad Cloud — managed hosting',
      description: 'Managed Midad is coming soon — the same platform, fully managed. Join the waitlist for launch.',
      path: '/cloud',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/cloud') }, ...hreflangLinks('/cloud')],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Cloud', path: '/cloud' },
      ]),
    ],
  }),
  component: CloudPage,
});

const FEATURES: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: MessageKey; body: MessageKey }[] = [
  { icon: Cloud, title: 'cloud.feature.managed.title', body: 'cloud.feature.managed.body' },
  { icon: Layers, title: 'cloud.feature.scale.title', body: 'cloud.feature.scale.body' },
  { icon: Sparkles, title: 'cloud.feature.same.title', body: 'cloud.feature.same.body' },
];

/**
 * Cloud waitlist — POSTs to the Midad API `POST /api/public/waitlist` (proxied
 * same-origin via Nitro; see vite.config.ts). Idempotent by email server-side.
 */
function WaitlistForm() {
  const t = useT();
  const { locale } = useLocale();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');

  if (status === 'done') {
    return (
      <p className="flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <Check className="size-4 text-primary" /> {t('cloud.form.thanks')}
      </p>
    );
  }
  return (
    <div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={async (event) => {
          event.preventDefault();
          setStatus('submitting');
          try {
            const res = await fetch('/api/public/waitlist', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email, source: 'cloud-page', locale }),
            });
            setStatus(res.ok ? 'done' : 'error');
          } catch {
            setStatus('error');
          }
        }}
      >
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('cloud.form.placeholder')}
          className="h-10 flex-1 rounded-md border border-border bg-background px-3 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <button type="submit" disabled={status === 'submitting'} className={btn(BTN_DEFAULT, SZ_DEFAULT, 'h-10')}>
          {status === 'submitting' ? t('cloud.form.submitting') : t('cloud.form.submit')}
        </button>
      </form>
      {status === 'error' ? <p className="mt-2 text-destructive text-sm">{t('cloud.form.error')}</p> : null}
    </div>
  );
}

function CloudPage() {
  const t = useT();
  return (
    <MarketingShell>
      <section className="relative overflow-hidden border-border border-b">
        <div className="bg-dotgrid pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
        <div className="mx-auto max-w-2xl px-6 py-24 text-center">
          <div className="flex justify-center">
            <Eyebrow>{t('cloud.eyebrow')}</Eyebrow>
          </div>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">{t('cloud.title')}</h1>
          <p className="mx-auto mt-4 max-w-xl text-balance text-lg text-muted-foreground leading-relaxed">{t('cloud.lead')}</p>
          <div className="mx-auto mt-8 max-w-md">
            <WaitlistForm />
            <p className="mt-2.5 text-muted-foreground text-xs">{t('cloud.form.note')}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-border bg-card p-6">
              <span className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
                <feature.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold text-lg">{t(feature.title)}</h3>
              <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{t(feature.body)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Self-host escape hatch */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="flex flex-col items-center gap-6 rounded-2xl border border-border bg-card/40 px-8 py-12 text-center sm:flex-row sm:text-start">
          <div className="flex-1">
            <h2 className="font-semibold text-2xl tracking-tight">{t('cloud.selfhost.title')}</h2>
            <p className="mt-2 text-muted-foreground leading-relaxed">{t('cloud.selfhost.body')}</p>
          </div>
          <a className={btn(BTN_DEFAULT, SZ_DEFAULT, 'group shrink-0')} href="/self-hosting">
            {t('cloud.selfhost.cta')}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180" />
          </a>
        </div>
      </section>
    </MarketingShell>
  );
}
