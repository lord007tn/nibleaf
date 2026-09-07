import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useProject } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';

/** Do not mount project tools until access has been resolved. A revoked
 * membership must also hide cached project data; a transient background error
 * should leave an already-open editor and its unsaved draft mounted. */
export function ProjectAccessBoundary({ projectId, children }: { projectId: string; children: ReactNode }) {
  const t = useT();
  const { data: project, error, isPending, refetch } = useProject(projectId);
  const unavailable = error instanceof ApiResponseError && [401, 403, 404].includes(error.status);

  if (project && !unavailable) return children;
  if (isPending) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6" role="status">
        {t('common.loading')}
      </div>
    );
  }

  const missing = unavailable || !error;
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3" role="alert">
        <h1 className="font-semibold text-2xl tracking-tight">{t(missing ? 'notFound.title' : 'error.title')}</h1>
        <p className="text-muted-foreground text-sm">{t(missing ? 'notFound.body' : 'error.unexpected')}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {!missing && (
            <Button onClick={() => void refetch()} variant="outline">
              {t('error.tryAgain')}
            </Button>
          )}
          <Button nativeButton={false} render={<Link to="/app" />}>
            {t('nav.sites')}
          </Button>
        </div>
      </div>
    </main>
  );
}
