import { ArrowRight, BookOpen, CheckCircle2, Compass, Languages } from 'lucide-react';
import { useState } from 'react';
import { Eyebrow, MarketingShell, outlineButton, primaryButton } from '@/components/cloud-marketing';
import { ArabicShell } from '@/components/marketing/arabic-seo';
import { GUIDE_PILLARS, GUIDES, type GuideLocale, guidePillar } from '@/lib/guides';

const copy = {
  en: {
    eyebrow: 'Nibleaf guide academy',
    title: 'Make the next documentation decision with evidence',
    intro:
      'Neutral, task-complete guides for choosing, migrating, operating, and publishing documentation. Each answer works without Nibleaf; product-specific paths appear only after the decision method.',
    featured: 'Start with a foundational answer',
    browse: 'Browse by job',
    all: 'All guides',
    jobs: { choose: 'Choose a stack', design: 'Design the system', migrate: 'Migrate', operate: 'Operate', publish: 'Publish & improve' },
    read: 'Open guide',
    english: 'Full guide in English',
    next: 'Next step',
    paths: 'Learning paths by topic',
    sources: 'Methods use dated primary sources and reproducible checks. Claims about a tool are bounded to the cited version or source state.',
    ctaTitle: 'Need the product-specific implementation?',
    ctaBody: 'Use the public Nibleaf documentation after you have chosen the right workflow and operating model.',
    docs: 'Read Nibleaf docs',
    selfHost: 'Review self-hosting',
  },
  ar: {
    eyebrow: 'أكاديمية أدلة Nibleaf',
    title: 'اتخذ قرار التوثيق التالي بناءً على دليل',
    intro:
      'أدلة محايدة ومكتملة لاختيار التوثيق وترحيله وتشغيله ونشره. تعمل الإجابة من دون Nibleaf، ولا يظهر المسار الخاص بالمنتج إلا بعد منهج القرار.',
    featured: 'ابدأ بإجابة تأسيسية',
    browse: 'تصفح حسب المهمة',
    all: 'كل الأدلة',
    jobs: { choose: 'اختيار المنظومة', design: 'تصميم النظام', migrate: 'الترحيل', operate: 'التشغيل', publish: 'النشر والتحسين' },
    read: 'فتح الدليل',
    english: 'الدليل الكامل بالإنجليزية',
    next: 'الخطوة التالية',
    paths: 'مسارات التعلم حسب الموضوع',
    sources: 'تعتمد المناهج على مصادر أولية مؤرخة وفحوص قابلة للتكرار. كل ادعاء عن أداة مقيد بالإصدار أو حالة المصدر المذكورة.',
    ctaTitle: 'هل تحتاج إلى التطبيق الخاص بالمنتج؟',
    ctaBody: 'استخدم توثيق Nibleaf العام بعد اختيار سير العمل ونموذج التشغيل المناسبين.',
    docs: 'قراءة توثيق Nibleaf',
    selfHost: 'مراجعة الاستضافة الذاتية',
  },
} as const;

type Job = keyof (typeof copy)['en']['jobs'];

function guideCountLabel(count: number, locale: GuideLocale) {
  if (locale === 'ar') return count === 1 ? 'دليل واحد' : count === 2 ? 'دليلان' : `${count} أدلة`;
  return `${count} ${count === 1 ? 'guide' : 'guides'}`;
}

export function GuidesHub({ locale, stars = 0 }: { locale: GuideLocale; stars?: number }) {
  const t = copy[locale];
  const [job, setJob] = useState<Job | 'all'>('all');
  const featured = GUIDES.filter((guide) => guide.featured);
  const visible = job === 'all' ? GUIDES : GUIDES.filter((guide) => guide.job === job);

  const content = (
    <>
      <section className="border-border border-b bg-muted/20">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <Eyebrow>{t.eyebrow}</Eyebrow>
          <h1 className="mt-4 max-w-4xl text-balance font-semibold text-4xl tracking-tight rtl:tracking-normal sm:text-6xl">{t.title}</h1>
          <p className="mt-5 max-w-3xl text-lg text-muted-foreground leading-relaxed">{t.intro}</p>
          <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-muted-foreground text-xs">
            <CheckCircle2 className="size-3.5 text-primary" aria-hidden /> {t.sources}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="font-semibold text-2xl tracking-tight rtl:tracking-normal">{t.featured}</h2>
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          {featured.map((guide) => (
            <a
              className="group flex min-h-64 flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/45"
              href={guide.href[locale]}
              key={guide.id}
            >
              <span className="text-primary text-xs font-semibold uppercase tracking-wider rtl:tracking-normal">
                {guidePillar(guide.pillar)?.[locale]}
              </span>
              <h3 className="mt-4 text-balance font-semibold text-2xl tracking-tight transition-colors group-hover:text-primary rtl:tracking-normal">
                {guide.title[locale]}
              </h3>
              <p className="mt-3 text-muted-foreground text-sm leading-relaxed">{guide.summary[locale]}</p>
              <span className="mt-auto inline-flex items-center gap-1.5 pt-6 font-medium text-sm">
                {t.read} <ArrowRight className="size-4 rtl:rotate-180" />
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="border-border border-y bg-muted/20">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <h2 className="font-semibold text-2xl tracking-tight rtl:tracking-normal">{t.browse}</h2>
          <fieldset className="mt-5 flex flex-wrap gap-2" aria-label={t.browse}>
            <button className={job === 'all' ? primaryButton : outlineButton} onClick={() => setJob('all')} type="button">
              {t.all}
            </button>
            {(Object.keys(t.jobs) as Job[]).map((value) => (
              <button className={job === value ? primaryButton : outlineButton} key={value} onClick={() => setJob(value)} type="button">
                {t.jobs[value]}
              </button>
            ))}
          </fieldset>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {visible.map((guide) => (
              <article className="flex flex-col rounded-xl border border-border bg-background p-5" key={guide.id}>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-primary text-xs font-semibold">{guidePillar(guide.pillar)?.[locale]}</span>
                  {locale === 'ar' && guide.language === 'en' ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                      <Languages className="size-3.5" /> {t.english}
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-2 font-semibold text-lg">{guide.title[locale]}</h3>
                <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{guide.summary[locale]}</p>
                <p className="mt-4 border-border border-t pt-4 text-sm">
                  <strong>{t.next}:</strong> {guide.next[locale]}
                </p>
                <a className="mt-4 inline-flex items-center gap-1.5 font-medium text-primary text-sm" href={guide.href[locale]}>
                  {t.read} <ArrowRight className="size-4 rtl:rotate-180" />
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex items-center gap-3">
          <Compass className="size-5 text-primary" />
          <h2 className="font-semibold text-2xl tracking-tight rtl:tracking-normal">{t.paths}</h2>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GUIDE_PILLARS.map((pillar) => (
            <div className="rounded-xl border border-border p-4" key={pillar.id}>
              <p className="font-semibold text-sm">{pillar[locale]}</p>
              <p className="mt-1 text-muted-foreground text-xs">
                {guideCountLabel(GUIDES.filter((guide) => guide.pillar === pillar.id).length, locale)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="rounded-2xl border border-border bg-foreground px-8 py-12 text-background">
          <BookOpen className="size-6" aria-hidden />
          <h2 className="mt-4 font-semibold text-3xl tracking-tight rtl:tracking-normal">{t.ctaTitle}</h2>
          <p className="mt-3 max-w-2xl text-background/75">{t.ctaBody}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a className={primaryButton} href="https://docs.nibleaf.com">
              {t.docs}
            </a>
            <a
              className="inline-flex h-10 items-center rounded-md border border-background/25 px-4 font-medium text-sm hover:bg-background/10"
              href="/self-hosting"
            >
              {t.selfHost}
            </a>
          </div>
        </div>
      </section>
    </>
  );

  return locale === 'ar' ? <ArabicShell englishHref="/guides">{content}</ArabicShell> : <MarketingShell stars={stars}>{content}</MarketingShell>;
}
