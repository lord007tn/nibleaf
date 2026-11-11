import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { SkeletonText } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { usePageInboundLinks } from '@/hooks/api/page-inbound-links';
import { useFormatters } from '@/lib/format';

export function DeletePageInboundLinks({ projectId, pageId }: { projectId: string; pageId: string }) {
  const { data, isFetching, isError } = usePageInboundLinks(projectId, pageId);
  // Reserve the same advisory height even when loading, empty or unavailable.
  // Only this region scrolls, so the dialog and destructive footer stay fixed.
  return (
    <div data-slot="delete-page-advisory" className="h-72 min-h-72 overflow-y-auto">
      <InboundWarning projectId={projectId} data={data} isFetching={isFetching} isError={isError} />
    </div>
  );
}

function InboundWarning({
  projectId,
  data,
  isFetching,
  isError,
}: { projectId: string } & Pick<ReturnType<typeof usePageInboundLinks>, 'data' | 'isFetching' | 'isError'>) {
  const t = useT();
  const fmt = useFormatters();
  // Never display stale results after a failed refresh or while checking again.
  if (isFetching)
    return (
      <section aria-busy="true" aria-label={t('common.loading')}>
        <SkeletonText lines={2} />
      </section>
    );
  if (isError || !data?.total) return null;
  const visible = data.pages.slice(0, 5);
  const more = data.total - visible.length;
  return (
    <Callout tone="warning" role="status" title={t('editor.deleteInboundLinks', fmt.count(data.total))}>
      <ul className="min-w-0">
        {visible.map((page) => (
          <li key={page.id}>
            <Link
              to="/app/projects/$projectId/editor"
              params={{ projectId }}
              search={{ page: page.id }}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 max-w-full items-center break-words underline underline-offset-2"
              dir="auto"
              title={page.path}
            >
              {page.title.trim() || t('editor.untitled')}
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 ? <p>{t('publish.more', { count: fmt.number(more) })}</p> : null}
    </Callout>
  );
}
