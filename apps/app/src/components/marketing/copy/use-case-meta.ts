import { heroAvailabilityNote } from './availability';
import type { MarketingLang, UseCaseSlug, UseCasesTeaserCopy } from './types';

/** Appends the rollout caption while any AI capability the copy names is still rolling out. */
const withRollout = (text: string, lang: MarketingLang) => [text, heroAvailabilityNote(lang)].filter(Boolean).join(' ');

/**
 * The few use-case strings needed outside the pages themselves: route `head`
 * metadata, breadcrumbs, and the landing-page teaser cards.
 *
 * Kept apart from `use-cases.<lang>.ts` on purpose. The use-case routes'
 * loaders import this module lazily (a route's `head` and `loader` sit in the
 * router's eager chunk, which every published docs page loads), and the
 * landing teaser imports it instead of both full copy modules. The strings are
 * copied verbatim from those modules; `use-case-meta.test.ts` fails if they
 * drift.
 */

export const USE_CASE_SLUGS = ['support-teams', 'product-docs', 'api-docs'] as const satisfies readonly UseCaseSlug[];

export interface UseCaseMeta {
  slug: UseCaseSlug;
  title: string;
  description: string;
  navLabel: string;
  cardSummary: string;
}

export const USE_CASE_META: Record<MarketingLang, Record<UseCaseSlug, UseCaseMeta>> = {
  en: {
    'support-teams': {
      slug: 'support-teams',
      title: 'Help center software for support teams | Nibleaf',
      description: withRollout(
        'Give customers AI answers that cite your help center, see which searches fail, and fix gaps from your AI assistant. Open source, in English and Arabic.',
        'en',
      ),
      navLabel: 'Support teams',
      cardSummary: withRollout('Answer repeat questions with cited AI answers, and see what customers can’t find.', 'en'),
    },
    'product-docs': {
      slug: 'product-docs',
      title: 'Product documentation for PMs and writers | Nibleaf',
      description:
        'A visual editor for product managers and writers, GitHub sync for engineers, previews, versions and translations. Open-source docs, free cloud beta.',
      navLabel: 'Product teams',
      cardSummary: 'A visual editor for product managers and writers, with previews, versions and translations.',
    },
    'api-docs': {
      slug: 'api-docs',
      title: 'API documentation with OpenAPI try-it | Nibleaf',
      description:
        'OpenAPI reference pages readers can try, Markdown guides synced with GitHub, llms.txt for AI tools, and versioned docs. Open source and self-hostable.',
      navLabel: 'Developers',
      cardSummary: 'OpenAPI reference with try-it, Markdown and GitHub, and docs AI tools can read.',
    },
  },
  ar: {
    'support-teams': {
      slug: 'support-teams',
      title: 'مركز مساعدة لفرق الدعم بالعربية والإنجليزية | Nibleaf',
      description: withRollout(
        'مركز مساعدة يجيب عملاءك بالذكاء الاصطناعي مع ذكر المصدر، ويكشف عمليات البحث المتعثّرة، ويتيح سدّ النقص من مساعدك الذكي. بالعربية والإنجليزية.',
        'ar',
      ),
      navLabel: 'فرق الدعم',
      cardSummary: withRollout('أجب عن الأسئلة المتكررة بإجابات ذكية تذكر مصادرها، واعرف ما لا يجده عملاؤك.', 'ar'),
    },
    'product-docs': {
      slug: 'product-docs',
      title: 'توثيق المنتج لمديري المنتج والكتّاب | Nibleaf',
      description:
        'محرر بصري لمديري المنتج والكتّاب، ومزامنة GitHub للمهندسين، ومعاينات وإصدارات وترجمات. منصة توثيق مفتوحة المصدر تدعم العربية وRTL.',
      navLabel: 'فرق المنتج',
      cardSummary: 'محرر بصري لمديري المنتج والكتّاب، مع معاينات وإصدارات وترجمات.',
    },
    'api-docs': {
      slug: 'api-docs',
      title: 'توثيق API مع تجربة الطلبات من OpenAPI | Nibleaf',
      description:
        'صفحات مرجعية من ملف OpenAPI يجرّبها القارئ، وأدلة Markdown متزامنة مع GitHub، وllms.txt لأدوات الذكاء الاصطناعي. مفتوح المصدر وقابل للاستضافة الذاتية.',
      navLabel: 'المطورون',
      cardSummary: 'مرجع OpenAPI مع تجربة الطلبات، وMarkdown وGitHub، ووثائق تقرؤها أدوات الذكاء الاصطناعي.',
    },
  },
};

/** Landing-page teaser heading, verbatim from `useCasesTeaserEn`/`useCasesTeaserAr`. */
export const USE_CASES_TEASER: Record<MarketingLang, UseCasesTeaserCopy> = {
  en: {
    eyebrow: 'Use cases',
    title: 'Built for the teams who own your docs',
    body: 'See how Nibleaf fits support teams, product teams and developers.',
  },
  ar: {
    eyebrow: 'حالات الاستخدام',
    title: 'لكل فريق يملك وثائقك',
    body: 'اعرف كيف يناسب Nibleaf فرق الدعم وفرق المنتج والمطورين.',
  },
};

/** Breadcrumb root name per language (the Arabic matches the reader's `site_home`). */
export const USE_CASE_HOME = {
  en: { name: 'Home', path: '/' },
  ar: { name: 'الرئيسية', path: '/ar' },
} as const satisfies Record<MarketingLang, { name: string; path: string }>;

export const getUseCaseHref = (lang: MarketingLang, slug: UseCaseSlug) => `${lang === 'ar' ? '/ar' : ''}/use-cases/${slug}`;

/** Metadata for a route param, or `undefined` for an unknown slug (the loader turns that into a 404). */
export function findUseCaseMeta(lang: MarketingLang, slug: string): UseCaseMeta | undefined {
  return (USE_CASE_SLUGS as readonly string[]).includes(slug) ? USE_CASE_META[lang][slug as UseCaseSlug] : undefined;
}
