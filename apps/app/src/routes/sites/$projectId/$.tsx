import { createFileRoute } from '@tanstack/react-router';
import { SitePageView } from '@/components/site/site-page-view';

export const Route = createFileRoute('/sites/$projectId/$')({
  component: SitePath,
});

function SitePath() {
  const { projectId, _splat } = Route.useParams();
  // Active language comes from the parent route's ?lang= search param.
  const { lang } = Route.useSearch();
  return <SitePageView projectId={projectId} path={_splat ?? ''} lang={lang} />;
}
