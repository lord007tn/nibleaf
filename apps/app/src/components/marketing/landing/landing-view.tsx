import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  Cloud,
  Code2,
  Globe2,
  History,
  KeyRound,
  Languages,
  LifeBuoy,
  LockKeyhole,
  Palette,
  PenLine,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Waypoints,
} from 'lucide-react';
import type { LandingCopy, MarketingIcon, MarketingLang, PathCard } from '../copy/types';
import { USE_CASES_TEASER } from '../copy/use-case-meta';
import { HeroMedia, MarketingMedia } from '../media/marketing-media';
import { GitHubStarLink } from '../site/github-star-link';
import {
  DownloadIcon as Download,
  GitBranchIcon as GitBranch,
  MessageSquareIcon as MessageSquare,
  ServerIcon as Server,
} from '../site/marketing-icons';
import { MarketingLink } from '../site/marketing-link';
import { Eyebrow, iconTile, outlineButton, primaryButton } from '../site/primitives';
import { getUseCaseCards } from '../use-cases/use-case-cards';

const icons = {
  ai: Sparkles,
  search: Search,
  insights: BarChart3,
  mcp: Waypoints,
  editor: PenLine,
  languages: Languages,
  themes: Palette,
  domains: Globe2,
  versions: History,
  git: GitBranch,
  exports: Download,
  api: Code2,
  private: LockKeyhole,
  llms: BookOpen,
  seo: Search,
  key: KeyRound,
  storage: Server,
  feedback: MessageSquare,
  openSource: Code2,
  server: Server,
  cloud: Cloud,
  shield: ShieldCheck,
  support: LifeBuoy,
  team: Users,
} satisfies Record<MarketingIcon, typeof Sparkles>;

/**
 * The feature stories the landing page tells, in order (P2-MKT-005). The other
 * stories in the copy (insights, AI assistants) live on the support-teams use
 * case page and the pricing table; the Ask AI story links there.
 */
export const LANDING_STORY_IDS = ['ask-ai', 'search', 'editor', 'arabic'] as const;

const container = 'mx-auto max-w-7xl px-5 sm:px-6';
const section = `${container} py-16 sm:py-24`;
const title = 'text-balance font-semibold text-3xl leading-snug tracking-tight sm:text-4xl rtl:leading-relaxed';
const body = 'max-w-[72ch] text-muted-foreground leading-7';
const textLink = 'inline-flex min-h-11 items-center gap-2 py-2 font-medium text-primary text-sm underline-offset-4 hover:underline';

function Icon({ name }: { name: MarketingIcon }) {
  const Glyph = icons[name];
  return <Glyph aria-hidden="true" className="size-5" />;
}

function Heading({ copy }: { copy: { eyebrow: string; title: string; body?: string } }) {
  return (
    <div className="max-w-3xl">
      <Eyebrow>{copy.eyebrow}</Eyebrow>
      <h2 className={`mt-3 ${title}`}>{copy.title}</h2>
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

function HostingCard({ copy, lang, cloud }: { copy: PathCard; lang: MarketingLang; cloud?: boolean }) {
  const Glyph = cloud ? Cloud : Server;
  return (
    <article
      className={`flex min-w-0 flex-col rounded-2xl border bg-card p-6 sm:p-8 ${cloud ? 'border-primary/40 ring-1 ring-primary/10' : 'border-border'}`}
    >
      <Glyph aria-hidden="true" className="size-6 text-primary" />
      <h3 className="mt-5 font-semibold text-xl">{copy.name}</h3>
      <p className="mt-4 font-semibold text-2xl leading-relaxed tracking-tight">{copy.price}</p>
      <p className="mt-1 text-muted-foreground text-sm leading-7">{copy.priceNote}</p>
      <div className="my-7">
        <Bullets items={copy.points} />
      </div>
      <MarketingLink
        cta={copy.cta}
        lang={lang}
        placement="resource_bridge"
        className={`${cloud ? primaryButton : outlineButton} mt-auto whitespace-normal text-center`}
      >
        <ArrowRight aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
      </MarketingLink>
      <p className="mt-4 text-muted-foreground text-xs leading-6">{copy.footnote}</p>
    </article>
  );
}

export function LandingView({
  lang,
  copy,
  stars = 0,
  starsLabel,
}: {
  lang: MarketingLang;
  copy: LandingCopy;
  stars?: number;
  /** Localized accessible label for the GitHub star count, from the shell copy. */
  starsLabel?: (count: number) => string;
}) {
  const stories = LANDING_STORY_IDS.flatMap((id) => copy.features.filter((feature) => feature.id === id));
  const faqs = copy.faq.items.filter((item) => item.featured);
  const useCases = USE_CASES_TEASER[lang];
  return (
    <>
      <section className="border-border border-b bg-linear-to-b from-primary/5 via-background to-background">
        <div className={`${container} grid items-center gap-10 py-12 sm:py-20 lg:grid-cols-[1fr_1.05fr] lg:items-start lg:gap-12 lg:py-24`}>
          <div className="min-w-0">
            <Eyebrow>{copy.hero.eyebrow}</Eyebrow>
            <h1 className="mt-5 text-balance font-semibold text-[2.5rem] leading-[1.12] tracking-tight sm:text-5xl lg:text-[3.4rem] rtl:text-[2.1rem] rtl:leading-[1.5] rtl:tracking-normal rtl:sm:text-5xl">
              {copy.hero.title}
            </h1>
            <p className="mt-5 max-w-[60ch] text-foreground/80 text-lg leading-8">{copy.hero.subtitle}</p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <MarketingLink cta={copy.hero.primaryCta} lang={lang} placement="hero" className={primaryButton}>
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
              </MarketingLink>
              <MarketingLink cta={copy.hero.secondaryCta} lang={lang} placement="hero" className={outlineButton} />
            </div>
            <MarketingLink cta={copy.hero.tertiaryLink} lang={lang} placement="hero" className={`mt-3 ${textLink}`}>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
            </MarketingLink>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-foreground/70 text-xs leading-6">
              {copy.hero.assurances.map((item) => (
                <li key={item} className="flex items-start gap-1.5">
                  <Check aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            {copy.hero.availabilityNote && <p className="mt-4 max-w-[60ch] text-foreground/70 text-xs leading-6">{copy.hero.availabilityNote}</p>}
          </div>
          <HeroMedia lang={lang} media={copy.hero.media} />
        </div>
      </section>

      <section aria-labelledby="proof-title" className="border-border border-b bg-card/50">
        <h2 id="proof-title" className="sr-only">
          {copy.proof.label}
        </h2>
        <div className={`${container} grid gap-7 py-9 sm:grid-cols-2 lg:grid-cols-4`}>
          {copy.proof.items.map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <span className={`${iconTile} size-10 shrink-0`}>
                <Icon name={item.icon} />
              </span>
              <div>
                <h3 className="font-semibold text-sm leading-6">
                  {item.href ? (
                    <a
                      href={item.href}
                      className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
                      {...(item.href.startsWith('http') ? { rel: 'noopener noreferrer' } : {})}
                    >
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                </h3>
                <p className="mt-1 text-muted-foreground text-xs leading-6">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div id="features" className="scroll-mt-24">
        {stories.map((feature, index) => (
          <section key={feature.id} id={feature.id} className={`scroll-mt-24 border-border border-b ${index % 2 === 1 ? 'bg-muted/20' : ''}`}>
            <div className={`${section} grid items-center gap-9 lg:grid-cols-2 lg:gap-16`}>
              <div className={`min-w-0 ${index % 2 === 1 ? 'lg:order-2' : ''}`}>
                <Heading copy={feature} />
                <div className="mt-6">
                  <Bullets items={feature.bullets} />
                </div>
                {feature.note && (
                  <p className="mt-6 border-border border-s-2 ps-4 text-muted-foreground text-xs leading-6">
                    <span className="font-medium text-foreground">
                      {feature.noteLabel ?? (lang === 'ar' ? 'المتطلبات' : 'Requirements')}
                      {': '}
                    </span>
                    {feature.note}
                  </p>
                )}
                {feature.cta && (
                  <MarketingLink cta={feature.cta} lang={lang} placement="resource_bridge" className={`mt-5 ${textLink}`}>
                    <ArrowRight aria-hidden="true" className="size-4 rtl:rotate-180" />
                  </MarketingLink>
                )}
              </div>
              <div className={`min-w-0 ${index % 2 === 1 ? 'lg:order-1' : ''}`}>
                <MarketingMedia lang={lang} media={feature.media} framed={feature.media.key === 'arabic' ? 'phone' : 'browser'} />
              </div>
            </div>
          </section>
        ))}
      </div>

      <section id="pricing" className={`${section} scroll-mt-24`}>
        <Heading copy={copy.paths} />
        <div className="mt-10 grid max-w-5xl gap-5 md:grid-cols-2">
          <HostingCard copy={copy.paths.cloud} lang={lang} cloud />
          <HostingCard copy={copy.paths.selfHost} lang={lang} />
        </div>
        <MarketingLink cta={copy.paths.detailsLink} lang={lang} placement="resource_bridge" className={`mt-5 ${textLink}`}>
          <ArrowRight aria-hidden="true" className="size-4 rtl:rotate-180" />
        </MarketingLink>
        <div className="mt-8 max-w-5xl border-border border-t pt-6">
          <h3 className="font-semibold leading-7">{copy.compare.title}</h3>
          <ul className="mt-1 flex flex-wrap gap-x-6">
            {copy.compare.links.map((link) => (
              <li key={link.href}>
                <MarketingLink cta={link} lang={lang} placement="resource_bridge" className={textLink}>
                  <ArrowRight aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
                </MarketingLink>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="faq" className="scroll-mt-24 border-border border-y bg-muted/20">
        <div className={`${section} grid gap-8 lg:grid-cols-[0.8fr_1.2fr]`}>
          <Heading copy={copy.faq} />
          <div className="min-w-0">
            <div className="divide-y divide-border border-border border-y">
              {faqs.map((item) => (
                <details key={item.q} className="group py-1">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-5 rounded-md py-4 [&::-webkit-details-marker]:hidden font-medium leading-7 focus-visible:outline-2 focus-visible:outline-ring">
                    <span>{item.q}</span>
                    <Plus aria-hidden="true" className="size-4 shrink-0 group-open:rotate-45" />
                  </summary>
                  <p className="max-w-[72ch] pb-5 text-muted-foreground text-sm leading-7">{item.a}</p>
                </details>
              ))}
            </div>
            <ul className="mt-4 flex flex-wrap gap-x-6">
              {copy.faq.moreLinks.map((link) => (
                <li key={link.href}>
                  <MarketingLink cta={link} lang={lang} placement="resource_bridge" className={textLink}>
                    <ArrowRight aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
                  </MarketingLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className={`${container} py-16 sm:py-24`}>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-12 sm:px-12 sm:py-16">
          <h2 className={`max-w-3xl ${title}`}>{copy.finalCta.title}</h2>
          {/* Full-strength text: muted grey on the tinted panel falls below 4.5:1 in the light theme. */}
          <p className="mt-4 max-w-[72ch] text-foreground/80 leading-7">{copy.finalCta.body}</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <MarketingLink cta={copy.finalCta.primary} lang={lang} placement="final" className={primaryButton}>
              <ArrowRight aria-hidden="true" className="size-4 rtl:rotate-180" />
            </MarketingLink>
            <MarketingLink cta={copy.finalCta.secondary} lang={lang} placement="final" className={outlineButton} />
            <GitHubStarLink stars={stars} label={lang === 'ar' ? 'GitHub' : 'Star on GitHub'} starsLabel={starsLabel} />
          </div>
          {/* The header's "Use cases" link lands here (`/#use-cases`); each team has its own page. */}
          <div id="use-cases" className="mt-8 scroll-mt-24 border-primary/20 border-t pt-6">
            <p className="text-foreground/80 text-sm leading-7">{useCases.body}</p>
            <ul className="mt-1 flex flex-wrap gap-x-6">
              {getUseCaseCards(lang).map((card) => (
                <li key={card.slug}>
                  <a href={card.href} className={textLink}>
                    {card.label}
                    <ArrowRight aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
