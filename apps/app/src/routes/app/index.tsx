import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { LandingRedirect } from '@/components/organization/landing-redirect';
import { PageLoader } from '@/components/page-loader';
import { useProjects } from '@/hooks/api';
import { switcherQueryOptions } from '@/hooks/api/organization-query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { recordFirstPublishStage } from '@/lib/first-publish-activation';

export const Route = createFileRoute('/app/')({
  validateSearch: (search: Record<string, unknown>): { firstPublish?: boolean } =>
    search.firstPublish === true || search.firstPublish === 'true' ? { firstPublish: true } : {},
  loader: ({ context: { queryClient } }) => prefetchRouteData(queryClient, switcherQueryOptions()),
  component: AppLanding,
});

/** `/app` has no page of its own: it lands in an organization (§5.4.3). */
function AppLanding() {
  const { firstPublish } = Route.useSearch();
  return firstPublish ? <FirstPublishLanding /> : <LandingRedirect section="websites" />;
}

/** Sign-up "publish my first site" intent: straight into the starter site's editor. */
function FirstPublishLanding() {
  const navigate = useNavigate();
  const { data: projects, isSuccess, isError } = useProjects();
  const starter = projects?.[0];
  useEffect(() => {
    if (!starter) return;
    void recordFirstPublishStage('project_entered');
    void navigate({ to: '/app/projects/$projectId/editor', params: { projectId: starter.id }, search: { firstPublish: true }, replace: true });
  }, [starter, navigate]);
  // No starter site, or the list failed: land normally rather than wait forever.
  if ((isSuccess && !starter) || (isError && !starter)) return <LandingRedirect section="websites" />;
  return <PageLoader />;
}
