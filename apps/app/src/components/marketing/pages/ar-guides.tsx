import { GuidesHub } from '@/components/marketing/guides';
import { useMarketingData } from '@/components/marketing/page-data';
import type { MarketingSeo } from '@/lib/marketing-seo';

const pageHead = ({ breadcrumbLd, canonicalHref, pageMeta }: MarketingSeo) => ({
  meta: pageMeta({
    title: 'أكاديمية أدلة التوثيق | Nibleaf',
    description: 'أدلة محايدة ومكتملة لاختيار أنظمة التوثيق وترحيلها وتشغيلها وتأمينها ونشرها، مع توضيح لغة كل دليل.',
    path: '/ar/guides',
    locale: 'ar_AR',
    imagePath: '/brand/raster/social/nibleaf-og-card-ar.png',
  }),
  links: [
    { rel: 'canonical', href: canonicalHref('/ar/guides') },
    { rel: 'alternate', hrefLang: 'en', href: canonicalHref('/guides') },
    { rel: 'alternate', hrefLang: 'ar', href: canonicalHref('/ar/guides') },
    { rel: 'alternate', hrefLang: 'x-default', href: canonicalHref('/guides') },
  ],
  scripts: [
    breadcrumbLd([
      { name: 'الرئيسية', path: '/ar' },
      { name: 'الأدلة', path: '/ar/guides' },
    ]),
  ],
});

export const load = async () => {
  const seo = await import('@/lib/marketing-seo');
  return { stars: await seo.getGithubStarsFn(), head: pageHead(seo) };
};

export const Page = ArabicGuidesRoute;

function ArabicGuidesRoute() {
  const { stars } = useMarketingData<typeof load>();
  return <GuidesHub locale="ar" stars={stars} />;
}
