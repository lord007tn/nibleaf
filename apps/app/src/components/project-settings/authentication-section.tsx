import { buttonVariants } from '@nibleaf/design-system/components/ui/button';
import { Skeleton, SkeletonText } from '@nibleaf/design-system/components/ui/skeleton';
import { useLocale } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { Eye, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { QueryErrorState } from '@/components/query-error-state';
import { friendlyErrorMessage, type Project, useReaderAccess, useUpdateReaderAccessMode } from '@/hooks/api';
import { DirtyStateReporter, SectionHeader } from './shared';
import { AdvancedAccess } from './visibility/advanced-access';
import { ReadersPanel } from './visibility/readers-panel';
import { type AccessMode, VisibilityPicker } from './visibility/visibility-picker';

/**
 * The section's first load: heading, then the three visibility choices every
 * mode shows. Reader controls only appear below them, so nothing moves.
 */
function VisibilitySectionSkeleton() {
  const { t } = useLocale();
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        {t('common.loading')}
      </p>
      <div aria-hidden>
        <div className="mb-6 border-border border-b pb-3">
          <Skeleton className="h-7 w-48" />
          <SkeletonText className="mt-1.5" lines={1} />
        </div>
        <div className="grid gap-2.5 md:grid-cols-3">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/**
 * Who can read the published site, and the readers of an Invited readers site.
 * Plain-language choices first; page groups, portal sign-in and the access log
 * stay under Advanced access.
 */
export function AuthenticationSection({ project }: { project: Project }) {
  const { t } = useLocale();
  const readerAccess = useReaderAccess(project.id);
  const data = readerAccess.data;
  const updateMode = useUpdateReaderAccessMode(project.id);
  const [mode, setMode] = useState<AccessMode>('PUBLIC');
  useEffect(() => {
    if (data) setMode(data.accessMode);
  }, [data]);

  if (readerAccess.isError && !data) return <QueryErrorState onRetry={() => void readerAccess.refetch()} retrying={readerAccess.isFetching} />;
  if (readerAccess.isPending || !data) return <VisibilitySectionSkeleton />;

  const disabled = readerAccess.isError;
  const save = async (next: AccessMode) => {
    try {
      await updateMode.mutateAsync({ mode: next });
      toast.success(t('settings.visibility.saved'));
    } catch (error) {
      toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
    }
  };

  return (
    <div>
      {readerAccess.isError ? <QueryErrorState onRetry={() => void readerAccess.refetch()} retrying={readerAccess.isFetching} /> : null}
      <DirtyStateReporter dirty={mode !== data.accessMode} />
      <SectionHeader description={t('settings.visibility.description')} icon={<Eye className="size-4" />} title={t('settings.visibility.title')} />
      <VisibilityPicker
        current={data.accessMode}
        disabled={disabled || updateMode.isPending}
        onChange={setMode}
        onSave={save}
        saving={updateMode.isPending}
        value={mode}
      />

      {data.accessMode === 'WORKSPACE' ? (
        <div className="mt-6 flex flex-col items-start gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-muted-foreground text-sm">
            <Users aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('settings.visibility.teamNote')}
          </p>
          <Link
            className={buttonVariants({ variant: 'outline', size: 'sm', className: 'shrink-0' })}
            params={{ projectId: project.id }}
            search={{ section: 'members' }}
            to="/app/projects/$projectId/settings"
          >
            {t('settings.visibility.openMembers')}
          </Link>
        </div>
      ) : null}

      {data.accessMode === 'READERS' ? (
        <>
          <ReadersPanel data={data} disabled={disabled} projectId={project.id} />
          <AdvancedAccess data={data} disabled={disabled} projectId={project.id} />
        </>
      ) : null}
    </div>
  );
}
