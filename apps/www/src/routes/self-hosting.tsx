import { createFileRoute } from '@tanstack/react-router';
import { ArrowRight, Boxes, Check, Database, HardDrive, Rocket, Server, Zap } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { BTN_DEFAULT, btn, Eyebrow, Github, ICON_TILE, MarketingShell, PageHeader, SZ_LG } from '@/components/marketing';
import type { MessageKey } from '@/lib/i18n';
import { useT } from '@/lib/i18n';
import { canonicalHref, GITHUB_URL } from '@/lib/links';
import { breadcrumbLd, hreflangLinks, pageMeta } from '@/lib/seo';

export const Route = createFileRoute('/self-hosting')({
  head: () => ({
    meta: pageMeta({
      title: 'Self-hosting — Nibleaf',
      description:
        'Run the entire Nibleaf stack on your own infrastructure with one Docker command. Your content and your users’ data never leave your servers.',
      path: '/self-hosting',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/self-hosting') }, ...hreflangLinks('/self-hosting')],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'Self-hosting', path: '/self-hosting' },
      ]),
    ],
  }),
  component: SelfHostingPage,
});

const REQUIREMENTS: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: MessageKey; body: MessageKey }[] = [
  { icon: Boxes, title: 'selfhost.req.docker.title', body: 'selfhost.req.docker.body' },
  { icon: Database, title: 'selfhost.req.db.title', body: 'selfhost.req.db.body' },
  { icon: Zap, title: 'selfhost.req.cache.title', body: 'selfhost.req.cache.body' },
  { icon: HardDrive, title: 'selfhost.req.storage.title', body: 'selfhost.req.storage.body' },
];

const STEPS: { title: MessageKey; body: MessageKey }[] = [
  { title: 'selfhost.step.clone.title', body: 'selfhost.step.clone.body' },
  { title: 'selfhost.step.env.title', body: 'selfhost.step.env.body' },
  { title: 'selfhost.step.up.title', body: 'selfhost.step.up.body' },
  { title: 'selfhost.step.account.title', body: 'selfhost.step.account.body' },
];

const GET: MessageKey[] = ['selfhost.get.b1', 'selfhost.get.b2', 'selfhost.get.b3', 'selfhost.get.b4'];

const DEPLOY: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: MessageKey; body: MessageKey }[] = [
  { icon: Boxes, title: 'selfhost.deploy.compose.title', body: 'selfhost.deploy.compose.body' },
  { icon: Rocket, title: 'selfhost.deploy.coolify.title', body: 'selfhost.deploy.coolify.body' },
  { icon: Server, title: 'selfhost.deploy.manual.title', body: 'selfhost.deploy.manual.body' },
];

function SelfHostingPage() {
  const t = useT();
  return (
    <MarketingShell>
      <PageHeader eyebrow={t('selfhost.eyebrow')} title={t('selfhost.title')} lead={t('selfhost.lead')} />

      {/* Requirements */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <h2 className="font-semibold text-3xl tracking-tight">{t('selfhost.req.heading')}</h2>
          <p className="mt-3 text-lg text-muted-foreground">{t('selfhost.req.sub')}</p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {REQUIREMENTS.map((req) => (
            <div key={req.title} className="rounded-xl border border-border bg-card p-5">
              <span className={`${ICON_TILE} size-10`}>
                <req.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-semibold">{t(req.title)}</h3>
              <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{t(req.body)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Steps + terminal */}
      <section className="border-border border-y bg-card/40">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-20 lg:grid-cols-2">
          <div>
            <Eyebrow>{t('eyebrow.selfHost')}</Eyebrow>
            <h2 className="mt-3 font-semibold text-3xl tracking-tight">{t('selfhost.steps.heading')}</h2>
            <ol className="mt-8 space-y-6">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-foreground text-sm">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold">{t(step.title)}</h3>
                    <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{t(step.body)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-[#0d1117] font-mono text-sm shadow-xl shadow-black/5" dir="ltr">
            <div className="flex items-center gap-1.5 border-white/10 border-b px-4 py-3">
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="ms-3 text-white/40 text-xs">{t('selfHost.terminal.label')}</span>
            </div>
            <pre className="overflow-x-auto p-5 text-white/90 leading-relaxed">{`# 1 · clone
git clone ${GITHUB_URL.replace('https://', '')}
cd nibleaf

# 2 · configure
cp .env.example .env

# 3 · bring it up
docker compose up -d

# 4 · open http://localhost:4310
#     and create your account`}</pre>
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <h2 className="font-semibold text-3xl tracking-tight">{t('selfhost.get.heading')}</h2>
          <ul className="space-y-4">
            {GET.map((item) => (
              <li key={item} className="flex items-start gap-3 text-[15px]">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary/10 text-primary">
                  <Check className="size-3" />
                </span>
                {t(item)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Deploy your way */}
      <section className="border-border border-y bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-semibold text-3xl tracking-tight">{t('selfhost.deploy.heading')}</h2>
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {DEPLOY.map((d) => (
              <div key={d.title} className="rounded-xl border border-border bg-background p-6">
                <span className={`${ICON_TILE} size-10`}>
                  <d.icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold text-lg">{t(d.title)}</h3>
                <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{t(d.body)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 py-24">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground px-8 py-14 text-center text-background">
          <div className="bg-dotgrid pointer-events-none absolute inset-0 opacity-[0.15]" aria-hidden="true" />
          <div className="relative">
            <h2 className="font-semibold text-3xl tracking-tight">{t('selfhost.cta.title')}</h2>
            <p className="mx-auto mt-3 max-w-xl text-background/75">{t('selfhost.cta.body')}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a className={btn(BTN_DEFAULT, SZ_LG, 'group')} href={GITHUB_URL} rel="noreferrer" target="_blank">
                <Github className="size-4" /> {t('selfhost.cta.primary')}
              </a>
              <a
                className={btn(SZ_LG, 'border-background/25 text-background hover:bg-background/10')}
                href={`${GITHUB_URL}#readme`}
                rel="noreferrer"
                target="_blank"
              >
                {t('selfhost.cta.secondary')}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </a>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
