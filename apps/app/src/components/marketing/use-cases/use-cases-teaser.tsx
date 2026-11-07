import { ArrowRight, Code2, LifeBuoy, PenLine } from 'lucide-react';
import type { MarketingLang, UseCaseSlug, UseCasesTeaserCopy } from '../copy/types';
import { USE_CASES_TEASER } from '../copy/use-case-meta';
import { Eyebrow, iconTile } from '../site/primitives';
import { getUseCaseCards, type UseCaseCard } from './use-case-cards';

const icons = { 'support-teams': LifeBuoy, 'product-docs': PenLine, 'api-docs': Code2 } satisfies Record<UseCaseSlug, typeof LifeBuoy>;

/**
 * Landing-page teaser linking the three use-case pages. Renders as
 * `section#use-cases`, so header links can target `/#use-cases` and
 * `/ar#use-cases`. `teaser` and `cards` default to the page language's copy.
 */
export function UseCasesTeaser({
  lang,
  teaser = USE_CASES_TEASER[lang],
  cards = getUseCaseCards(lang),
}: {
  lang: MarketingLang;
  teaser?: UseCasesTeaserCopy;
  cards?: UseCaseCard[];
}) {
  return (
    <section id="use-cases" aria-labelledby="use-cases-title" className="scroll-mt-24 border-border border-b">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-24">
        <div className="max-w-3xl">
          <Eyebrow>{teaser.eyebrow}</Eyebrow>
          <h2
            id="use-cases-title"
            className="mt-3 text-balance font-semibold text-3xl leading-snug tracking-tight sm:text-4xl rtl:leading-relaxed rtl:tracking-normal"
          >
            {teaser.title}
          </h2>
          <p className="mt-4 max-w-[72ch] text-muted-foreground leading-7">{teaser.body}</p>
        </div>
        <ul className="mt-10 grid gap-5 md:grid-cols-3">
          {cards.map((card) => {
            const Glyph = icons[card.slug];
            return (
              <li
                key={card.slug}
                className="relative flex min-w-0 flex-col rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40 motion-reduce:transition-none"
              >
                <span className={`${iconTile} size-11`}>
                  <Glyph aria-hidden="true" className="size-5" />
                </span>
                <h3 className="mt-5 font-semibold text-lg leading-8">
                  {/* The link covers the whole card; its accessible name stays the card label. */}
                  <a
                    href={card.href}
                    className="inline-flex min-h-11 items-center gap-2 underline-offset-4 after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:underline"
                  >
                    {card.label}
                    <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-primary rtl:rotate-180" />
                  </a>
                </h3>
                <p className="mt-2 text-muted-foreground text-sm leading-7">{card.summary}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
