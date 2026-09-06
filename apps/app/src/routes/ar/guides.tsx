import { createFileRoute } from '@tanstack/react-router';
import { GuidesHub } from '@/components/marketing/guides';
import { breadcrumbLd, canonicalHref, getGithubStarsFn, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/ar/guides')({
  loader: () => getGithubStarsFn(),
  head: () => ({
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
  }),
  component: ArabicGuidesRoute,
});

function ArabicGuidesRoute() {
  const stars = Route.useLoaderData();
  return <GuidesHub locale="ar" stars={stars} />;
}
