import { NibleafMark } from '@nibleaf/design-system/brand';
import { ArrowRight, Check, ExternalLink, Minus, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Eyebrow, MarketingShell, outlineButton, primaryButton } from '@/components/cloud-marketing';
import type { AlternativesRoundup, Comparison, FaqEntry, FeatureCell, FeatureRow, PickReasons, PricingTable } from '@/lib/comparison-data';
import { nibleafPricing } from '@/lib/comparison-data';
import { GITHUB_URL } from '@/lib/links';

/**
 * Shared page templates for the /compare/nibleaf-vs-* and /alternatives/*
 * SEO pages. Layout and tokens follow cloud-marketing.tsx; all copy and
 * numbers come from lib/comparison-data.ts so claims stay dated and sourced.
 */

export function ComparePage({ data, stars = 0 }: { data: Comparison; stars?: number }) {
  return (
    <MarketingShell stars={stars}>
      <PageHero eyebrow="Comparison" heading={data.heading} paragraphs={data.directAnswer} asOf={data.competitorPricing.asOf} />
      <PricingSection competitor={data.competitorPricing} />
      <FeatureMatrix competitorName={data.competitorName} rows={data.features} />
      <WhenToPick pickCompetitor={data.pickCompetitor} pickNibleaf={data.pickNibleaf} />
      <VerdictSection paragraphs={data.verdict} />
      <FaqSection faqs={data.faqs} />
      <MarketingCta />
    </MarketingShell>
  );
}

export function AlternativesPage({ data, stars = 0 }: { data: AlternativesRoundup; stars?: number }) {
  return (
    <MarketingShell stars={stars}>
      <PageHero eyebrow="Alternatives" heading={data.heading} paragraphs={data.directAnswer} asOf={data.competitorPricing.asOf} />
      <section className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="font-semibold text-3xl tracking-tight">The alternatives, honestly</h2>
        <ol className="mt-10 space-y-6">
          {data.alternatives.map((alt, i) => (
            <li
              key={alt.name}
              className={`rounded-xl border bg-card p-7 ${alt.isNibleaf ? 'border-primary/30 ring-1 ring-primary/20' : 'border-border'}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono font-semibold text-2xl text-muted-foreground/40 leading-none">{`0${i + 1}`}</span>
                <h3 className="flex items-center gap-2 font-semibold text-lg tracking-tight">
                  {alt.isNibleaf ? <NibleafMark className="size-5" /> : null}
                  {alt.name}
                </h3>
                {alt.isNibleaf ? (
                  <span className="rounded-full bg-primary px-2.5 py-0.5 font-medium text-primary-foreground text-xs">Our product</span>
                ) : (
                  <a
                    className="inline-flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
                    href={alt.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {alt.url.replace(/^https?:\/\//, '')} <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <p className="mt-3 text-muted-foreground text-sm leading-relaxed">{alt.description}</p>
              <p className="mt-3 text-sm">
                <span className="font-medium">Best for:</span> <span className="text-muted-foreground">{alt.bestFor}</span>
              </p>
            </li>
          ))}
        </ol>
      </section>
      <PricingSection competitor={data.competitorPricing} headingPrefix={`What ${data.competitorName} costs`} />
      <FaqSection faqs={data.faqs} />
      <MarketingCta />
    </MarketingShell>
  );
}

function PageHero({ eyebrow, heading, paragraphs, asOf }: { eyebrow: string; heading: string; paragraphs: string[]; asOf: string }) {
  return (
    <section className="border-border border-b">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <div className="flex justify-center">
          <Eyebrow>{eyebrow}</Eyebrow>
        </div>
        <h1 className="mt-4 text-balance text-center font-semibold text-4xl tracking-tight sm:text-5xl">{heading}</h1>
        {paragraphs.map((p, i) => (
          <p
            key={p}
            className={`mx-auto mt-5 max-w-2xl leading-relaxed ${i === 0 ? 'text-lg text-muted-foreground' : 'text-muted-foreground text-sm'}`}
          >
            {p}
          </p>
        ))}
        <p className="mx-auto mt-6 max-w-2xl border-border border-t pt-4 text-muted-foreground text-xs leading-relaxed">
          We build Nibleaf, so read this page as an informed but interested party: every price was checked against the vendor’s official pricing page
          as of {asOf} and links to its source, and everything Nibleaf doesn’t do yet is disclosed plainly.
        </p>
      </div>
    </section>
  );
}

function PricingSection({ competitor, headingPrefix }: { competitor: PricingTable; headingPrefix?: string }) {
  return (
    <section className="border-border border-y bg-card/40" id="pricing">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="mt-4 font-semibold text-3xl tracking-tight">{headingPrefix ?? `${competitor.productName} pricing`} vs Nibleaf</h2>
          <p className="mt-3 text-lg text-muted-foreground">
            Numbers below are from the official pricing pages as of {competitor.asOf} — always check the linked source for current figures.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-2">
          <PricingTableView table={competitor} />
          <PricingTableView table={nibleafPricing} />
        </div>
      </div>
    </section>
  );
}

function PricingTableView({ table }: { table: PricingTable }) {
  const external = table.sourceUrl.startsWith('http');
  return (
    <div>
      <h3 className="font-semibold text-lg tracking-tight">{table.productName}</h3>
      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
        <table className="w-full min-w-[26rem] text-start text-sm">
          <thead>
            <tr className="border-border border-b bg-muted/40 text-muted-foreground">
              <th className="px-4 py-3 text-start font-medium">Plan</th>
              <th className="px-4 py-3 text-start font-medium">Price</th>
              <th className="px-4 py-3 text-start font-medium">What you get</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.plan} className="border-border border-b align-top last:border-0">
                <td className="px-4 py-3 font-medium">{row.plan}</td>
                <td className="px-4 py-3 whitespace-nowrap">{row.price}</td>
                <td className="px-4 py-3 text-muted-foreground leading-relaxed">{row.includes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.note ? <p className="mt-3 text-muted-foreground text-xs leading-relaxed">{table.note}</p> : null}
      <p className="mt-2 text-muted-foreground text-xs">
        Source:{' '}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href={table.sourceUrl}
          {...(external ? { rel: 'noreferrer', target: '_blank' } : {})}
        >
          {table.sourceLabel}
        </a>
        , as of {table.asOf}.
      </p>
    </div>
  );
}

function FeatureMatrix({ competitorName, rows }: { competitorName: string; rows: FeatureRow[] }) {
  return (
    <section className="mx-auto max-w-4xl px-6 py-20" id="features">
      <div className="max-w-2xl">
        <Eyebrow>Feature matrix</Eyebrow>
        <h2 className="mt-4 font-semibold text-3xl tracking-tight">Nibleaf vs {competitorName}, feature by feature</h2>
      </div>
      <div className="mt-10 overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-border border-b bg-muted/40">
              <th className="px-5 py-3 text-start font-medium text-muted-foreground">Feature</th>
              <th className="w-40 px-4 py-3 font-medium">
                <span className="flex items-center justify-center gap-1.5">
                  <NibleafMark className="size-4" /> Nibleaf
                </span>
              </th>
              <th className="w-40 px-4 py-3 text-center font-medium text-muted-foreground">{competitorName}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.feature} className="border-border border-b align-top last:border-0">
                <td className="px-5 py-3.5">{row.feature}</td>
                <td className="bg-primary/5 px-4 py-3.5">
                  <FeatureCellView cell={row.nibleaf} />
                </td>
                <td className="px-4 py-3.5">
                  <FeatureCellView cell={row.competitor} muted />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-muted-foreground text-xs leading-relaxed">
        Items marked “Not yet” are on the Nibleaf roadmap — follow progress on{' '}
        <a className="underline underline-offset-2 hover:text-foreground" href={GITHUB_URL} rel="noreferrer" target="_blank">
          GitHub
        </a>
        . “—” means the vendor’s pricing page doesn’t state it either way; check their docs.
      </p>
    </section>
  );
}

function FeatureCellView({ cell, muted = false }: { cell: FeatureCell; muted?: boolean }) {
  const icon: Record<string, ReactNode> = {
    yes: <Check className={`size-4 ${muted ? 'text-muted-foreground' : 'text-primary'}`} aria-hidden="true" />,
    no: <X className="size-4 text-muted-foreground/50" aria-hidden="true" />,
    partial: <Minus className="size-4 text-muted-foreground" aria-hidden="true" />,
  };
  const label: Record<string, string> = { yes: 'Yes', no: 'No', partial: 'Partial', planned: 'Not yet', unknown: '—' };
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      {icon[cell.value] ? (
        <span className="flex items-center gap-1.5">
          {icon[cell.value]}
          <span className="sr-only">{label[cell.value]}</span>
        </span>
      ) : (
        <span className={`font-medium text-xs ${cell.value === 'planned' ? 'text-foreground' : 'text-muted-foreground'}`}>{label[cell.value]}</span>
      )}
      {cell.note ? <span className="text-muted-foreground text-xs leading-snug">{cell.note}</span> : null}
    </div>
  );
}

function WhenToPick({ pickCompetitor, pickNibleaf }: { pickCompetitor: PickReasons; pickNibleaf: PickReasons }) {
  return (
    <section className="border-border border-y bg-card/40" id="when">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <Eyebrow>Choosing</Eyebrow>
          <h2 className="mt-4 font-semibold text-3xl tracking-tight">Which one should you pick?</h2>
          <p className="mt-3 text-lg text-muted-foreground">Both are legitimate choices — it depends on what your team needs today.</p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PickCard pick={pickCompetitor} />
          <PickCard pick={pickNibleaf} featured />
        </div>
      </div>
    </section>
  );
}

function PickCard({ pick, featured = false }: { pick: PickReasons; featured?: boolean }) {
  return (
    <div className={`rounded-xl border bg-card p-7 ${featured ? 'border-primary/30 ring-1 ring-primary/20' : 'border-border'}`}>
      <h3 className="font-semibold text-lg tracking-tight">{pick.title}</h3>
      <ul className="mt-5 space-y-3 text-sm">
        {pick.reasons.map((reason) => (
          <li key={reason} className="flex items-start gap-2.5 leading-relaxed">
            <Check className={`mt-0.5 size-4 shrink-0 ${featured ? 'text-primary' : 'text-muted-foreground'}`} />
            {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VerdictSection({ paragraphs }: { paragraphs: string[] }) {
  return (
    <section className="mx-auto max-w-3xl px-6 py-20" id="verdict">
      <Eyebrow>Our verdict</Eyebrow>
      <h2 className="mt-4 font-semibold text-3xl tracking-tight">The honest bottom line</h2>
      {paragraphs.map((p) => (
        <p key={p} className="mt-5 text-muted-foreground leading-relaxed">
          {p}
        </p>
      ))}
    </section>
  );
}

function FaqSection({ faqs }: { faqs: FaqEntry[] }) {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-24" id="faq">
      <div className="flex flex-col items-center text-center">
        <Eyebrow>FAQ</Eyebrow>
        <h2 className="mt-4 font-semibold text-3xl tracking-tight sm:text-4xl">Frequently asked</h2>
      </div>
      <div className="mt-12 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {faqs.map((item) => (
          <details key={item.q} className="group px-6 py-1 open:bg-muted/30">
            <summary className="flex list-none items-center justify-between gap-4 py-4 font-medium">
              {item.q}
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="pb-4 text-muted-foreground text-sm leading-relaxed">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function MarketingCta() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-24">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground px-8 py-14 text-center text-background">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{ backgroundImage: 'radial-gradient(var(--background) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
          aria-hidden="true"
        />
        <div className="relative">
          <h2 className="font-semibold text-3xl tracking-tight">Try Nibleaf for yourself</h2>
          <p className="mx-auto mt-3 max-w-xl text-background/75">
            Start free on Nibleaf Cloud — no credit card — or run the same open-source platform on your own servers.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <a className={`${primaryButton} group`} href="/sign-up">
              Get started free <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a className={`${outlineButton} border-background/25 bg-transparent text-background hover:bg-background/10`} href="/self-hosting">
              Self-hosting guide
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
