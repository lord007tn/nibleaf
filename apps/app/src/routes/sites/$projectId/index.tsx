import { createFileRoute } from '@tanstack/react-router';
import { SitePageView } from '@/components/site/site-page-view';

export const Route = createFileRoute('/sites/$projectId/')({
  component: SiteHome,
});

function SiteHome() {
  const { projectId } = Route.useParams();
  // Active language comes from the parent route's ?lang= search param.
  const { lang } = Route.useSearch();
  // Empty path resolves to the first page server-side.
  return <SitePageView projectId={projectId} path="" lang={lang} />;
}
