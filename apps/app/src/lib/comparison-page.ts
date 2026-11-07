import {
  gitbookAlternatives,
  mintlifyAlternatives,
  nibleafVsDocusaurus,
  nibleafVsGitbook,
  nibleafVsMintlify,
  readmeAlternatives,
} from './comparison-data';
import { breadcrumbLd, canonicalHref, faqLd, getGithubStarsFn, pageMeta } from './marketing-seo';

const COMPARISONS = { gitbookAlternatives, mintlifyAlternatives, readmeAlternatives, nibleafVsDocusaurus, nibleafVsGitbook, nibleafVsMintlify };

/** Loader data for a /compare or /alternatives page: its comparison, the star
 * count and the finished head. Route loaders import this module lazily, so the
 * comparison registry and the SEO helpers load with these pages, not with every
 * page's route tree (BUNDLE_BUDGET.md). */
export async function loadComparisonPage<Key extends keyof typeof COMPARISONS>(key: Key) {
  const data = COMPARISONS[key];
  return {
    data,
    stars: await getGithubStarsFn(),
    head: {
      meta: pageMeta({ title: data.metaTitle, description: data.metaDescription, path: data.path }),
      links: [{ rel: 'canonical', href: canonicalHref(data.path) }],
      scripts: [
        faqLd(data.faqs),
        breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: data.breadcrumbName, path: data.path },
        ]),
      ],
    },
  };
}
