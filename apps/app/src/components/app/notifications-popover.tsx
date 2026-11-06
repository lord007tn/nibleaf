import { Button } from '@nibleaf/design-system/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nibleaf/design-system/components/ui/popover';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { QueryErrorState } from '@/components/query-error-state';
import { useMarkNotificationsRead, useNotifications, useUnreadNotificationCount } from '@/hooks/api';
import type { NotificationItem } from '@/hooks/api/types';
import { useFormatters } from '@/lib/format';

const NOTIFICATION_SKELETON_ROWS = ['a', 'b', 'c'];

/** One inbox row: unread dot, title/body, relative time. Clicking marks it read
 *  and follows its dashboard link (when it has one). */
function NotificationRow({ item, onOpen }: { item: NotificationItem; onOpen: (item: NotificationItem) => void }) {
  const { relativeTime } = useFormatters();
  const unread = item.readAt === null;
  return (
    <button
      className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 text-start outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={() => onOpen(item)}
      type="button"
    >
      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? 'bg-primary' : 'bg-transparent'}`} />
      <span className="min-w-0 flex-1 leading-snug">
        <span className={`block truncate text-sm ${unread ? 'font-semibold' : 'font-medium'}`} dir="auto">
          {item.title}
        </span>
        {item.body ? (
          <span className="mt-0.5 line-clamp-2 block text-muted-foreground text-xs" dir="auto">
            {item.body}
          </span>
        ) : null}
        <span className="mt-1 block text-[11px] text-muted-foreground/80">{relativeTime(item.createdAt)}</span>
      </span>
    </button>
  );
}

/**
 * The header bell: unread badge (polled every 60s) + a popover inbox. The list
 * itself is only fetched once the popover opens. Lives in BOTH shells — the
 * workspace header (layouts/dashboard) and the per-site header (layouts/project).
 */
export function NotificationsPopover() {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: unread } = useUnreadNotificationCount();
  const { data: inbox, isPending, isError, isFetching, refetch } = useNotifications({ enabled: open });
  const markRead = useMarkNotificationsRead();
  // The same mutation marks single rows read; only "Mark all read" spins this button.
  const markingAll = markRead.isPending && markRead.variables?.all === true;

  const unreadCount = unread?.count ?? 0;
  const items = inbox?.items ?? [];

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
          <Button aria-label={t('notifications.bellLabel')} className="relative size-8" size="icon" variant="ghost">
            <Bell className="size-4" />
            {unreadCount > 0 ? (
              <span className="-top-0.5 -end-0.5 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : null}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-90 gap-0 p-0">
        <div className="flex items-center justify-between border-border border-b px-4 py-2.5">
          <span className="font-semibold text-sm">{t('notifications.title')}</span>
          <Button
            className="h-7 px-2 text-xs"
            disabled={unreadCount === 0}
            loading={markingAll}
            onClick={() => markRead.mutate({ all: true })}
            size="sm"
            variant="ghost"
          >
            {t('notifications.markAllRead')}
          </Button>
        </div>
        <div aria-busy={isPending && !isError ? true : undefined} className="max-h-96 overflow-y-auto p-1.5">
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
