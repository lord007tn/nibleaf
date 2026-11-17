import { ArrowRight, Boxes, DatabaseBackup, Network, PackageCheck } from 'lucide-react';
import type { MarketingLang, SelfHostingCopy } from './copy/types';
import { isolateLatin } from './site/isolate-latin';
import { Eyebrow, outlineButton } from './site/primitives';

const architectureIcons = [Boxes, DatabaseBackup, PackageCheck, Network];

/** Arabic headings keep normal tracking and a taller line: tight tracking breaks up joined letters. */
const arabicHeading = 'rtl:leading-relaxed rtl:tracking-normal';

/**
 * The self-hosting page's sections, in either marketing language:
 * `/self-hosting` and `/ar/self-hosting` render this with their own copy and shell.
 */
export function SelfHostingView({ copy, lang }: { copy: SelfHostingCopy; lang: MarketingLang }) {
  const t = (text: string) => isolateLatin(text, lang);
  return (
    <>
      <section className="border-border border-b">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <Eyebrow>{copy.header.eyebrow}</Eyebrow>
          <h1 className={`mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl ${arabicHeading}`}>{t(copy.header.title)}</h1>
          <p className="mt-4 text-lg text-muted-foreground leading-relaxed">{t(copy.header.body)}</p>
          <div className="mt-8 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6">
            <h2 className="font-semibold text-xl">{copy.header.checksTitle}</h2>
            {/* Full-strength text: muted grey on the green tint was 4.1:1 (MKT-006). */}
            <ul className="mt-4 space-y-2 text-foreground text-sm leading-relaxed">
              {copy.header.checks.map((check) => (
                <li key={check}>{t(check)}</li>
              ))}
            </ul>
          </div>
          <div className="mt-8 flex flex-col items-start gap-3">
            <a className={outlineButton} href={copy.header.guide.href}>
              {copy.header.guide.label} <ArrowRight className="size-4 rtl:rotate-180" />
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20" aria-labelledby="deployment-architecture">
        <h2 className={`font-semibold text-3xl tracking-tight ${arabicHeading}`} id="deployment-architecture">
          {copy.architecture.title}
        </h2>
        <p className="mt-4 max-w-3xl text-muted-foreground leading-relaxed">{t(copy.architecture.body)}</p>
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {copy.architecture.items.map((item, index) => {
            const Icon = architectureIcons[index] ?? Boxes;
            return (
              <article className="rounded-xl border border-border bg-card p-6" key={item.title}>
                <Icon aria-hidden="true" className="size-5 text-primary" />
                <h3 className="mt-4 font-semibold text-lg">{t(item.title)}</h3>
                <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{t(item.body)}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="border-border border-y bg-card/40">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <h2 className={`font-semibold text-3xl tracking-tight ${arabicHeading}`}>{copy.verify.title}</h2>
          {copy.verify.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-4 text-muted-foreground leading-relaxed">
              {t(paragraph)}
            </p>
          ))}
        </div>
      </section>
    </>
  );
}
