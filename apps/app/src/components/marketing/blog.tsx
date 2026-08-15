import { NibleafMark } from '@nibleaf/design-system/brand';
import { ArrowLeft, ArrowRight, Check, Clock, Link2, Search } from 'lucide-react';
import { type ComponentType, type ReactNode, useEffect, useState } from 'react';
import { Eyebrow, invertedOutlineButton, MarketingShell, primaryButton } from '@/components/cloud-marketing';
import { type BlogEntry, type BlogFaq, blogEntry, blogLanguage, blogReadingMinutes } from '@/lib/blog';
import { breadcrumbLd, canonicalHref, faqLd, pageMeta } from '@/lib/marketing-seo';

const dateFormatter = (entry: BlogEntry) =>
  new Intl.DateTimeFormat(blogLanguage(entry) === 'ar' ? 'ar' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Standard <head> payload for a blog article: SEO meta with og:type article,
 * Article JSON-LD with real dates, breadcrumbs, and — when the frontmatter has
 * FAQs — FAQPage schema built from the same data the page renders.
 */
export function articleHead(entry: BlogEntry) {
  const path = `/blog/${entry.slug}`;
  const language = blogLanguage(entry);
  const arabic = language === 'ar';
  const translation = entry.translationOf ? blogEntry(entry.translationOf) : undefined;
  const imagePath = arabic ? '/brand/raster/social/nibleaf-og-card-ar.png' : '/brand/raster/social/nibleaf-og-card.png';
  const scripts = [
    {
      type: 'application/ld+json',
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: entry.title,
        description: entry.description,
        datePublished: entry.datePublished,
        dateModified: entry.dateModified,
        inLanguage: language,
        mainEntityOfPage: canonicalHref(path),
        image: canonicalHref(imagePath),
        author: { '@type': 'Organization', name: 'Nibleaf', url: canonicalHref('/about') },
        publisher: {
          '@type': 'Organization',
          name: 'Nibleaf',
          logo: { '@type': 'ImageObject', url: canonicalHref('/brand/raster/logo/nibleaf-logo-horizontal-ltr.png') },
        },
      }),
    },
    breadcrumbLd([
      { name: arabic ? 'الرئيسية' : 'Home', path: '/' },
      { name: arabic ? 'المدونة' : 'Blog', path: '/blog' },
      { name: entry.title, path },
    ]),
    ...(entry.faqs && entry.faqs.length > 0 ? [faqLd(entry.faqs.map((f) => ({ q: f.question, a: f.answer })))] : []),
  ];
  return {
    meta: pageMeta({
      title: entry.metaTitle ?? `${entry.title} | Nibleaf`,
      description: entry.description,
      path,
      type: 'article',
      locale: arabic ? 'ar_AR' : 'en_US',
      imagePath,
      imageAlt: arabic ? `Nibleaf: ${entry.title}` : undefined,
    }),
    links: [
      { rel: 'canonical', href: canonicalHref(path) },
      ...(translation
        ? [
            { rel: 'alternate', hreflang: language, href: canonicalHref(path) },
            { rel: 'alternate', hreflang: blogLanguage(translation), href: canonicalHref(`/blog/${translation.slug}`) },
            {
              rel: 'alternate',
              hreflang: 'x-default',
              href: canonicalHref(`/blog/${language === 'en' ? entry.slug : translation.slug}`),
            },
          ]
        : []),
    ],
    scripts,
  };
}

/** Deterministic soft gradient per article — no cover-art pipeline, never a broken <img>. */
const GRADIENTS = [
  'from-primary/15 via-card to-muted',
  'from-primary/10 via-muted/60 to-card',
  'from-muted via-card to-primary/10',
  'from-primary/20 via-card to-card',
];
const gradientFor = (slug: string) => GRADIENTS[[...slug].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % GRADIENTS.length];

function CoverPanel({ entry, className }: { className: string; entry: BlogEntry }) {
  return (
    <div className={`${className} relative flex items-center justify-center overflow-hidden bg-gradient-to-br ${gradientFor(entry.slug)}`}>
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'radial-gradient(ellipse at center, black, transparent 75%)',
        }}
        aria-hidden="true"
      />
      <div className="grid size-12 place-items-center rounded-xl border border-border bg-background/70 backdrop-blur-sm">
        <NibleafMark className="size-6" />
      </div>
    </div>
  );
}

function CardMeta({ entry }: { entry: BlogEntry }) {
  const arabic = blogLanguage(entry) === 'ar';
  return (
    <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
      <time dateTime={entry.datePublished}>{dateFormatter(entry).format(new Date(entry.datePublished))}</time>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1">
        <Clock aria-hidden="true" className="size-3.5" />
        {arabic ? `${blogReadingMinutes(entry)} دقائق` : `${blogReadingMinutes(entry)} min read`}
      </span>
    </div>
  );
}

function TagChips({ entry }: { entry: BlogEntry }) {
  if (!entry.tags?.length) {
    return null;
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {entry.tags.slice(0, 3).map((tag) => (
        <span key={tag} className="rounded-full border border-border bg-background px-2.5 py-0.5 font-medium text-muted-foreground text-xs">
          {tag}
        </span>
      ))}
    </div>
  );
}

/** The one editorial card shared by the index and the "read next" rail. */
export function ArticleCard({ entry, featured = false }: { entry: BlogEntry; featured?: boolean }) {
  const language = blogLanguage(entry);
  const direction = language === 'ar' ? 'rtl' : 'ltr';
  if (featured) {
    return (
      <article dir={direction} lang={language}>
        <a
          className="group grid overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-colors hover:border-primary/40 md:grid-cols-2"
          href={`/blog/${entry.slug}`}
        >
          <CoverPanel className="aspect-[16/10] w-full md:aspect-auto md:h-full md:min-h-[260px]" entry={entry} />
          <div className="flex flex-col justify-center p-7 md:p-9">
            <TagChips entry={entry} />
            <h2 className="text-pretty font-semibold text-2xl tracking-tight transition-colors group-hover:text-primary rtl:tracking-normal sm:text-3xl">
              {entry.title}
            </h2>
            <p className="mt-3 mb-5 max-w-[48ch] text-muted-foreground text-sm leading-relaxed sm:text-[15px]">{entry.description}</p>
            <CardMeta entry={entry} />
          </div>
        </a>
      </article>
    );
  }
  return (
    <article className="h-full" dir={direction} lang={language}>
      <a
        className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs transition-colors hover:border-primary/40"
        href={`/blog/${entry.slug}`}
      >
        <CoverPanel className="aspect-[16/9] w-full shrink-0" entry={entry} />
        <div className="flex flex-1 flex-col p-6">
          <TagChips entry={entry} />
          <h3 className="font-semibold text-lg leading-snug tracking-tight transition-colors group-hover:text-primary rtl:tracking-normal">
            {entry.title}
          </h3>
          <p className="mt-2 mb-4 line-clamp-3 text-muted-foreground text-sm leading-relaxed">{entry.description}</p>
          <CardMeta entry={entry} />
        </div>
      </a>
    </article>
  );
}

/**
 * Blog index: a featured lead card, a responsive card grid, and a client-side
 * search over the in-memory corpus. Filter state never touches browser globals,
 * so the initial (unfiltered) render is identical on server and client.
 */
export function BlogIndexPage({ entries, stars = 0 }: { entries: BlogEntry[]; stars?: number }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered =
    q === ''
      ? entries
      : entries.filter(
          (entry) =>
            entry.title.toLowerCase().includes(q) ||
            entry.description.toLowerCase().includes(q) ||
            (entry.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
        );
  const featured = q === '' ? filtered[0] : undefined;
  const grid = q === '' ? filtered.slice(1) : filtered;

  return (
    <MarketingShell stars={stars}>
      <section className="border-border border-b">
        <div className="mx-auto max-w-6xl px-6 pt-16 pb-10">
          <Eyebrow>Blog</Eyebrow>
          <div className="mt-4 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="max-w-2xl text-balance font-semibold text-4xl tracking-tight sm:text-5xl">
                Product documentation, search, and ownership
              </h1>
              <p className="mt-4 max-w-2xl text-lg text-muted-foreground leading-relaxed">
                Guides and notes from building Nibleaf: deployment architecture, Markdown, bilingual documentation, and source-backed looks at the
                docs tooling landscape.
              </p>
            </div>
            <div className="relative w-full md:w-72">
              <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <label className="sr-only" htmlFor="blog-search">
                Search articles
              </label>
              <input
                className="h-10 w-full rounded-md border border-input bg-transparent ps-9 pe-3 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                id="blog-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search articles…"
                type="search"
                value={query}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        {featured ? (
          <div className="mb-6">
            <ArticleCard entry={featured} featured />
          </div>
        ) : null}
        {grid.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {grid.map((entry) => (
              <ArticleCard entry={entry} key={entry.slug} />
            ))}
          </div>
        ) : null}
        {grid.length === 0 && !featured ? (
          <div className="rounded-xl border border-border border-dashed bg-card px-6 py-16 text-center">
            <p className="text-muted-foreground text-sm">No articles match “{query}”. Try another search.</p>
          </div>
        ) : null}
      </section>
      <BlogCta />
    </MarketingShell>
  );
}

/** Callout box for a caveat or an aside that should not read as body copy. */
export function Callout({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <aside className="my-6 rounded-xl border border-border border-s-2 border-s-primary bg-card px-5 py-4">
      {title ? <p className="mb-1 font-semibold text-foreground text-sm">{title}</p> : null}
      <div className="text-muted-foreground text-sm leading-relaxed [&>p:last-child]:mb-0 [&>p]:mb-2">{children}</div>
    </aside>
  );
}

/** A muted source/estimate note under a table or figure. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="my-4 text-muted-foreground text-[13px]">{children}</p>;
}

/** Components every MDX article can use without importing them. */
// biome-ignore lint/suspicious/noExplicitAny: MDX component maps are untyped by design.
export const articleMdxComponents: Record<string, ComponentType<any>> = { Callout, Note };

function ArticleFaqSection({ faqs, language }: { faqs: BlogFaq[]; language: 'ar' | 'en' }) {
  return (
    <section className="mt-12">
      <h2 className="mb-4 border-border border-b pb-3 font-semibold text-2xl tracking-tight rtl:tracking-normal">
        {language === 'ar' ? 'أسئلة شائعة' : 'Frequently asked questions'}
      </h2>
      <dl className="flex flex-col gap-5">
        {faqs.map((faq) => (
          <div key={faq.question}>
            <dt className="mb-1 font-semibold text-[15px]">{faq.question}</dt>
            <dd className="ms-0 text-muted-foreground text-sm leading-relaxed">{faq.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BlogCta({ language = 'en' }: { language?: 'ar' | 'en' }) {
  const arabic = language === 'ar';
  return (
    <section className="mx-auto max-w-5xl px-6 pb-24">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-foreground px-8 py-14 text-center text-background">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{ backgroundImage: 'radial-gradient(var(--background) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
          aria-hidden="true"
        />
        <div className="relative">
          <h2 className="font-semibold text-3xl tracking-tight rtl:tracking-normal">
            {arabic ? 'انشر وثائق واضحة بالعربية والإنجليزية' : 'Ship docs your users will love'}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-background/75">
            {arabic
              ? 'جرّب Nibleaf Cloud مجانًا، أو شغّل المنصة مفتوحة المصدر على خادمك.'
              : 'Start free on Nibleaf Cloud, and check the distribution status before planning self-hosting.'}
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <a className={primaryButton} href="/sign-up">
              {arabic ? 'ابدأ مجانًا' : 'Get started free'} <ArrowRight className="size-4 rtl:rotate-180" />
            </a>
            <a className={invertedOutlineButton} href="/self-hosting">
              {arabic ? 'حالة الاستضافة الذاتية' : 'Self-hosting status'}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

const shareButton =
  'inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground';

function ShareRow({ entry }: { entry: BlogEntry }) {
  const shareUrl = canonicalHref(`/blog/${entry.slug}`);
  const arabic = blogLanguage(entry) === 'ar';
  const [copied, setCopied] = useState(false);
  // navigator is undefined during SSR — enable clipboard affordance after mount
  // so server and client render identically.
  const [canCopy, setCanCopy] = useState(false);
  useEffect(() => {
    setCanCopy(typeof navigator !== 'undefined' && Boolean(navigator.clipboard));
  }, []);

  const copyLink = () => {
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard permission denied — leave the button in its resting state.
      });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="me-1 text-muted-foreground text-xs">{arabic ? 'مشاركة' : 'Share'}</span>
      {canCopy ? (
        <button
          aria-label={copied ? (arabic ? 'نُسخ الرابط' : 'Link copied') : arabic ? 'نسخ رابط المقال' : 'Copy article link'}
          className={shareButton}
          onClick={copyLink}
          type="button"
        >
          {copied ? <Check aria-hidden="true" className="size-4 text-primary" /> : <Link2 aria-hidden="true" className="size-4" />}
        </button>
      ) : null}
      <a
        className={shareButton}
        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(entry.title)}&url=${encodeURIComponent(shareUrl)}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        <span className="sr-only">{arabic ? 'مشاركة على X' : 'Share on X'}</span>
        <svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>
      <a
        className={shareButton}
        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        <span className="sr-only">{arabic ? 'مشاركة على LinkedIn' : 'Share on LinkedIn'}</span>
        <svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
        </svg>
      </a>
    </div>
  );
}

/** Document typography for the MDX body — theme-aware, matches the marketing pages. */
const proseClass = [
  'text-[15px] leading-relaxed text-foreground/90',
  '[&_p]:mt-0 [&_p]:mb-4',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-primary/80',
  '[&_strong]:font-semibold [&_strong]:text-foreground',
  '[&_h2]:mt-12 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-2.5 [&_h2]:font-semibold [&_h2]:text-2xl [&_h2:first-child]:mt-0',
  '[&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-lg',
  '[&_ul]:mt-0 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:mt-0 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:ps-5 [&_li]:mb-1.5',
  '[&_blockquote]:my-5 [&_blockquote]:border-s-2 [&_blockquote]:border-primary/50 [&_blockquote]:ps-4 [&_blockquote]:text-muted-foreground',
  // Inline code
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:border [&_:not(pre)>code]:border-border [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[13px] [&_:not(pre)>code]:[direction:ltr] [&_:not(pre)>code]:[unicode-bidi:isolate]',
  // Code blocks — terminal-dark like the self-hosting page, in both themes.
  '[&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-[#0d1117] [&_pre]:p-5 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_pre]:text-white/90 [&_pre]:[direction:ltr] [&_pre]:text-left',
  // Tables inside a scroll container courtesy of GFM output
  '[&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm',
  '[&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-start [&_th]:font-semibold',
  '[&_td]:border [&_td]:border-border [&_td]:px-4 [&_td]:py-2.5 [&_td]:align-top',
  '[&_hr]:my-8 [&_hr]:border-border',
].join(' ');

/**
 * Shared article shell: back link, header with real dates + reading time +
 * byline, share row, the MDX body in document typography, the frontmatter FAQ,
 * a "read next" rail, then the marketing CTA.
 */
export function ArticlePage({ children, entry, stars = 0 }: { children: ReactNode; entry: BlogEntry; stars?: number }) {
  const related = (entry.related ?? []).map(blogEntry).filter((item): item is BlogEntry => Boolean(item));
  const language = blogLanguage(entry);
  const arabic = language === 'ar';
  return (
    <MarketingShell stars={stars}>
      <article
        className="mx-auto max-w-3xl px-6 pt-12 pb-20"
        dir={arabic ? 'rtl' : 'ltr'}
        itemScope
        itemType="https://schema.org/BlogPosting"
        lang={language}
      >
        <a className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground" href="/blog">
          <ArrowLeft className="size-4 rtl:rotate-180" /> {arabic ? 'كل المقالات' : 'All articles'}
        </a>
        <header className="mt-6">
          <TagChips entry={entry} />
          <h1 className={`text-pretty font-semibold text-4xl leading-[1.15] sm:text-[44px] ${arabic ? '' : 'tracking-tight'}`} itemProp="headline">
            {entry.title}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground leading-relaxed" itemProp="description">
            {entry.description}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-border border-y py-4">
            <p className="text-muted-foreground text-sm">
              <time className="datePublished" dateTime={entry.datePublished} itemProp="datePublished">
                {arabic ? 'نُشر' : 'Published'} {dateFormatter(entry).format(new Date(entry.datePublished))}
              </time>
              {entry.dateModified !== entry.datePublished ? (
                <>
                  {' · '}
                  <time dateTime={entry.dateModified} itemProp="dateModified">
                    {arabic ? 'آخر تحديث' : 'Updated'} {dateFormatter(entry).format(new Date(entry.dateModified))}
                  </time>
                </>
              ) : null}
              {' · '}
              {arabic ? `${blogReadingMinutes(entry)} دقائق قراءة` : `${blogReadingMinutes(entry)} min read`}
              {' · '}
              {arabic ? 'بقلم ' : 'By '}
              <a className="author font-medium text-foreground hover:underline" href="/about" rel="author">
                {arabic ? 'فريق Nibleaf' : 'The Nibleaf team'}
              </a>
            </p>
            <ShareRow entry={entry} />
          </div>
        </header>
        <div className={`mt-10 ${proseClass}`} itemProp="articleBody">
          {children}
        </div>
        {entry.faqs && entry.faqs.length > 0 ? <ArticleFaqSection faqs={entry.faqs} language={language} /> : null}
      </article>
      {related.length > 0 ? (
        <aside className="mx-auto max-w-6xl px-6 pb-16">
          <h2 className={`mb-5 font-semibold text-xl ${arabic ? '' : 'tracking-tight'}`}>{arabic ? 'اقرأ أيضًا' : 'Read next'}</h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((item) => (
              <ArticleCard entry={item} key={item.slug} />
            ))}
          </div>
        </aside>
      ) : null}
      <BlogCta language={language} />
    </MarketingShell>
  );
}
