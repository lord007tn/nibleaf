import { Button } from '@nibleaf/design-system/components/ui/button';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { ArrowUpRight, Check, CircleAlert, DownloadCloud, Globe, Hammer, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { SettingsSection } from '@/components/settings/section';
import { useDeployments, useLiveDeployments } from '@/hooks/api';
import { newestLiveDeployment } from '@/hooks/api/deployment-cache';
import { useFormatters } from '@/lib/format';
import { type PipelineGitMetadata, type PipelineStepTone, pipelineBuild, pipelineImport, pipelineLive } from '../model/git-pipeline';

function PipelineStep({
  icon,
  tone,
  label,
  detail,
  action,
  last,
}: {
  icon: ReactNode;
  tone: PipelineStepTone;
  label: string;
  detail: string;
  action?: ReactNode;
  last?: boolean;
}) {
  return (
    <div className="relative flex gap-3 pb-6 last:pb-0">
      {!last ? <span className="absolute start-[15px] top-8 bottom-0 w-px bg-border" aria-hidden /> : null}
      <span
        className={cn(
          'z-10 grid size-8 shrink-0 place-items-center rounded-full border',
          tone === 'done' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
          tone === 'active' && 'border-primary/40 bg-primary/10 text-primary',
          tone === 'failed' && 'border-destructive/40 bg-destructive/10 text-destructive',
          tone === 'idle' && 'border-border bg-muted/40 text-muted-foreground',
        )}
      >
        {icon}
      </span>
      {/* On a narrow screen the action drops below the text, and the detail wraps
          instead of being cut off mid-word. */}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2 pt-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0 leading-snug">
          <div className="font-medium text-sm">{label}</div>
          <div className="text-muted-foreground text-xs [overflow-wrap:anywhere] sm:truncate">{detail}</div>
        </div>
        {action}
      </div>
    </div>
  );
}

/** Import → Build → Live, from real git metadata + deployment history. */
export function GitPipeline({
  projectId,
  git,
  onImport,
  importing,
}: {
  projectId: string;
  git: PipelineGitMetadata;
  onImport: () => void;
  importing: boolean;
}) {
  const t = useT();
  const { dateTime } = useFormatters();
  const { data: deployments } = useDeployments(projectId);
  // What's live comes from the live-only list too: the attempts list is the
  // newest 50, which a run of failures can fill.
  const { data: liveDeployments } = useLiveDeployments(projectId);
  const sync = pipelineImport(git);
  const build = pipelineBuild(deployments?.[0]);
  const live = pipelineLive(newestLiveDeployment(deployments, liveDeployments));

  // The sync error is the server's text, rendered as plain text.
  const importDetail =
    sync.kind === 'syncFailed'
      ? `${t('settings.git.pipeline.syncFailed', { when: dateTime(sync.at) })}${sync.error ? ` — ${sync.error}` : ''}`
      : sync.kind === 'synced'
        ? t('settings.git.pipeline.lastSync', { when: dateTime(sync.at) })
        : sync.kind === 'imported'
          ? t('settings.git.import.lastImported', { when: dateTime(sync.at) })
          : t('settings.git.import.never');
  const buildDetail =
    build.kind === 'building'
      ? t('settings.git.pipeline.building', { version: build.version })
      : build.kind === 'failed'
        ? t('settings.git.pipeline.failed', { version: build.version })
        : build.kind === 'built'
          ? t('settings.git.pipeline.built', { version: build.version, pages: build.pages })
          : t('settings.git.pipeline.noBuilds');

  return (
    <SettingsSection title={t('settings.git.pipeline.title')}>
      <div className="flex flex-col">
        <PipelineStep
          icon={sync.kind === 'syncFailed' ? <CircleAlert className="size-4" /> : <DownloadCloud className="size-4" />}
          tone={sync.tone}
          label={t('settings.git.pipeline.import')}
          detail={importDetail}
          action={
            <Button size="sm" type="button" variant="outline" loading={importing} onClick={onImport} loadingText={t('settings.git.import.importing')}>
              <DownloadCloud className="size-3.5" />
              {t('settings.git.import.now')}
            </Button>
          }
        />
        <PipelineStep
          icon={
            build.kind === 'failed' ? (
              <CircleAlert className="size-4" />
            ) : build.kind === 'building' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Hammer className="size-4" />
            )
          }
          tone={build.tone}
          label={t('settings.git.pipeline.build')}
          detail={buildDetail}
        />
        <PipelineStep
          icon={live.kind === 'live' ? <Check className="size-4" /> : <Globe className="size-4" />}
          tone={live.tone}
          label={t('settings.git.pipeline.live')}
          detail={
            live.kind === 'live' ? t('settings.git.pipeline.built', { version: live.version, pages: live.pages }) : t('settings.git.pipeline.notLive')
          }
          action={
            live.kind === 'live' ? (
              <Button nativeButton={false} size="sm" variant="outline" render={<a href={`/sites/${projectId}`} rel="noreferrer" target="_blank" />}>
                {t('settings.git.pipeline.viewSite')} <ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
              </Button>
            ) : undefined
          }
          last
        />
      </div>
    </SettingsSection>
  );
}
