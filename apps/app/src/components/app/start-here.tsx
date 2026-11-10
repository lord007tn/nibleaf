import { useT } from '@nibleaf/i18n/react';
import { useQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { deploymentsQueryOptions, pagesQueryOptions } from '@/hooks/api/query-options';
import type { SiteActivity, StartHereProgress } from '@/lib/start-here';

export const subscribeToHydration = () => () => undefined;
/** Per user, so a colleague signing up on a shared desk machine still gets the path. */
export const startHereDismissedKey = (userId: string | undefined) => (userId ? `nibleaf.startHere.dismissed.${userId}` : null);
export const readStartHereDismissed = (key: string | null) => {
  // Hidden until the signed-in user is known, so it never flashes for someone who dismissed it.
  if (!key) return true;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
export const NO_REQUESTS = { deploymentSiteIds: [], pageSiteIds: [] };

/**
 * The sample's publish history and page list, which the checklist reads to tell
 * whether the user edited it (publishing comes from the sites list itself). The
 * shared factories are spread as-is, so these reads share cache entries and the
 * publish-receipt check with the editor. A failed read stays unknown (never
 * "nothing found"), so it can't untick a step the user already finished.
 */
export function useStartHereActivity(deploymentSiteIds: string[], pageSiteIds: string[]): ReadonlyMap<string, SiteActivity> {
  const deploymentResults = useQueries({ queries: deploymentSiteIds.map((projectId) => deploymentsQueryOptions(projectId)) });
  const pageResults = useQueries({ queries: pageSiteIds.map((projectId) => pagesQueryOptions(projectId)) });
  const activity = new Map<string, SiteActivity>();
  deploymentSiteIds.forEach((projectId, index) => {
    const result = deploymentResults[index];
    activity.set(projectId, { ...activity.get(projectId), deployments: result?.data });
  });
  pageSiteIds.forEach((projectId, index) => {
    const result = pageResults[index];
    activity.set(projectId, { ...activity.get(projectId), pages: result?.data });
  });
  return activity;
}

/** First-run path: three plain steps with real progress, each opening the right screen. */
export function StartHere({ progress, onCreateSite, onDismiss }: { progress: StartHereProgress; onCreateSite: () => void; onDismiss: () => void }) {
  const t = useT();
  const projectId = progress.focus?.id;
  const steps: Array<{ key: string; done: boolean; title: string; desc: string; link: (className: string, label: string) => ReactNode }> = [
    {
      key: 'write',
      done: progress.wrote,
      title: t('dashboard.start.step1'),
      desc: t('dashboard.start.step1Desc'),
      link: (className, label) =>
        projectId ? (
          <Link aria-label={label} className={className} params={{ projectId }} to="/app/projects/$projectId/editor" />
        ) : (
          <button aria-label={label} className={className} onClick={onCreateSite} type="button" />
        ),
    },
    {
      key: 'publish',
      done: progress.published,
      title: t('dashboard.start.step2'),
      desc: t('dashboard.start.step2Desc'),
      link: (className, label) =>
        projectId ? (
          <Link aria-label={label} className={className} params={{ projectId }} search={{ publish: true }} to="/app/projects/$projectId/editor" />
        ) : null,
    },
    {
      key: 'invite',
      done: progress.invited,
      title: t('dashboard.start.step3'),
      desc: t('dashboard.start.step3Desc'),
      link: (className, label) =>
        projectId ? (
          <Link
            aria-label={label}
            className={className}
            params={{ projectId }}
            search={{ section: 'members' }}
            to="/app/projects/$projectId/settings"
          />
        ) : null,
    },
  ];

  return (
    <section aria-labelledby="start-here-title" className="relative rounded-xl border border-primary/30 bg-primary/5 p-5">
      <button
        aria-label={t('overview.nudge.dismiss')}
        className="absolute end-3 top-3 grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:size-10"
        onClick={onDismiss}
        title={t('overview.nudge.dismiss')}
        type="button"
      >
        <X className="size-4" />
      </button>
      <div className="pe-10">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-semibold text-lg" id="start-here-title">
            {t('dashboard.start.title')}
          </h2>
          <span className="text-muted-foreground text-sm">{t('dashboard.start.progress', { done: progress.done, total: progress.total })}</span>
        </div>
        <p className="mt-1 text-muted-foreground text-sm">{t('dashboard.start.body')}</p>
        {progress.hasSample ? <p className="mt-1 text-sm">{t('dashboard.start.sample')}</p> : null}
      </div>
      <ol className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <li
            className="relative flex items-start gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted/40"
            key={step.key}
          >
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full font-semibold text-[12px] ${step.done ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}
            >
              {step.done ? <Check aria-hidden className="size-3.5" /> : index + 1}
            </span>
            <div className="min-w-0 leading-snug">
              <div className={`font-medium text-sm ${step.done ? 'text-muted-foreground line-through' : ''}`}>
                {step.title}
                {step.done ? <span className="sr-only"> ({t('dashboard.start.done')})</span> : null}
              </div>
              <div className="mt-0.5 text-muted-foreground text-xs">{step.desc}</div>
            </div>
            {step.link('absolute inset-0 rounded-lg outline-none', step.title)}
          </li>
        ))}
      </ol>
    </section>
  );
}
