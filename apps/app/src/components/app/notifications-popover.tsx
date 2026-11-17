import { Button } from '@nibleaf/design-system/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nibleaf/design-system/components/ui/popover';
import { SegmentedControl, SegmentedControlItem } from '@nibleaf/design-system/components/ui/segmented-control';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useLocale, useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { useId, useState } from 'react';
import { FailureDetails, failureMessageKey } from '@/components/failure-message';
import { QueryErrorState } from '@/components/query-error-state';
import { useMarkNotificationsRead, useNotifications, useUnreadNotificationCount } from '@/hooks/api';
import type { NotificationItem } from '@/hooks/api/types';
import { useProjectAdminStatus } from '@/hooks/use-project-admin-status';
import { useFormatters } from '@/lib/format';
import { notificationDetails, notificationText } from './notification-text';
import { OrgAvatar } from './org-switcher/org-avatar';
import { useSwitcherControls } from './org-switcher/switcher-context';

const NOTIFICATION_SKELETON_ROWS = ['a', 'b', 'c'];

/** One inbox row: unread dot, title/body, relative time. Clicking marks it read
 *  and follows its dashboard link (when it has one). */
function NotificationRow({ item, onOpen }: { item: NotificationItem; onOpen: (item: NotificationItem) => void }) {
  const { t, locale } = useLocale();
  const needsRole = item.type === 'deploy_failed' && failureMessageKey(notificationDetails(item) ?? '', 'publish').startsWith('failures.redirects');
  const role = useProjectAdminStatus(needsRole ? (item.projectId ?? undefined) : undefined);
  const text = notificationText(t, item, locale, role.status);
  const { relativeTime } = useFormatters();
  const unread = item.readAt === null;
  return (
    <div className="min-w-0">
      <button
        className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 text-start outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => onOpen(item)}
        type="button"
      >
        <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`} />
        <span className="min-w-0 flex-1 leading-snug">
          {unread ? <span className="sr-only">{t('notifications.unread')} </span> : null}
          {/* One inbox across organizations (§5.4.5): say where each item comes from. */}
          {item.organization ? (
            <span className="mb-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground" data-slot="notification-source">
              <OrgAvatar className="size-4 rounded text-[8px]" logo={item.organization.logo} name={item.organization.name} />
              <span className="min-w-0 truncate">
                <bdi>{item.organization.name}</bdi>
                {item.project ? (
                  <>
                    {' · '}
                    <bdi>{item.project.name}</bdi>
                  </>
                ) : null}
              </span>
            </span>
          ) : null}
          <span className={`block truncate text-sm ${unread ? 'font-semibold' : 'font-medium'}`} dir="auto">
            {text.title}
          </span>
          {text.body ? (
            <span className="mt-0.5 block break-words text-muted-foreground text-xs [overflow-wrap:anywhere]" dir="auto">
              {text.body}
            </span>
          ) : null}
          <span className="mt-1 block text-[11px] text-muted-foreground/80">{relativeTime(item.createdAt)}</span>
        </span>
      </button>
      {text.details ? (
        <div className="px-3 pb-2">
          <FailureDetails detail={text.details} />
        </div>
      ) : null}
    </div>
  );
}

// After a failed "Mark all read" the rows show unread again before the refetched count arrives.
const anyUnread = (count: number, items: NotificationItem[]) => count > 0 || items.some((item) => item.readAt === null);

/**
 * The header bell: unread badge (polled every 60s) + a popover inbox. The list
 * itself is only fetched once the popover opens. Lives in BOTH shells — the
 * workspace header (layouts/dashboard) and the per-site header (layouts/project).
 */
export function NotificationsPopover() {
  const t = useT();
  const { number } = useFormatters();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  // "This organization / All": defaults to All so nothing is hidden by surprise.
  const currentOrganizationId = useSwitcherControls()?.current.organizationId;
  const [scope, setScope] = useState<'organization' | 'all'>('all');
  const filterOrganizationId = scope === 'organization' ? currentOrganizationId : undefined;
  const { data: unread } = useUnreadNotificationCount();
  const { data: inbox, isPending, isError, isFetching, refetch } = useNotifications({ enabled: open, organizationId: filterOrganizationId });
  const markRead = useMarkNotificationsRead();
  // The same mutation marks single rows read; only "Mark all read" spins this button.
  const markingAll = markRead.isPending && markRead.variables?.all === true;

  const unreadCount = unread?.count ?? 0;
  const items = inbox?.items ?? [];
  const hasUnread = anyUnread(unreadCount, items);

  const openItem = (item: NotificationItem) => {
    if (item.readAt === null) {
      markRead.mutate({ ids: [item.id] });
    }
    if (item.href) {
      setOpen(false);
      navigate({ to: item.href } as never);
    }
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={unreadCount > 0 ? t('notifications.bellUnreadLabel', { count: number(unreadCount) }) : t('notifications.bellLabel')}
            className="relative size-8 shrink-0"
            size="icon"
            variant="ghost"
          >
            <Bell aria-hidden className="size-4" />
            {unreadCount > 0 ? (
              <span
                aria-hidden
                className="-top-0.5 -end-0.5 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground leading-none"
              >
                {unreadCount > 9 ? `${number(9)}+` : number(unreadCount)}
              </span>
            ) : null}
          </Button>
        }
      />
      <PopoverContent align="end" aria-labelledby={titleId} className="w-90 gap-0 p-0">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-border border-b px-4 py-2.5">
          <span className="min-w-0 font-semibold text-sm [overflow-wrap:anywhere]" id={titleId}>
            {t('notifications.title')}
          </span>
          <Button
            className="h-auto min-w-0 max-w-full shrink px-2 text-xs [overflow-wrap:anywhere]"
            disabled={!hasUnread}
            loading={markingAll}
            onClick={() => markRead.mutate({ all: true })}
            size="sm"
            variant="ghost"
          >
            {t('notifications.markAllRead')}
          </Button>
        </div>
        {currentOrganizationId ? (
          <div className="shrink-0 border-border border-b px-3 py-2">
            <SegmentedControl aria-label={t('notifications.filter.label')} density="compact" role="group">
              <SegmentedControlItem
                active={scope === 'organization'}
                aria-pressed={scope === 'organization'}
                onClick={() => setScope('organization')}
                type="button"
              >
                {t('notifications.filter.organization')}
              </SegmentedControlItem>
              <SegmentedControlItem active={scope === 'all'} aria-pressed={scope === 'all'} onClick={() => setScope('all')} type="button">
                {t('notifications.filter.all')}
              </SegmentedControlItem>
            </SegmentedControl>
          </div>
        ) : null}
        <div aria-busy={isPending && !isError ? true : undefined} className="min-h-0 max-h-96 shrink-0 overflow-y-auto p-1.5">
          {isError && !inbox ? (
            <div className="p-1.5">
              <QueryErrorState onRetry={() => void refetch()} retrying={isFetching} />
            </div>
          ) : isPending ? (
            <>
              <p className="sr-only" role="status">
                {t('common.loading')}
              </p>
              {/* Shaped like NotificationRow: dot, title, body line, time. */}
              {NOTIFICATION_SKELETON_ROWS.map((row) => (
                <div aria-hidden className="flex items-start gap-2.5 px-3 py-2.5" key={row}>
                  <Skeleton className="mt-1.5 size-2 shrink-0 rounded-full" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-3 w-4/5" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              ))}
            </>
          ) : items.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <Bell aria-hidden className="mx-auto size-5 text-muted-foreground/50" />
              <p className="mt-2 text-muted-foreground text-sm">{t('notifications.empty')}</p>
            </div>
          ) : (
            items.map((item) => <NotificationRow item={item} key={item.id} onOpen={openItem} />)
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
