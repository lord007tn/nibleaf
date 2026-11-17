import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { CloudUpload, Rocket } from 'lucide-react';
import { usePendingChanges } from '@/hooks/api';
import { useFormatters } from '@/lib/format';
import { hasUnpublishedChanges, type PageLiveStatus, type PendingState, pendingState } from '../model/pending';
import { usePublishLauncher } from './publish-launcher';

/** The site's pending-changes state, read from the same check the Publish button counts. */
export function useSitePendingState(projectId: string): PendingState {
  return pendingState(usePendingChanges(projectId).data);
}

/** "2 unpublished changes" or "Unpublished navigation or settings changes". */
export function usePendingLabel(state: PendingState): string | undefined {
  const t = useT();
  const { count } = useFormatters();
  if (state.kind === 'changes') return t('pending.count', count(state.count));
  if (state.kind === 'siteOnly') return t('pending.siteOnly');
  return undefined;
}

/**
 * Opens the publish sheet: the site top bar's when the page is in the site
 * shell, otherwise the editor's (`?publish=true`). Hidden for Viewers.
 */
export function ReviewAndPublishButton({ projectId, viewOnly }: { projectId: string; viewOnly: boolean }) {
  const t = useT();
  const launch = usePublishLauncher();
  if (viewOnly) return null;
  return launch ? (
    <Button onClick={launch} size="sm" type="button">
      <Rocket aria-hidden /> {t('pending.review')}
    </Button>
  ) : (
    <Button nativeButton={false} render={<Link params={{ projectId }} search={{ publish: true }} to="/app/projects/$projectId/editor" />} size="sm">
      <Rocket aria-hidden /> {t('pending.review')}
    </Button>
  );
}

/**
 * The line that says the live site is behind the drafts, with Review and
 * publish (P1-DASH-005). Renders nothing while the site is up to date, never
 * published (the first-publish nudge owns that), or not known yet.
 */
export function PendingChangesNotice({ projectId, viewOnly, className }: { projectId: string; viewOnly: boolean; className?: string }) {
  const t = useT();
  const state = useSitePendingState(projectId);
  const label = usePendingLabel(state);
  if (!hasUnpublishedChanges(state) || !label) return null;
  return (
    <Callout
      action={<ReviewAndPublishButton projectId={projectId} viewOnly={viewOnly} />}
      className={className}
      data-testid="pending-changes"
      icon={<CloudUpload />}
      title={label}
      tone="info"
    >
      {state.liveVersion != null ? t('pending.readersStillSee', { version: `v${state.liveVersion}` }) : null}
    </Callout>
  );
}

const PAGE_STATUS: Record<PageLiveStatus, { label: MessageKey; tone: 'neutral' | 'warning' | 'success' }> = {
  draft: { label: 'pageStatus.draft', tone: 'neutral' },
  changed: { label: 'pageStatus.changed', tone: 'warning' },
  live: { label: 'pageStatus.live', tone: 'success' },
};

/** A page's status against the live site, as a small badge. */
export function PageStatusBadge({ status }: { status: PageLiveStatus }) {
  const t = useT();
  const meta = PAGE_STATUS[status];
  return (
    <StatusBadge data-page-status={status} size="sm" tone={meta.tone}>
      {t(meta.label)}
    </StatusBadge>
  );
}
