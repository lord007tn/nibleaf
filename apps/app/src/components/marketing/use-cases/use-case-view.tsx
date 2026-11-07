import { ArrowRight, Check, Plus } from 'lucide-react';
import type { MarketingLang, UseCaseCopy } from '../copy/types';
import { HeroMedia, MarketingMedia } from '../media/marketing-media';
import { GitHubStarLink } from '../site/github-star-link';
import { MarketingLink } from '../site/marketing-link';
import { Eyebrow, outlineButton, primaryButton } from '../site/primitives';

// Spacing and type match `landing/landing-view.tsx`, so the use-case pages read
// as part of the same site. Arabic text keeps a line height of at least 1.6.
const container = 'mx-auto max-w-7xl px-5 sm:px-6';
const section = `${container} py-16 sm:py-24`;
const title = 'text-balance font-semibold text-3xl leading-snug tracking-tight sm:text-4xl rtl:leading-relaxed rtl:tracking-normal';
const body = 'max-w-[72ch] text-muted-foreground leading-7';
const textLink = 'inline-flex min-h-11 items-center gap-2 py-2 font-medium text-primary text-sm underline-offset-4 hover:underline';
const arrow = 'size-4 shrink-0 rtl:rotate-180';

const labels = {
  en: { requirements: 'Requirements: ', github: 'Star on GitHub' },
  ar: { requirements: 'المتطلبات: ', github: 'GitHub' },
} as const;

function Heading({ id, copy }: { id?: string; copy: { eyebrow?: string; title: string; body?: string } }) {
  return (
    <div className="max-w-3xl">
      {copy.eyebrow && <Eyebrow>{copy.eyebrow}</Eyebrow>}
      <h2 id={id} className={`${copy.eyebrow ? 'mt-3 ' : ''}${title}`}>
        {copy.title}
      </h2>
      {copy.body && <p className={`mt-4 ${body}`}>{copy.body}</p>}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3 text-sm leading-7">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <Check aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One use-case page (`/use-cases/<slug>`, `/ar/use-cases/<slug>`): hero,
 * problems, solutions as alternating feature rows, workflow, FAQ, related
 * reading and the final call to action. Copy comes from `use-cases.<lang>.ts`;
 * nothing here is language-specific beyond the two labels above.
 */
export function UseCaseView({ lang, copy, stars = 0 }: { lang: MarketingLang; copy: UseCaseCopy; stars?: number }) {
  const text = labels[lang];
  return (
    <>
      <section className="border-border border-b bg-linear-to-b from-primary/5 via-background to-background">
        <div className={`${container} grid items-center gap-10 py-12 sm:py-20 lg:grid-cols-[1fr_1.05fr] lg:gap-12 lg:py-24`}>
          <div className="min-w-0">
            <Eyebrow>{copy.hero.eyebrow}</Eyebrow>
            <h1 className="mt-5 text-balance font-semibold text-[2.5rem] leading-[1.12] tracking-tight sm:text-5xl lg:text-[3.4rem] rtl:text-[2.1rem] rtl:leading-[1.6] rtl:tracking-normal rtl:sm:text-5xl">
              {copy.hero.title}
            </h1>
            <p className="mt-5 max-w-[60ch] text-lg text-muted-foreground leading-8">{copy.hero.subtitle}</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <MarketingLink cta={copy.hero.primaryCta} lang={lang} placement="hero" className={primaryButton}>
                <ArrowRight aria-hidden="true" className={arrow} />
              </MarketingLink>
              <MarketingLink cta={copy.hero.secondaryCta} lang={lang} placement="hero" className={outlineButton} />
            </div>
            {copy.hero.availabilityNote && <p className="mt-4 max-w-[60ch] text-muted-foreground text-xs leading-6">{copy.hero.availabilityNote}</p>}
          </div>
          <HeroMedia lang={lang} media={copy.hero.media} />
        </div>
      </section>

      <section aria-labelledby="problems-title" className="border-border border-b bg-card/50">
        <div className={section}>
          <Heading id="problems-title" copy={copy.problems} />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {copy.problems.items.map((item) => (
              <article key={item.title} className="min-w-0 rounded-xl border border-border bg-background p-6">
                <h3 className="font-semibold text-lg leading-8">{item.title}</h3>
                <p className="mt-2 text-muted-foreground text-sm leading-7">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <div id="solutions" className="scroll-mt-24">
        {copy.solutions.map((feature, index) => {
          const flipped = index % 2 === 1;
          return (
            <section
              key={feature.id}
              id={feature.id}
              aria-labelledby={`${feature.id}-title`}
              className={`scroll-mt-24 border-border border-b ${flipped ? 'bg-muted/20' : ''}`}
            >
              {/* Grid columns follow the page direction, so the alternation mirrors in RTL on its own. */}
              <div className={`${section} grid items-center gap-9 lg:grid-cols-2 lg:gap-16`}>
                <div className={`min-w-0 ${flipped ? 'lg:order-2' : ''}`}>
                  <Heading id={`${feature.id}-title`} copy={feature} />
                  <div className="mt-6">
                    <Bullets items={feature.bullets} />
                  </div>
                  {feature.note && (
                    <p className="mt-6 border-border border-s-2 ps-4 text-muted-foreground text-xs leading-6">
                      <span className="font-medium text-foreground">{text.requirements}</span>
                      {feature.note}
                    </p>
                  )}
                  {feature.cta && (
                    <MarketingLink cta={feature.cta} lang={lang} placement="resource_bridge" className={`mt-5 ${textLink}`}>
                      <ArrowRight aria-hidden="true" className={arrow} />
                    </MarketingLink>
                  )}
                </div>
                <div className={`min-w-0 ${flipped ? 'lg:order-1' : ''}`}>
                  <MarketingMedia lang={lang} media={feature.media} framed={feature.media.key === 'arabic' ? 'phone' : 'browser'} />
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <section id="workflow" aria-labelledby="workflow-title" className={`scroll-mt-24 ${section} grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16`}>
        <Heading id="workflow-title" copy={copy.workflow} />
        <ol className="min-w-0 space-y-4">
          {copy.workflow.steps.map((step, index) => (
            <li key={step.title} className="flex gap-4 rounded-xl border border-border bg-card p-5 sm:gap-5 sm:p-6">
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/5 font-mono text-primary text-sm"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold text-lg leading-8">{step.title}</h3>
                <p className="mt-1 text-muted-foreground text-sm leading-7">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24 border-border border-y bg-muted/20">
        <div className={`${section} grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16`}>
          <Heading id="faq-title" copy={copy.faq} />
          <div className="min-w-0 divide-y divide-border border-border border-y">
            {copy.faq.items.map((item) => (
              <details key={item.q} className="group py-1">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-5 rounded-md py-4 font-medium leading-7 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                  <span>{item.q}</span>
                  <Plus aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-45 motion-reduce:transition-none" />
                </summary>
                <p className="max-w-[72ch] pb-5 text-muted-foreground text-sm leading-7">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="related" aria-labelledby="related-title" className={`scroll-mt-24 ${section}`}>
        <Heading id="related-title" copy={copy.related} />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {copy.related.links.map((link) => (
            <article key={link.href} className="min-w-0 rounded-xl border border-border bg-card p-5">
              <h3>
                <MarketingLink cta={link} lang={lang} placement="resource_bridge" className={textLink}>
                  <ArrowRight aria-hidden="true" className={arrow} />
                </MarketingLink>
              </h3>
              <p className="mt-1 text-muted-foreground text-sm leading-7">{link.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="final-cta-title" className={`${container} pb-16 sm:pb-24`}>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-12 sm:px-12 sm:py-16">
          <h2 id="final-cta-title" className={`max-w-3xl ${title}`}>
            {copy.finalCta.title}
          </h2>
          <p className={`mt-4 ${body}`}>{copy.finalCta.body}</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <MarketingLink cta={copy.finalCta.primary} lang={lang} placement="final" className={primaryButton}>
              <ArrowRight aria-hidden="true" className={arrow} />
            </MarketingLink>
            <MarketingLink cta={copy.finalCta.secondary} lang={lang} placement="final" className={outlineButton} />
            <GitHubStarLink stars={stars} label={text.github} />
          </div>
        </div>
      </section>
    </>
  );
}
