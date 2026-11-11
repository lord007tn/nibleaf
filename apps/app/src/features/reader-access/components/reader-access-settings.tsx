import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { Skeleton, SkeletonText } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { type ReactNode, useState } from 'react';
import { ConfigDirtyProvider, DirtyStateReporter, useDirtySources } from '@/components/project-settings/shared';
import { QueryErrorState } from '@/components/query-error-state';
import type { Project } from '@/hooks/api';
import { useProjectAdminStatus } from '@/hooks/use-project-admin-status';
import { SaveRegionProvider } from '@/lib/forms/save-region';
import { useReaderAccessSettings } from '../api/hooks';
import { accessView } from '../model/access';
import { AccessRequestsSection } from './access-requests-section';
import { AdvancedAccess } from './advanced-access';
import { ReaderListSection, ReadersSection } from './readers-section';
import { VisibilitySection } from './visibility-section';

/**
 * Site settings → Visibility & access: who can read the published site and,
 * for an Invited readers site, its readers, access requests and advanced
 * access (audiences, JWT handoff, access log). Admins only; the server refuses
 * everyone else, reads included, so they get one note saying why.
 */
export function ReaderAccessSettings({ project }: { project: Project }) {
  const t = useT();
  const query = useReaderAccessSettings(project.id);
  const access = useProjectAdminStatus(project.id);
  const view = accessView(access.status, access.edit);
  const data = query.data;
  const retry = <QueryErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  const props = data ? { projectId: project.id, data, status: access.status } : null;
  const isReaders = data?.accessMode === 'READERS';
  // The reader controls own drafts (invitations, allowed domains, audiences,
  // JWT settings) and their conflicts. Once shown they stay mounted, so a
  // visibility change, here or from a refetch, never drops an unsaved edit:
  // while one is unsaved they stay on screen with a note; otherwise they hide.
  const readerDrafts = useDirtySources();
  const [readersMounted, setReadersMounted] = useState(false);
  if (isReaders && !readersMounted) setReadersMounted(true);
  const readersKept = !isReaders && readerDrafts.sources.size > 0;

  let body: ReactNode = null;
  if (view.kind === 'readOnly') body = null;
  else if (query.isPending) body = <ReaderAccessSkeleton />;
  else if (!props) body = retry;
  else {
    body = (
      <>
        {/* A failed refetch keeps the last answer on screen; every write is still checked by the server. */}
        {query.isError ? retry : null}
        <VisibilitySection current={props.data.accessMode} projectId={project.id} status={access.status} />
        <DirtyStateReporter dirty={readerDrafts.sources.size > 0} />
        {readersMounted ? (
          <ConfigDirtyProvider report={readerDrafts.report}>
            <div className={cn('flex flex-col gap-8', !(isReaders || readersKept) && 'hidden')} data-reader-controls="">
              {readersKept ? (
                <Callout role="status" tone="warning">
                  {t('settings.visibility.readersKept')}
                </Callout>
              ) : null}
              <ReadersSection {...props} />
              <ReaderListSection {...props} />
              <AccessRequestsSection {...props} />
              <AdvancedAccess {...props} />
            </div>
          </ConfigDirtyProvider>
        ) : null}
      </>
    );
  }

  return (
    <SaveRegionProvider>
      <div className="me-auto flex w-full max-w-[47.5rem] flex-col gap-8">
        <PageHeader description={t('settings.visibility.description')} title={t('settings.authentication')} />
        {view.kind === 'readOnly' ? (
          <Callout role="note" title={t('settings.permissions.title')} tone="info">
            {t(view.note)}
          </Callout>
        ) : null}
        {body}
      </div>
    </SaveRegionProvider>
  );
}

/** First load: the visibility section's three choices as placeholder rows; reader controls only appear below them, so nothing moves. */
function ReaderAccessSkeleton() {
  const t = useT();
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        {t('common.loading')}
      </p>
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-5 w-48" />
        <SettingsSection>
          {['public', 'team', 'readers'].map((row) => (
            <div className="flex items-start gap-3 px-4 py-4 sm:px-5" key={row}>
              <Skeleton className="mt-0.5 size-4 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-32" />
                <SkeletonText className="mt-2" lines={1} />
              </div>
            </div>
          ))}
        </SettingsSection>
      </div>
    </div>
  );
}
