import { NibleafMark, NibleafWordmark } from '@nibleaf/design-system/brand';
import { type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, Check, ExternalLink, Languages, Search, Server, ShieldCheck } from 'lucide-react';
import { type ReactNode, useCallback } from 'react';
import { primaryButton } from '@/components/cloud-marketing';
import { sendMarketingCtaEvent } from '@/lib/marketing-analytics';

interface Platform {
  name: string;
  sources: Array<{ href: string; label: string }>;
  summary: string;
  bestFor: string;
  arabic: string;
  model: string;
  caveat: string;
  nibleaf?: boolean;
}

type T = (key: MessageKey, variables?: MessageVariables) => string;

function useArabicT() {
  const { locale, t } = useLocale();
  return useCallback<T>((key, variables) => (locale === 'ar' ? t(key, variables) : translateFn(key, variables, 'ar')), [locale, t]);
}

function getPlatforms(t: T): Platform[] {
  return [
    {
      name: 'Nibleaf',
      sources: [
        { href: '/pricing', label: t('marketing.arabicSeo.source.pricing') },
        { href: 'https://github.com/lord007tn/nibleaf', label: t('marketing.arabicSeo.source.public') },
      ],
      summary: t('marketing.arabicSeo.platform.nibleaf.summary'),
      bestFor: t('marketing.arabicSeo.platform.nibleaf.bestFor'),
      arabic: t('marketing.arabicSeo.platform.nibleaf.arabic'),
      model: t('marketing.arabicSeo.platform.nibleaf.model'),
      caveat: t('marketing.arabicSeo.platform.nibleaf.caveat'),
      nibleaf: true,
    },
    {
      name: 'Mintlify',
      sources: [
        { href: 'https://www.mintlify.com/docs/guides/internationalization', label: t('marketing.arabicSeo.source.languages') },
        { href: 'https://www.mintlify.com/pricing', label: t('marketing.arabicSeo.source.pricing') },
      ],
      summary: t('marketing.arabicSeo.platform.mintlify.summary'),
      bestFor: t('marketing.arabicSeo.platform.mintlify.bestFor'),
      arabic: t('marketing.arabicSeo.platform.mintlify.arabic'),
      model: t('marketing.arabicSeo.platform.mintlify.model'),
      caveat: t('marketing.arabicSeo.platform.mintlify.caveat'),
    },
    {
      name: 'GitBook',
      sources: [
        {
          href: 'https://gitbook.com/docs/publishing-documentation/customization/extra-configuration',
          label: t('marketing.arabicSeo.source.interfaceLocale'),
        },
        {
          href: 'https://gitbook.com/docs/publishing-documentation/site-structure/variants',
          label: t('marketing.arabicSeo.source.languagesVersions'),
        },
        { href: 'https://www.gitbook.com/pricing', label: t('marketing.arabicSeo.source.pricing') },
      ],
      summary: t('marketing.arabicSeo.platform.gitbook.summary'),
      bestFor: t('marketing.arabicSeo.platform.gitbook.bestFor'),
      arabic: t('marketing.arabicSeo.platform.gitbook.arabic'),
      model: t('marketing.arabicSeo.platform.gitbook.model'),
      caveat: t('marketing.arabicSeo.platform.gitbook.caveat'),
    },
    {
      name: 'Docusaurus',
      sources: [{ href: 'https://docusaurus.io/docs/i18n/introduction', label: t('marketing.arabicSeo.source.officialDocs') }],
      summary: t('marketing.arabicSeo.platform.docusaurus.summary'),
      bestFor: t('marketing.arabicSeo.platform.docusaurus.bestFor'),
      arabic: t('marketing.arabicSeo.platform.docusaurus.arabic'),
      model: t('marketing.arabicSeo.platform.docusaurus.model'),
      caveat: t('marketing.arabicSeo.platform.docusaurus.caveat'),
    },
    {
      name: 'Material for MkDocs',
      sources: [
        { href: 'https://squidfunk.github.io/mkdocs-material/setup/changing-the-language/', label: t('marketing.arabicSeo.source.officialDocs') },
      ],
      summary: t('marketing.arabicSeo.platform.mkdocs.summary'),
      bestFor: t('marketing.arabicSeo.platform.mkdocs.bestFor'),
      arabic: t('marketing.arabicSeo.platform.mkdocs.arabic'),
      model: t('marketing.arabicSeo.platform.mkdocs.model'),
      caveat: t('marketing.arabicSeo.platform.mkdocs.caveat'),
    },
    {
      name: 'Apidog',
      sources: [{ href: 'https://apidog.com/ar/blog/documentation-tools-ar/', label: t('marketing.arabicSeo.source.official') }],
      summary: t('marketing.arabicSeo.platform.apidog.summary'),
      bestFor: t('marketing.arabicSeo.platform.apidog.bestFor'),
      arabic: t('marketing.arabicSeo.platform.apidog.arabic'),
      model: t('marketing.arabicSeo.platform.apidog.model'),
      caveat: t('marketing.arabicSeo.platform.apidog.caveat'),
    },
  ];
}

function ArabicShell({ children }: { children: ReactNode }) {
  const t = useArabicT();
  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="border-border/70 border-b bg-muted/60 px-4 py-2 text-center text-muted-foreground text-xs">
        {t('marketing.arabicSeo.shell.notice')}
      </div>
      <header className="sticky top-0 z-40 border-border/70 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <a
            aria-label={t('marketing.arabicSeo.shell.homeLabel')}
            className="flex items-center gap-2 font-semibold text-lg tracking-tight"
            href="/ar"
          >
            <NibleafMark aria-hidden="true" className="size-8" />
            <NibleafWordmark aria-hidden="true" />
          </a>
          <nav aria-label={t('marketing.arabicSeo.shell.navLabel')} className="ms-8 hidden items-center gap-6 text-muted-foreground text-sm md:flex">
            <a className="hover:text-foreground" href="/ar#features">
              {t('marketing.arabicSeo.shell.features')}
            </a>
            <a className="hover:text-foreground" href="/ar/documentation-platforms">
              {t('marketing.arabicSeo.shell.comparison')}
            </a>
            <a className="hover:text-foreground" href="/blog/arabic-technical-documentation-rtl-checklist">
              {t('marketing.arabicSeo.shell.rtlGuide')}
            </a>
            <a className="hover:text-foreground" href="https://docs.nibleaf.com">
              {t('marketing.arabicSeo.shell.docs')}
            </a>
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <a className="hidden h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-muted sm:inline-flex" href="/" hrefLang="en">
              English
            </a>
            <a
              className={`${primaryButton} h-9 px-3 text-sm`}
              href="/sign-up"
              onClick={() => sendMarketingCtaEvent({ destination: 'signup', language: 'ar', placement: 'header' })}
            >
              {t('marketing.arabicSeo.cta.startFree')}
            </a>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-border border-t">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 text-sm sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2 font-semibold">
              <NibleafMark className="size-6" /> Nibleaf
            </div>
            <p className="mt-3 max-w-sm text-muted-foreground leading-relaxed">{t('marketing.arabicSeo.shell.footerDescription')}</p>
          </div>
          <div>
            <p className="font-medium">{t('marketing.arabicSeo.shell.usefulLinks')}</p>
            <div className="mt-3 grid gap-2 text-muted-foreground">
              <a className="hover:text-foreground" href="/pricing">
                {t('marketing.arabicSeo.shell.currentPricing')}
              </a>
              <a className="hover:text-foreground" href="/self-hosting">
                {t('marketing.arabicSeo.shell.selfHosting')}
              </a>
              <a className="hover:text-foreground" href="/tools/rtl-documentation-readiness">
                {t('marketing.arabicSeo.shell.rtlTool')}
              </a>
            </div>
          </div>
          <div>
            <p className="font-medium">{t('marketing.arabicSeo.shell.sourceTransparency')}</p>
            <div className="mt-3 grid gap-2 text-muted-foreground">
              <a
                className="inline-flex items-center gap-2 hover:text-foreground"
                href="https://github.com/lord007tn/nibleaf"
                rel="noopener noreferrer"
                target="_blank"
              >
                {t('marketing.arabicSeo.shell.publicRepository')}
              </a>
              <a className="hover:text-foreground" href="/about">
                {t('marketing.arabicSeo.shell.aboutComparisons')}
              </a>
              <a className="hover:text-foreground" href="/contact">
                {t('marketing.arabicSeo.shell.correctInformation')}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function ArabicLandingPage() {
  const t = useArabicT();
  const features: Array<{ icon: LucideIcon; title: string; body: string }> = [
    { icon: Languages, title: t('marketing.arabicSeo.landing.featureLanguageTitle'), body: t('marketing.arabicSeo.landing.featureLanguageBody') },
    { icon: Search, title: t('marketing.arabicSeo.landing.featureSearchTitle'), body: t('marketing.arabicSeo.landing.featureSearchBody') },
    { icon: Server, title: t('marketing.arabicSeo.landing.featureHostingTitle'), body: t('marketing.arabicSeo.landing.featureHostingBody') },
    { icon: ShieldCheck, title: t('marketing.arabicSeo.landing.featureOwnershipTitle'), body: t('marketing.arabicSeo.landing.featureOwnershipBody') },
  ];
  return (
    <ArabicShell>
      <section className="relative overflow-hidden border-border border-b">
        <div
          className="absolute inset-0 -z-10 opacity-50"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
            maskImage: 'linear-gradient(to bottom, black, transparent 80%)',
          }}
        />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1fr_0.82fr] lg:py-28">
          <div>
            <p className="inline-flex rounded-full border border-border bg-card px-3 py-1 font-medium text-primary text-xs">
              {t('marketing.arabicSeo.landing.eyebrow')}
            </p>
            <h1 className="mt-6 text-balance font-semibold text-5xl leading-[1.18] tracking-tight sm:text-6xl">
              {t('marketing.arabicSeo.landing.heading')}
            </h1>
            <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground leading-8">{t('marketing.arabicSeo.landing.intro')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                className={`${primaryButton} group`}
                href="/sign-up"
                onClick={() => sendMarketingCtaEvent({ destination: 'signup', language: 'ar', placement: 'hero' })}
              >
                {t('marketing.arabicSeo.cta.createFree')} <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
              </a>
              <a
                className="inline-flex h-11 items-center rounded-md border border-border px-5 font-medium text-sm hover:bg-muted"
                href="/ar/documentation-platforms"
                onClick={() => sendMarketingCtaEvent({ destination: 'comparison', language: 'ar', placement: 'hero' })}
              >
                {t('marketing.arabicSeo.cta.compare')}
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground text-sm">
              <span className="inline-flex items-center gap-2">
                <Check className="size-4 text-primary" /> {t('marketing.arabicSeo.landing.noCard')}
              </span>
              <span className="inline-flex items-center gap-2">
                <Check className="size-4 text-primary" /> {t('marketing.arabicSeo.landing.markdownOwned')}
              </span>
              <span className="inline-flex items-center gap-2">
                <Check className="size-4 text-primary" /> {t('marketing.arabicSeo.landing.arabicFirst')}
              </span>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-black/5">
            <div className="flex items-center justify-between border-border border-b pb-4 text-sm">
              <span className="font-medium">{t('marketing.arabicSeo.landing.demoTitle')}</span>
              <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">{t('marketing.arabicSeo.landing.demoBadge')}</span>
            </div>
            <div className="mt-6 space-y-5">
              <div>
                <p className="text-muted-foreground text-xs">{t('marketing.arabicSeo.landing.demoLabel')}</p>
                <p className="mt-1 font-semibold text-xl">{t('marketing.arabicSeo.landing.demoHeading')}</p>
              </div>
              <p className="text-muted-foreground leading-7">
                {t('marketing.arabicSeo.landing.demoRun')}{' '}
                <code className="rounded bg-muted px-1.5 py-0.5" dir="ltr">
                  curl https://api.example.com/v1
                </code>{' '}
                {t('marketing.arabicSeo.landing.demoCopy')}{' '}
                <code className="rounded bg-muted px-1.5 py-0.5" dir="ltr">
                  API_KEY
                </code>
                {t('marketing.arabicSeo.landing.demoPeriod')}
              </p>
              <div className="rounded-xl border border-border bg-background p-4" dir="ltr">
                <code>
                  curl -H "Authorization: Bearer $API_KEY" \<br />
                  &nbsp;&nbsp;https://api.example.com/v1/projects
                </code>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Search className="size-4" /> {t('marketing.arabicSeo.landing.demoSearch')}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-24" id="features">
        <div className="max-w-3xl">
          <p className="font-medium text-primary text-sm">{t('marketing.arabicSeo.landing.featuresEyebrow')}</p>
          <h2 className="mt-3 font-semibold text-4xl tracking-tight">{t('marketing.arabicSeo.landing.featuresHeading')}</h2>
          <p className="mt-5 text-lg text-muted-foreground leading-8">{t('marketing.arabicSeo.landing.featuresBody')}</p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: FeatureIcon, title, body }) => (
            <article className="rounded-xl border border-border bg-card p-6" key={title}>
              <FeatureIcon className="size-6 text-primary" />
              <h3 className="mt-5 font-semibold text-lg">{title}</h3>
              <p className="mt-2 text-muted-foreground text-sm leading-7">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-border border-y bg-card/50">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-2">
          <div>
            <p className="font-medium text-primary text-sm">{t('marketing.arabicSeo.landing.fitEyebrow')}</p>
            <h2 className="mt-3 font-semibold text-3xl tracking-tight">{t('marketing.arabicSeo.landing.fitHeading')}</h2>
            <ul className="mt-6 space-y-4 text-muted-foreground leading-7">
              {[
                t('marketing.arabicSeo.landing.fitOne'),
                t('marketing.arabicSeo.landing.fitTwo'),
                t('marketing.arabicSeo.landing.fitThree'),
                t('marketing.arabicSeo.landing.fitFour'),
              ].map((item) => (
                <li className="flex gap-3" key={item}>
                  <Check className="mt-1 size-5 shrink-0 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium text-primary text-sm">{t('marketing.arabicSeo.landing.alternativeEyebrow')}</p>
            <h2 className="mt-3 font-semibold text-3xl tracking-tight">{t('marketing.arabicSeo.landing.alternativeHeading')}</h2>
            <ul className="mt-6 space-y-4 text-muted-foreground leading-7">
              {[
                t('marketing.arabicSeo.landing.alternativeMintlify'),
                t('marketing.arabicSeo.landing.alternativeGitbook'),
                t('marketing.arabicSeo.landing.alternativeStatic'),
                t('marketing.arabicSeo.landing.alternativeApidog'),
              ].map((item) => (
                <li className="flex gap-3" key={item}>
                  <Check className="mt-1 size-5 shrink-0 text-muted-foreground" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="text-balance font-semibold text-4xl tracking-tight">{t('marketing.arabicSeo.landing.resourceHeading')}</h2>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground leading-8">{t('marketing.arabicSeo.landing.resourceBody')}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            className={primaryButton}
            href="/tools/rtl-documentation-readiness"
            onClick={() => sendMarketingCtaEvent({ destination: 'rtl_tool', language: 'ar', placement: 'resource_bridge' })}
          >
            {t('marketing.arabicSeo.cta.checkRtl')}
          </a>
          <a
            className="inline-flex h-11 items-center rounded-md border border-border px-5 font-medium text-sm hover:bg-muted"
            href="/blog/arabic-technical-documentation-rtl-checklist"
            onClick={() => sendMarketingCtaEvent({ destination: 'rtl_guide', language: 'ar', placement: 'resource_bridge' })}
          >
            {t('marketing.arabicSeo.cta.readChecklist')}
          </a>
        </div>
      </section>
    </ArabicShell>
  );
}

export function ArabicDocumentationPlatformsPage() {
  const t = useArabicT();
  const platforms = getPlatforms(t);
  return (
    <ArabicShell>
      <article>
        <header className="border-border border-b">
          <div className="mx-auto max-w-4xl px-6 py-20">
            <p className="font-medium text-primary text-sm">{t('marketing.arabicSeo.comparison.eyebrow')}</p>
            <h1 className="mt-4 text-balance font-semibold text-4xl leading-tight tracking-tight sm:text-5xl">
              {t('marketing.arabicSeo.comparison.heading')}
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-8">{t('marketing.arabicSeo.comparison.intro')}</p>
            <p className="mt-5 border-border border-t pt-5 text-muted-foreground text-sm leading-7">
              {t('marketing.arabicSeo.comparison.disclosure', { reviewedOn: t('marketing.arabicSeo.comparison.reviewedOn') })}
            </p>
          </div>
        </header>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="font-semibold text-3xl tracking-tight">{t('marketing.arabicSeo.comparison.methodHeading')}</h2>
          <p className="mt-5 text-muted-foreground leading-8">{t('marketing.arabicSeo.comparison.methodBody')}</p>
          <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[46rem] text-sm">
              <caption className="sr-only">{t('marketing.arabicSeo.comparison.tableCaption')}</caption>
              <thead>
                <tr className="border-border border-b bg-muted/50">
                  <th className="px-4 py-3 text-start">{t('marketing.arabicSeo.comparison.platform')}</th>
                  <th className="px-4 py-3 text-start">{t('marketing.arabicSeo.comparison.bestFor')}</th>
                  <th className="px-4 py-3 text-start">{t('marketing.arabicSeo.comparison.arabicStatus')}</th>
                  <th className="px-4 py-3 text-start">{t('marketing.arabicSeo.comparison.operatingModel')}</th>
                </tr>
              </thead>
              <tbody>
                {platforms.map((platform) => (
                  <tr className="border-border border-b align-top last:border-0" key={platform.name}>
                    <th className="px-4 py-4 text-start font-medium">{platform.name}</th>
                    <td className="px-4 py-4 text-muted-foreground leading-6">{platform.bestFor}</td>
                    <td className="px-4 py-4 text-muted-foreground leading-6">{platform.arabic}</td>
                    <td className="px-4 py-4 text-muted-foreground leading-6">{platform.model}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border-border border-y bg-card/40">
          <div className="mx-auto max-w-4xl px-6 py-16">
            <h2 className="font-semibold text-3xl tracking-tight">{t('marketing.arabicSeo.comparison.optionsHeading')}</h2>
            <div className="mt-10 space-y-6">
              {platforms.map((platform, index) => (
                <section
                  className={`rounded-xl border bg-background p-7 ${platform.nibleaf ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'}`}
                  key={platform.name}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-muted-foreground/50">{String(index + 1).padStart(2, '0')}</span>
                    <h3 className="font-semibold text-xl">{platform.name}</h3>
                    {platform.nibleaf ? (
                      <span className="rounded-full bg-primary px-2.5 py-1 text-primary-foreground text-xs">
                        {t('marketing.arabicSeo.comparison.ourProduct')}
                      </span>
                    ) : null}
                    {platform.sources.map((source) => {
                      const external = source.href.startsWith('http');
                      return (
                        <a
                          className="inline-flex items-center gap-1 text-muted-foreground text-xs underline underline-offset-2"
                          href={source.href}
                          key={source.href}
                          rel={external ? 'noopener noreferrer' : undefined}
                          target={external ? '_blank' : undefined}
                        >
                          {source.label} {external ? <ExternalLink className="size-3" /> : null}
                        </a>
                      );
                    })}
                  </div>
                  <p className="mt-4 text-muted-foreground leading-8">{platform.summary}</p>
                  <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="font-medium">{t('marketing.arabicSeo.comparison.chooseWhen')}</dt>
                      <dd className="mt-1 text-muted-foreground leading-7">{platform.bestFor}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">{t('marketing.arabicSeo.comparison.watchFor')}</dt>
                      <dd className="mt-1 text-muted-foreground leading-7">{platform.caveat}</dd>
                    </div>
                  </dl>
                </section>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="font-semibold text-3xl tracking-tight">{t('marketing.arabicSeo.comparison.criteriaHeading')}</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            {[
              [t('marketing.arabicSeo.comparison.criteriaMixedTitle'), t('marketing.arabicSeo.comparison.criteriaMixedBody')],
              [t('marketing.arabicSeo.comparison.criteriaBlocksTitle'), t('marketing.arabicSeo.comparison.criteriaBlocksBody')],
              [t('marketing.arabicSeo.comparison.criteriaWorkflowTitle'), t('marketing.arabicSeo.comparison.criteriaWorkflowBody')],
              [t('marketing.arabicSeo.comparison.criteriaOwnershipTitle'), t('marketing.arabicSeo.comparison.criteriaOwnershipBody')],
              [t('marketing.arabicSeo.comparison.criteriaCostTitle'), t('marketing.arabicSeo.comparison.criteriaCostBody')],
              [t('marketing.arabicSeo.comparison.criteriaRolloutTitle'), t('marketing.arabicSeo.comparison.criteriaRolloutBody')],
            ].map(([title, body]) => (
              <div className="rounded-xl border border-border bg-card p-6" key={title}>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-muted-foreground text-sm leading-7">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-border border-y bg-card/40">
          <div className="mx-auto max-w-4xl px-6 py-16">
            <h2 className="font-semibold text-3xl tracking-tight">{t('marketing.arabicSeo.comparison.recommendationHeading')}</h2>
            <div className="mt-8 space-y-5 text-muted-foreground leading-8">
              <p>
                <strong className="text-foreground">{t('marketing.arabicSeo.comparison.recommendationProductLabel')}</strong>{' '}
                {t('marketing.arabicSeo.comparison.recommendationProductBody')}
              </p>
              <p>
                <strong className="text-foreground">{t('marketing.arabicSeo.comparison.recommendationAiLabel')}</strong>{' '}
                {t('marketing.arabicSeo.comparison.recommendationAiBody')}
              </p>
              <p>
                <strong className="text-foreground">{t('marketing.arabicSeo.comparison.recommendationGitbookLabel')}</strong>{' '}
                {t('marketing.arabicSeo.comparison.recommendationGitbookBody')}
              </p>
              <p>
                <strong className="text-foreground">{t('marketing.arabicSeo.comparison.recommendationEngineeringLabel')}</strong>{' '}
                {t('marketing.arabicSeo.comparison.recommendationEngineeringBody')}
              </p>
              <p>
                <strong className="text-foreground">{t('marketing.arabicSeo.comparison.recommendationApiLabel')}</strong>{' '}
                {t('marketing.arabicSeo.comparison.recommendationApiBody')}
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="font-semibold text-3xl tracking-tight">{t('marketing.arabicSeo.comparison.faqHeading')}</h2>
          <div className="mt-8 divide-y divide-border rounded-xl border border-border bg-card">
            {[
              [t('marketing.arabicSeo.comparison.faqAlternativeQuestion'), t('marketing.arabicSeo.comparison.faqAlternativeAnswer')],
              [t('marketing.arabicSeo.comparison.faqMintlifyQuestion'), t('marketing.arabicSeo.comparison.faqMintlifyAnswer')],
              [t('marketing.arabicSeo.comparison.faqGitbookQuestion'), t('marketing.arabicSeo.comparison.faqGitbookAnswer')],
              [t('marketing.arabicSeo.comparison.faqHostingQuestion'), t('marketing.arabicSeo.comparison.faqHostingAnswer')],
              [t('marketing.arabicSeo.comparison.faqTranslationQuestion'), t('marketing.arabicSeo.comparison.faqTranslationAnswer')],
            ].map(([question, answer]) => (
              <details className="group px-6 py-1 open:bg-muted/30" key={question}>
                <summary className="flex list-none items-center justify-between gap-4 py-5 font-medium">
                  {question}
                  <span className="grid size-6 place-items-center rounded-full border border-border transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="pb-5 text-muted-foreground text-sm leading-7">{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="rounded-2xl bg-foreground px-8 py-14 text-center text-background">
            <h2 className="font-semibold text-3xl tracking-tight">{t('marketing.arabicSeo.comparison.finalHeading')}</h2>
            <p className="mx-auto mt-4 max-w-2xl text-background/75 leading-7">{t('marketing.arabicSeo.comparison.finalBody')}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a
                className={`${primaryButton} group`}
                href="/sign-up"
                onClick={() => sendMarketingCtaEvent({ destination: 'signup', language: 'ar', placement: 'final' })}
              >
                {t('marketing.arabicSeo.cta.startFree')} <ArrowLeft className="size-4" />
              </a>
              <a
                className="inline-flex h-11 items-center rounded-md border border-background/30 px-5 font-medium text-sm hover:bg-background/10"
                href="/tools/rtl-documentation-readiness"
                onClick={() => sendMarketingCtaEvent({ destination: 'rtl_tool', language: 'ar', placement: 'final' })}
              >
                {t('marketing.arabicSeo.cta.checkExistingHtml')}
              </a>
            </div>
          </div>
        </section>
      </article>
    </ArabicShell>
  );
}
