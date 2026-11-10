import { Button } from '@nibleaf/design-system/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nibleaf/design-system/components/ui/popover';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { QueryErrorState } from '@/components/query-error-state';
import { useOrganizationSwitcherProjects } from '@/hooks/api';
import { useSwitcherControls } from './switcher-context';
import { isTypingKey, matches, moveWithinPane } from './switcher-model';
import { useCompactSwitcher } from './use-compact-switcher';
import { LiveDot, WebsiteMark } from './website-mark';
import { useWindowedRows } from './windowed-rows';

const SKELETON_ROWS = ['a', 'b', 'c'];

/**
 * `[Website ▾]`: one click to another website of the same organization — a
 * search field over a compact list, nothing else (§5.4.1). Lists only websites
 * you can open in that org.
 */
export function WebsiteSwitcher({
  organization,
  project,
}: {
  organization: { id: string; name: string } | undefined;
  project: { id: string; name: string } | undefined;
}) {
  const t = useT();
  const controls = useSwitcherControls();
  const compact = useCompactSwitcher();
  const registerTrigger = controls?.registerTrigger;
  useEffect(() => registerTrigger?.('website'), [registerTrigger]);
  const open = controls?.open?.kind === 'website';
  const setOpen = (next: boolean) => (next ? controls?.openSwitcher('website') : controls?.close());

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-haspopup="dialog"
            aria-label={project ? t('switcher.websiteTrigger', { name: project.name }) : t('common.loading')}
            className="h-8 min-w-0 max-w-48 gap-1.5 px-1.5 font-medium data-[popup-open]:bg-muted"
            variant="ghost"
          >
            {project ? (
              <span className="min-w-0 truncate">
                <bdi>{project.name}</bdi>
              </span>
            ) : (
              <Skeleton aria-hidden className="h-4 w-20" />
            )}
            <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent
        align="start"
        aria-label={organization ? t('switcher.websiteDialogLabel', { org: organization.name }) : t('switcher.websites')}
        className={cn('h-[min(400px,var(--available-height))] gap-0 overflow-hidden p-0', compact ? 'w-[calc(100vw-2rem)]' : 'w-80')}
        initialFocus={false}
      >
        {open ? <WebsiteList compact={compact} currentProjectId={project?.id} onClose={() => setOpen(false)} organization={organization} /> : null}
      </PopoverContent>
    </Popover>
  );
}

function WebsiteList({
  organization,
  currentProjectId,
  compact,
  onClose,
}: {
  organization: { id: string; name: string } | undefined;
  currentProjectId?: string;
  compact: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const uid = useId();
  const navigate = useNavigate();
  const websites = useOrganizationSwitcherProjects(organization?.id);
  const [query, setQuery] = useState('');
  const rows = useMemo(() => (websites.data ?? []).filter((site) => matches(query, site.name, site.domain)), [websites.data, query]);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowHeight = compact ? 48 : 40;
  const { start, end, padStart, padEnd } = useWindowedRows(listRef, rows.length, rowHeight, index);

  useEffect(() => {
    const current = rows.findIndex((site) => site.id === currentProjectId);
    setIndex(query ? 0 : Math.max(0, current));
  }, [rows, currentProjectId, query]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => (listRef.current ?? searchRef.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const openSite = (projectId: string) => {
    onClose();
    void navigate({ to: '/app/projects/$projectId', params: { projectId } });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const fromSearch = event.target === searchRef.current;
    if (!fromSearch && isTypingKey(event.nativeEvent)) {
      event.preventDefault();
      setQuery((value) => value + event.key);
      searchRef.current?.focus();
      return;
    }
    if (fromSearch && event.key === 'ArrowDown') {
      event.preventDefault();
      listRef.current?.focus();
      return;
    }
    const next = moveWithinPane(event.key, index, rows.length);
    if (next !== null && !(fromSearch && (event.key === 'Home' || event.key === 'End'))) {
      event.preventDefault();
      setIndex(next);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const site = rows[index];
      if (site) openSite(site.id);
    }
  };

  const active = rows[index];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative shrink-0 border-border border-b">
        <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          aria-controls={`${uid}-list`}
          aria-label={t('switcher.websiteSearch')}
          className={cn('w-full bg-transparent ps-9 pe-3 text-sm outline-none placeholder:text-muted-foreground', compact ? 'h-12' : 'h-10')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('switcher.websiteSearch')}
          ref={searchRef}
          type="search"
          value={query}
        />
      </div>
      <div
        aria-activedescendant={active ? `${uid}-${active.id}` : undefined}
        aria-label={organization ? t('switcher.websitesIn', { org: organization.name }) : t('switcher.websites')}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        id={`${uid}-list`}
        onKeyDown={onKeyDown}
        ref={listRef}
        role="listbox"
        tabIndex={0}
      >
        {padStart > 0 ? <div aria-hidden style={{ height: padStart }} /> : null}
        {rows.slice(start, end).map((site, offset) => {
          const rowIndex = start + offset;
          const selected = site.id === currentProjectId;
          return (
            <div
              aria-label={t('switcher.websiteLabel', {
                name: site.name,
                org: organization?.name ?? '',
                status: t(site.live ? 'switcher.status.live' : 'switcher.status.draft'),
              })}
              aria-selected={selected}
              className={cn(
                'flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 text-sm',
                rowIndex === index ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
              )}
              data-row-index={rowIndex}
              id={`${uid}-${site.id}`}
              key={site.id}
              onClick={() => openSite(site.id)}
              onMouseEnter={() => setIndex(rowIndex)}
              role="option"
              style={{ height: rowHeight }}
              tabIndex={-1}
            >
              <WebsiteMark icon={site.icon} />
              <LiveDot live={site.live} />
              <span className="min-w-0 flex-1 truncate">
                <bdi>{site.name}</bdi>
              </span>
              {selected ? <Check aria-hidden className="size-4 shrink-0 text-primary" /> : null}
            </div>
          );
        })}
        {padEnd > 0 ? <div aria-hidden style={{ height: padEnd }} /> : null}
        {websites.isPending ? (
          <div aria-busy="true">
            <p className="sr-only" role="status">
              {t('common.loading')}
            </p>
            {SKELETON_ROWS.map((row) => (
              <div aria-hidden className="flex items-center gap-2.5 px-2.5" key={row} style={{ height: rowHeight }}>
                <Skeleton className="size-6 rounded-md" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        ) : websites.isError && !websites.data ? (
          <div className="p-2">
            <QueryErrorState onRetry={() => void websites.refetch()} retrying={websites.isFetching} />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-muted-foreground text-sm" role="status">
            {t(query ? 'switcher.noResults' : 'switcher.noWebsitesMember')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
