import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PageHeader } from '@/components/app/page-header';
import { QueryErrorState } from '@/components/query-error-state';
import { useProjects } from '@/hooks/api';
import { getData } from '@/hooks/api/client-helpers';
import { api } from '@/services/api';

export const Route = createFileRoute('/app/(dashboard)/o/$orgSlug/websites')({ component: OrganizationWebsites });
function OrganizationWebsites() {
  const { orgSlug } = Route.useParams();
  const t = useT();
  const organization = useQuery({
    queryKey: ['organizations', 'by-slug', orgSlug],
    queryFn: async () => getData(await api.app.organizations['by-slug'][':slug'].$get({ param: { slug: orgSlug } }), 'organization'),
  });
  const projects = useProjects();
  if (organization.isError || projects.isError)
    return (
      <QueryErrorState
        onRetry={() => {
          void organization.refetch();
          void projects.refetch();
        }}
        retrying={organization.isFetching || projects.isFetching}
      />
    );
  if (organization.isPending || projects.isPending) return <p role="status">{t('common.loading')}</p>;
  const websites = projects.data.filter((project) => project.organizationId === organization.data.id);
  return (
    <div className="space-y-6">
      <PageHeader title={organization.data.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        {websites.map((project) => (
          <Button
            key={project.id}
            nativeButton={false}
            variant="outline"
            className="min-h-11 justify-start"
            render={<Link to="/app/projects/$projectId" params={{ projectId: project.id }} />}
          >
            <bdi>{project.name}</bdi>
          </Button>
        ))}
      </div>
      {websites.length === 0 ? (
        <p className="text-muted-foreground">{t('settings.members.noWebsiteAccess', { org: organization.data.name })}</p>
      ) : null}
    </div>
  );
}
