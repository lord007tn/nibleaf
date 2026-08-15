import { APP_URL, GITHUB_URL } from '@/lib/links';

/**
 * SEO helpers for the marketing + legal routes served from the cloud app
 * (nibleaf.com): /, /cloud, /pricing, /terms, /privacy, /self-hosting, /about,
 * and the /compare and /alternatives pages. Typical usage in a route:
 *
 *   head: () => ({
 *     meta: pageMeta({ title: 'Pricing — Nibleaf', description: '…', path: '/pricing' }),
 *     links: [{ rel: 'canonical', href: canonicalHref('/pricing') }],
 *     scripts: [marketingLd(), breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'Pricing', path: '/pricing' }])],
 *   }),
 */

const SITE_NAME = 'Nibleaf';
const OG_IMAGE_PATH = '/brand/raster/social/nibleaf-og-card.png';
const OG_IMAGE_ALT = 'Nibleaf documentation publishing with Markdown and Arabic/RTL support';

/** One-line product description reused across metadata and structured data. */
export const ENTITY_SENTENCE =
  'Nibleaf is a documentation platform with a visual Markdown editor, versioned publishing, Arabic and RTL support, custom domains, search, analytics, and a free cloud beta at nibleaf.com.';

/** Absolute URL for a marketing path (https://nibleaf.com/<path> in production). */
export const canonicalHref = (path: string) => new URL(path, APP_URL).toString();

/** Title + description + Open Graph + Twitter card meta for one marketing page. */
export function pageMeta({
  title,
  description,
  path,
  type = 'website',
  locale = 'en_US',
  imagePath = OG_IMAGE_PATH,
  imageAlt,
}: {
  title: string;
  description: string;
  path: string;
  type?: 'website' | 'article';
  locale?: 'ar_AR' | 'en_US';
  imagePath?: string;
  imageAlt?: string;
}) {
  const url = canonicalHref(path);
  const image = canonicalHref(imagePath);
  // The shared card art plus the page title reads better in link unfurls than a
  // one-size-fits-all alt (and matches Google's og:image:alt guidance).
  const resolvedImageAlt = imageAlt ?? (title === OG_IMAGE_ALT ? OG_IMAGE_ALT : `${SITE_NAME} — ${title}`);
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:type', content: type },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:locale', content: locale },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:url', content: url },
    { property: 'og:image', content: image },
    { property: 'og:image:type', content: 'image/png' },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: resolvedImageAlt },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image },
    { name: 'twitter:image:alt', content: resolvedImageAlt },
  ];
}

/** HowTo JSON-LD `<script>` for step-by-step pages (self-hosting quick start). */
export function howToLd({
  name,
  description,
  totalTime,
  steps,
}: {
  name: string;
  description: string;
  /** ISO-8601 duration, e.g. 'PT10M'. */
  totalTime?: string;
  steps: { name: string; text: string }[];
}) {
  return {
    type: 'application/ld+json',
    children: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name,
      description,
      ...(totalTime ? { totalTime } : {}),
      step: steps.map((step, i) => ({ '@type': 'HowToStep', position: i + 1, name: step.name, text: step.text })),
    }),
  };
}

/** BreadcrumbList JSON-LD `<script>` for a route's `head().scripts`. */
export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    type: 'application/ld+json',
    children: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        item: canonicalHref(it.path),
      })),
    }),
  };
}

/** FAQPage JSON-LD `<script>` for pages that render a question/answer list. */
export function faqLd(faqs: { q: string; a: string }[]) {
  return {
    type: 'application/ld+json',
    children: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.q,
        acceptedAnswer: { '@type': 'Answer', text: faq.a },
      })),
    }),
  };
}

/** Organization + WebSite + SoftwareApplication @graph JSON-LD `<script>` for rich results. */
export function marketingLd() {
  return {
    type: 'application/ld+json',
    children: JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${APP_URL}/#organization`,
          name: SITE_NAME,
          url: APP_URL,
          logo: canonicalHref('/brand/raster/logo/nibleaf-logo-horizontal-ltr.png'),
        },
        {
          '@type': 'WebSite',
          '@id': `${APP_URL}/#website`,
          name: SITE_NAME,
          url: APP_URL,
          inLanguage: ['en', 'ar'],
          publisher: { '@id': `${APP_URL}/#organization` },
        },
        {
          '@type': 'SoftwareApplication',
          '@id': `${APP_URL}/#software`,
          name: SITE_NAME,
          applicationCategory: 'DeveloperApplication',
          applicationSubCategory: 'Documentation Platform',
          operatingSystem: 'Web',
          description: ENTITY_SENTENCE,
          url: APP_URL,
          image: canonicalHref(OG_IMAGE_PATH),
          inLanguage: ['en', 'ar'],
          license: 'https://www.gnu.org/licenses/agpl-3.0.html',
          isAccessibleForFree: true,
          publisher: { '@id': `${APP_URL}/#organization` },
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: canonicalHref('/sign-up') },
        },
      ],
    }),
  };
}

/** In-memory GitHub star-count cache. Failures cache 0 so a private or
 *  rate-limited repo never re-fetches on every request. */
let starsCache: { value: number; fetchedAt: number } | null = null;
/** Cache a successful (>0) count for ~1h. */
const STARS_TTL_MS = 60 * 60 * 1000;
/** Cache a failed/zero result for only ~1m so a transient GitHub outage doesn't
 *  hide the badge for a full hour. */
const STARS_ERROR_TTL_MS = 60 * 1000;
/** Shared in-flight fetch: concurrent cold-cache SSR renders reuse one request
 *  to api.github.com instead of each opening (and blocking on) their own. */
let inFlight: Promise<number> | null = null;

/**
 * Star count for the Nibleaf repo, fetched unauthenticated and cached
 * module-level. Returns 0 when the repo is unreachable (private, rate-limited,
 * offline, or slow) — callers hide the badge for 0.
 */
export async function getGithubStars(): Promise<number> {
  const now = Date.now();
  if (starsCache) {
    const ttl = starsCache.value > 0 ? STARS_TTL_MS : STARS_ERROR_TTL_MS;
    if (now - starsCache.fetchedAt < ttl) {
      return starsCache.value;
    }
  }
  if (!inFlight) {
    inFlight = (async () => {
      let value = 0;
      try {
        const repo = new URL(GITHUB_URL).pathname.replace(/^\/+|\/+$/g, '');
        const res = await fetch(`https://api.github.com/repos/${repo}`, {
          headers: { Accept: 'application/vnd.github+json' },
          // Cap the wait: a stalled GitHub socket must never block SSR for
          // Node's multi-minute default socket timeout during a traffic spike.
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const data = (await res.json()) as { stargazers_count?: number };
          if (typeof data.stargazers_count === 'number' && data.stargazers_count > 0) {
            value = data.stargazers_count;
          }
        }
      } catch {
        // Network/API failure or timeout — treat as "no stars to show".
      }
      starsCache = { value, fetchedAt: Date.now() };
      return value;
    })().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
