import { ArrowRight, Check, Cloud, HandCoins, Scale, Server, ShieldCheck } from 'lucide-react';
import { formatUsd, PRICING_FACTS } from './copy/pricing-facts';
import type { MarketingLang, PricingCell, PricingCopy } from './copy/types';
import { isolateLatin } from './site/isolate-latin';
import { Eyebrow, invertedOutlineButton, outlineButton, primaryButton } from './site/primitives';

const finePrintIcons = [HandCoins, Scale, ShieldCheck];

/** Arabic headings keep normal tracking and a taller line: tight tracking breaks up joined letters. */
const arabicHeading = 'rtl:leading-relaxed rtl:tracking-normal';
const arrow = 'size-4 rtl:rotate-180';

function CellValue({ value, includedLabel, lang }: { value: PricingCell; includedLabel: string; lang: MarketingLang }) {
  if (value === true) {
    return <Check role="img" aria-label={includedLabel} className="mx-auto block size-4 text-primary" />;
  }
  return <span className="block text-center text-muted-foreground text-xs leading-snug">{isolateLatin(value, lang)}</span>;
}

/** A price in its own left-to-right run, so `$0` reads the same inside Arabic. */
function Price({ amount }: { amount: number }) {
  return (
    <p className="mt-4 font-semibold text-4xl tracking-tight">
      <bdi dir="ltr">{formatUsd(amount)}</bdi>
    </p>
  );
}

/**
 * The pricing page's sections, in either marketing language: `/pricing` and
 * `/ar/pricing` render this with their own copy module and shell, so the two
 * share one layout and the prices in `pricing-facts.ts`.
 */
export function PricingView({ copy, lang }: { copy: PricingCopy; lang: MarketingLang }) {
  const t = (text: string) => isolateLatin(text, lang);
  return (
    <>
      {/* Header */}
      <section className="border-border border-b">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <div className="flex justify-center">
            <Eyebrow>{copy.header.eyebrow}</Eyebrow>
          </div>
          <h1 className={`mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl ${arabicHeading}`}>{copy.header.title}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-balance text-lg text-muted-foreground leading-relaxed">{t(copy.header.body)}</p>
        </div>
      </section>

      {/* Plans */}
      <section className="mx-auto grid max-w-4xl grid-cols-1 gap-6 px-6 py-16 sm:grid-cols-2">
        <div className="flex flex-col rounded-xl border border-primary/30 bg-card p-8 shadow-lg shadow-black/[0.06] ring-1 ring-primary/20">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold text-lg">
              <Cloud className="size-5 text-primary" /> {copy.cloud.name}
            </h2>
            <span className="rounded-full bg-primary px-2.5 py-0.5 font-medium text-primary-foreground text-xs">{copy.cloud.badge}</span>
          </div>
          <Price amount={PRICING_FACTS.priceUsd.cloud} />
          <p className="mt-1 text-muted-foreground text-sm">{copy.cloud.priceNote}</p>
          <ul className="mt-6 space-y-3 text-sm">
            {copy.cloud.points.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{t(item)}</span>
              </li>
            ))}
          </ul>
          <a className={`${primaryButton} mt-7`} href={copy.cloud.cta.href}>
            {copy.cloud.cta.label} <ArrowRight className={arrow} />
          </a>
          <p className="mt-3 text-center text-muted-foreground text-xs">{copy.cloud.footnote}</p>
        </div>
        <div className="flex flex-col rounded-xl border border-border bg-card p-8">
          <h2 className="flex items-center gap-2 font-semibold text-lg">
            <Server className="size-5 text-primary" /> {copy.selfHosted.name}
          </h2>
          <Price amount={PRICING_FACTS.priceUsd.selfHosted} />
          <p className="mt-1 text-muted-foreground text-sm">{t(copy.selfHosted.priceNote)}</p>
          <ul className="mt-6 space-y-3 text-sm">
            {copy.selfHosted.points.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{t(item)}</span>
              </li>
            ))}
          </ul>
          <a className={`${outlineButton} mt-4`} href={copy.selfHosted.cta.href}>
            {copy.selfHosted.cta.label} <ArrowRight className={arrow} />
          </a>
        </div>
      </section>

      {/* Feature comparison */}
      <section className="border-border border-y bg-card/40">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <div className="flex flex-col items-center text-center">
            <Eyebrow>{copy.included.eyebrow}</Eyebrow>
            <h2 className={`mt-4 font-semibold text-3xl tracking-tight ${arabicHeading}`}>{copy.included.title}</h2>
            {/* One lead sentence, then the availability notes as a short list rather than one dense paragraph (P3-MKT-007). */}
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{copy.included.lead}</p>
            <ul className="mx-auto mt-4 grid max-w-xl list-disc gap-1.5 ps-5 text-start text-muted-foreground text-sm leading-relaxed">
              {copy.included.notes.map((note) => (
                <li key={note}>{t(note)}</li>
              ))}
            </ul>
          </div>
          {/* A real table (plans as column headers, features as row headers), styled
              as the grid it replaced. Fixed layout keeps the 1.6 : 1 : 1 columns and
              lets long cells wrap, so it fits a phone without scrolling. The first and
              last cells carry the row's side padding; the 1rem gap is split between
              neighbours. In Arabic the columns mirror with the page direction. */}
          <div className="mt-12 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <table className="w-full table-fixed border-collapse text-sm">
              <caption className="sr-only">{copy.included.title}</caption>
              <colgroup>
                <col className="w-[44.44%]" />
                <col className="w-[27.78%]" />
                <col className="w-[27.78%]" />
              </colgroup>
              <thead>
                <tr className="border-border border-b bg-muted/40 font-medium">
                  <td className="py-3 ps-6 pe-2" />
                  <th scope="col" className="px-2 py-3 text-center font-medium">
                    {copy.cloud.name}
                  </th>
                  <th scope="col" className="py-3 ps-2 pe-6 text-center font-medium">
                    {copy.selfHosted.name}
                  </th>
                </tr>
              </thead>
              {copy.included.groups.map((group) => (
                <tbody key={group.title} className="group">
                  <tr className="border-border border-b bg-muted/20">
                    <th
                      scope="rowgroup"
                      colSpan={3}
                      className="px-6 py-2 text-start font-medium text-muted-foreground text-xs uppercase tracking-wider rtl:tracking-normal"
                    >
                      {t(group.title)}
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.label} className="border-border border-b group-last:last:border-b-0">
                      <th scope="row" className="py-3.5 ps-6 pe-2 text-start align-middle font-normal">
                        {t(row.label)}
                      </th>
                      <td className="px-2 py-3.5 align-middle">
                        <CellValue value={row.cloud} includedLabel={copy.included.includedLabel} lang={lang} />
                      </td>
                      <td className="py-3.5 ps-2 pe-6 align-middle">
                        <CellValue value={row.self} includedLabel={copy.included.includedLabel} lang={lang} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      </section>

      {/* Beta transparency */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <Eyebrow>{copy.finePrint.eyebrow}</Eyebrow>
          <h2 className={`mt-4 font-semibold text-3xl tracking-tight ${arabicHeading}`}>{copy.finePrint.title}</h2>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {copy.finePrint.items.map((item, index) => {
            const Icon = finePrintIcons[index] ?? ShieldCheck;
            return (
              <div key={item.title} className="rounded-xl border border-border bg-card p-6">
                <span className="grid size-10 place-items-center rounded-lg border border-border bg-background text-primary">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-4 font-semibold">{item.title}</h3>
                <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{t(item.body)}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-6 pb-20" id="faq">
        <div className="flex flex-col items-center text-center">
          <Eyebrow>{copy.faq.eyebrow}</Eyebrow>
          <h2 className={`mt-4 font-semibold text-3xl tracking-tight sm:text-4xl ${arabicHeading}`}>{copy.faq.title}</h2>
        </div>
        <div className="mt-12 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {copy.faq.items.map((item) => (
            <details key={item.q} className="group px-6 py-1 open:bg-muted/30">
              <summary className="flex list-none items-center justify-between gap-4 py-4 font-medium">
                <span>{t(item.q)}</span>
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="pb-4 text-muted-foreground text-sm leading-relaxed">{t(item.a)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground px-8 py-14 text-center text-background">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.12]"
            style={{ backgroundImage: 'radial-gradient(var(--background) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
            aria-hidden="true"
          />
          <div className="relative">
            <h2 className={`font-semibold text-3xl tracking-tight ${arabicHeading}`}>{copy.finalCta.title}</h2>
            <p className="mx-auto mt-3 max-w-xl text-background/75">{copy.finalCta.body}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a className={primaryButton} href={copy.finalCta.primary.href}>
                {copy.finalCta.primary.label} <ArrowRight className={arrow} />
              </a>
              <a className={invertedOutlineButton} href={copy.finalCta.secondary.href}>
                {copy.finalCta.secondary.label}
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
