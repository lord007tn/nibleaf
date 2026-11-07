import { type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useCallback } from 'react';
import { primaryButton } from '@/components/cloud-marketing';
import { sendMarketingCtaEvent } from '@/lib/marketing-analytics';

import { ArabicShell } from './arabic-shell';

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

export function ArabicDocumentationPlatformsPage() {
  const t = useArabicT();
  const platforms = getPlatforms(t);
  return (
    <ArabicShell>
      <article>
        <header className="border-border border-b">
          <div className="mx-auto max-w-4xl px-6 py-20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-medium text-primary text-sm">{t('marketing.arabicSeo.comparison.eyebrow')}</p>
              <a className="text-muted-foreground text-sm underline underline-offset-4" href="/documentation-platforms" hrefLang="en">
                English
              </a>
            </div>
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
