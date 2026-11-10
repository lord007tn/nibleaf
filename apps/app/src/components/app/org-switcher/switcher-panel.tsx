import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useDirection } from '@nibleaf/design-system/components/ui/direction';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, ChevronRight, Plus, Search, Settings } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';
import { QueryErrorState } from '@/components/query-error-state';
import {
  type OrgRole,
  organizationSwitcherProjectsQueryOptions,
  type RecentWebsite,
  type SwitcherOrganization,
  type SwitcherWebsite,
  useOrganizationSwitcherProjects,
  useSwitcher,
} from '@/hooks/api';
import { OrgAvatar } from './org-avatar';
import { useSwitcherControls } from './switcher-context';
import { isTypingKey, moveWithinPane, orderOrganizations, type Pane, paneForArrow, type SearchResult, searchSwitcher } from './switcher-model';
import { useCompactSwitcher } from './use-compact-switcher';
import { LiveDot, WebsiteMark } from './website-mark';
import { useWindowedRows } from './windowed-rows';

export const ORG_ROLE_LABEL: Record<OrgRole, MessageKey> = {
  owner: 'roles.owner',
  admin: 'roles.admin',
  member: 'roles.organizationMember',
};

type LeftItem =
  | { kind: 'heading'; id: string; label: string }
  | { kind: 'recent'; id: string; website: RecentWebsite }
  | { kind: 'organization'; id: string; organization: SwitcherOrganization }
  | SearchResult;
type Selectable = Exclude<LeftItem, { kind: 'heading' }>;

const isSelectable = (item: LeftItem | undefined): item is Selectable => Boolean(item && item.kind !== 'heading');
const RIGHT_SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e'];

/**
 * The organization/website switcher body (design §5.4.1): search, Recent and
 * Organizations on the inline-start pane, the hovered or arrow-focused org's
 * websites on the other, footer actions below. At ≤ 640 px it becomes one
 * drill-down screen at a time with 44 px rows.
 */
export function SwitcherPanel({
  currentOrganizationId,
  currentProjectId,
  initialPane = 'orgs',
  onClose,
}: {
  currentOrganizationId?: string;
  currentProjectId?: string;
  initialPane?: Pane;
  onClose: () => void;
}) {
  const t = useT();
  const direction = useDirection() === 'rtl' ? 'rtl' : 'ltr';
  const compact = useCompactSwitcher();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const controls = useSwitcherControls();
  const uid = useId();
  const switcher = useSwitcher();
  const organizations = useMemo(
    () => orderOrganizations(switcher.data?.organizations ?? [], currentOrganizationId),
    [switcher.data?.organizations, currentOrganizationId],
  );
  const recent = switcher.data?.recent ?? [];
  const oneOrg = organizations.length === 1;
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const [previewId, setPreviewId] = useState<string | undefined>(currentOrganizationId);
  const previewOrg = organizations.find((org) => org.id === previewId) ?? organizations[0];
  const [pane, setPane] = useState<Pane>(initialPane);
  // Compact: which screen of the drill-down is showing. One org leads with its websites.
  const [screen, setScreen] = useState<'list' | 'organization'>(initialPane === 'websites' ? 'organization' : 'list');
  const showingOrgScreen = compact && screen === 'organization';
  useEffect(() => {
    if (compact && oneOrg && !searching) setScreen('organization');
  }, [compact, oneOrg, searching]);

  // Combined search reads every org's website list (fetched once per org, then cached).
  const searchLists = useQueries({ queries: searching ? organizations.map((org) => organizationSwitcherProjectsQueryOptions(org.id)) : [] });
  const websitesByOrg = useMemo(() => {
    const map = new Map<string, SwitcherWebsite[]>();
    organizations.forEach((org, index) => {
      const list = searchLists[index]?.data;
      if (list) map.set(org.id, list);
    });
    return map;
  }, [organizations, searchLists]);
  const searchPending = searching && searchLists.some((result) => result.isPending);

  const leftItems = useMemo<LeftItem[]>(() => {
    if (searching) return searchSwitcher(query, organizations, websitesByOrg, recent);
    const items: LeftItem[] = [];
    if (recent.length > 0) {
      items.push({ kind: 'heading', id: 'heading-recent', label: t('switcher.recent') });
      for (const website of recent) items.push({ kind: 'recent', id: `recent-${website.id}`, website });
    }
    if (!oneOrg && organizations.length > 0) {
      items.push({ kind: 'heading', id: 'heading-orgs', label: t('switcher.organizations') });
      for (const organization of organizations) items.push({ kind: 'organization', id: `org-${organization.id}`, organization });
    }
    return items;
  }, [searching, query, organizations, websitesByOrg, recent, oneOrg, t]);

  const websites = useOrganizationSwitcherProjects(previewOrg?.id);
  const rightItems = websites.data ?? [];

  const initialLeft = Math.max(
    0,
    leftItems.findIndex((item) => item.kind === 'organization' && item.organization.id === currentOrganizationId),
  );
  const [leftIndex, setLeftIndex] = useState(() => (isSelectable(leftItems[initialLeft]) ? initialLeft : leftItems.findIndex(isSelectable)));
  const [rightIndex, setRightIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  // A list that changed under the cursor (new search, loaded org) keeps a valid option active.
  useEffect(() => {
    if (!isSelectable(leftItems[leftIndex])) setLeftIndex(leftItems.findIndex(isSelectable));
  }, [leftItems, leftIndex]);
  useEffect(() => {
    if (rightIndex >= rightItems.length) setRightIndex(Math.max(0, rightItems.length - 1));
  }, [rightItems.length, rightIndex]);
  useEffect(() => {
    const current = rightItems.findIndex((site) => site.id === currentProjectId);
    if (current >= 0) setRightIndex(current);
  }, [rightItems, currentProjectId]);

  // Focus starts on a list so arrows work at once; typing moves to search. Decided once, on open.
  const initialFocus = useRef(initialPane === 'websites' || (oneOrg && !compact) ? rightRef : leftRef);
  useEffect(() => {
    const target = initialFocus.current;
    const frame = requestAnimationFrame(() => (target.current ?? searchRef.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const prefetch = (organizationId: string) => void queryClient.prefetchQuery(organizationSwitcherProjectsQueryOptions(organizationId));
  const preview = (organizationId: string) => {
    setPreviewId(organizationId);
    prefetch(organizationId);
  };

  const close = () => onClose();
  const openWebsite = (projectId: string) => {
    close();
    void navigate({ to: '/app/projects/$projectId', params: { projectId } });
  };
  const openOrganization = (slug: string) => {
    close();
    void navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug: slug } });
  };
  const activateLeft = (item: LeftItem | undefined) => {
    if (!isSelectable(item)) return;
    if (item.kind === 'organization') {
      if (compact) {
        preview(item.organization.id);
        setScreen('organization');
        setPane('websites');
        requestAnimationFrame(() => rightRef.current?.focus());
      } else openOrganization(item.organization.slug);
    } else openWebsite(item.website.id);
  };

  const focusPane = (next: Pane) => {
    setPane(next);
    if (compact) setScreen(next === 'websites' ? 'organization' : 'list');
    requestAnimationFrame(() => (next === 'websites' ? rightRef : leftRef).current?.focus());
  };
  const typeIntoSearch = (event: KeyboardEvent) => {
    event.preventDefault();
    setQuery((value) => value + event.key);
    if (compact) setScreen('list');
    setPane('orgs');
    searchRef.current?.focus();
  };

  const onLeftKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingKey(event.nativeEvent)) return typeIntoSearch(event);
    const next = moveWithinPane(event.key, leftIndex, leftItems.length);
    if (next !== null) {
      event.preventDefault();
      // Skip heading rows in the direction of travel.
      const step = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1;
      let index = next;
      while (leftItems[index] && !isSelectable(leftItems[index])) index += step;
      if (!isSelectable(leftItems[index])) return;
      setLeftIndex(index);
      const item = leftItems[index];
      if (item?.kind === 'organization') preview(item.organization.id);
      else if (item?.kind === 'recent') preview(item.website.organization.id);
      else if (item?.kind === 'website') preview(item.organization.id);
      return;
    }
    if (event.key === 'ArrowUp' && leftIndex <= leftItems.findIndex(isSelectable)) {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (paneForArrow(event.key, 'orgs', direction) === 'websites' && rightItems.length > 0) {
      event.preventDefault();
      focusPane('websites');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      activateLeft(leftItems[leftIndex]);
    }
  };
  const onRightKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingKey(event.nativeEvent)) return typeIntoSearch(event);
    const next = moveWithinPane(event.key, rightIndex, rightItems.length);
    if (next !== null) {
      event.preventDefault();
      setRightIndex(next);
      return;
    }
    if (paneForArrow(event.key, 'websites', direction) === 'orgs' && !(compact && oneOrg && leftItems.length === 0)) {
      event.preventDefault();
      focusPane('orgs');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const site = rightItems[rightIndex];
      if (site) openWebsite(site.id);
    }
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setLeftIndex(leftItems.findIndex(isSelectable));
      if (compact) setScreen('list');
      leftRef.current?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activateLeft(leftItems.find(isSelectable));
    }
  };

  const optionId = (id: string) => `${uid}-${id}`;
  const rowHeight = compact ? 48 : 40;
  const activeLeft = leftItems[leftIndex];
  const leftLabel = searching ? t('switcher.results') : t('switcher.organizations');
  const rightLabel = previewOrg ? t('switcher.websitesIn', { org: previewOrg.name }) : t('switcher.websites');

  const searchField = (
    <div className="relative shrink-0 border-border border-b">
      <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        aria-controls={`${uid}-left`}
        aria-label={t('switcher.search')}
        className={cn(
          'w-full bg-transparent ps-9 pe-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:bg-muted/40',
          compact ? 'h-12' : 'h-10',
        )}
        onChange={(event) => {
          setQuery(event.target.value);
          if (compact) setScreen('list');
        }}
        onFocus={() => setPane('orgs')}
        onKeyDown={onSearchKeyDown}
        placeholder={t('switcher.search')}
        ref={searchRef}
        type="search"
        value={query}
      />
    </div>
  );

  const leftPane = (
    <Listbox
      activeId={isSelectable(activeLeft) ? optionId(activeLeft.id) : undefined}
      activeIndex={leftIndex}
      containerRef={leftRef}
      id={`${uid}-left`}
      label={leftLabel}
      onKeyDown={onLeftKeyDown}
      rowHeight={rowHeight}
      rows={leftItems}
      renderRow={(item, index) => {
        if (item.kind === 'heading') {
          return (
            <div
              aria-hidden
              className="flex items-end px-3 pb-1.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wider"
              key={item.id}
              role="presentation"
              style={{ height: rowHeight }}
            >
              {item.label}
            </div>
          );
        }
        const active = index === leftIndex && pane === 'orgs';
        if (item.kind === 'organization') {
          const org = item.organization;
          return (
            <Option
              active={active}
              id={optionId(item.id)}
              index={index}
              key={item.id}
              label={`${org.name}, ${t(ORG_ROLE_LABEL[org.orgRole])}`}
              onClick={() => {
                setLeftIndex(index);
                activateLeft(item);
              }}
              onHover={() => preview(org.id)}
              previewed={!searching && org.id === previewOrg?.id}
              rowHeight={rowHeight}
              selected={org.id === currentOrganizationId}
            >
              <OrgAvatar logo={org.logo} name={org.name} />
              <span className="min-w-0 flex-1 truncate">
                <bdi>{org.name}</bdi>
              </span>
              <Badge className="font-normal" variant="secondary">
                {t(ORG_ROLE_LABEL[org.orgRole])}
              </Badge>
              {compact ? <ChevronRight aria-hidden className="size-4 text-muted-foreground rtl:-scale-x-100" /> : null}
            </Option>
          );
        }
        const website = item.kind === 'recent' ? item.website : item.website;
        const organization = item.kind === 'recent' ? item.website.organization : item.organization;
        return (
          <Option
            active={active}
            id={optionId(item.id)}
            index={index}
            key={item.id}
            label={t('switcher.websiteLabel', {
              name: website.name,
              org: organization.name,
              status: t(website.live ? 'switcher.status.live' : 'switcher.status.draft'),
            })}
            onClick={() => openWebsite(website.id)}
            onHover={() => preview(organization.id)}
            rowHeight={rowHeight}
            selected={website.id === currentProjectId}
          >
            <LiveDot live={website.live} />
            <span className="min-w-0 flex-1 truncate">
              <bdi>{website.name}</bdi>
              <span className="text-muted-foreground">
                {' · '}
                <bdi>{organization.name}</bdi>
              </span>
            </span>
          </Option>
        );
      }}
    >
      {switcher.isPending ? <LeftSkeleton /> : null}
      {switcher.isError && !switcher.data ? (
        <div className="p-2">
          <QueryErrorState onRetry={() => void switcher.refetch()} retrying={switcher.isFetching} title={t('switcher.loadError')} />
        </div>
      ) : null}
      {searching && !searchPending && leftItems.length === 0 ? (
        <p className="px-3 py-6 text-center text-muted-foreground text-sm" role="status">
          {t('switcher.noResults')}
        </p>
      ) : null}
      {searchPending ? <LeftSkeleton /> : null}
    </Listbox>
  );

  const canManage = previewOrg ? previewOrg.orgRole !== 'member' : false;
  const rightPane = previewOrg ? (
    <>
      <div className="flex shrink-0 items-center gap-2 border-border border-b px-3" style={{ minHeight: rowHeight + 4 }}>
        {compact && !(oneOrg && recent.length === 0) ? (
          <Button aria-label={t('switcher.back')} className="-ms-1 size-11" onClick={() => focusPane('orgs')} size="icon" variant="ghost">
            <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
          </Button>
        ) : null}
        <OrgAvatar logo={previewOrg.logo} name={previewOrg.name} />
        <Link
          className="min-w-0 flex-1 truncate rounded-sm font-semibold text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={close}
          params={{ orgSlug: previewOrg.slug }}
          title={t('switcher.openOrganization', { org: previewOrg.name })}
          to="/app/o/$orgSlug/websites"
        >
          <bdi>{previewOrg.name}</bdi>
        </Link>
        <Badge className="font-normal" variant="secondary">
          {t(ORG_ROLE_LABEL[previewOrg.orgRole])}
        </Badge>
        {canManage ? (
          <Button
            aria-label={t('switcher.organizationSettings', { org: previewOrg.name })}
            className={compact ? 'size-11' : undefined}
            nativeButton={false}
            onClick={close}
            render={<Link params={{ orgSlug: previewOrg.slug }} to="/app/o/$orgSlug/settings" />}
            size="icon-sm"
            variant="ghost"
          >
            <Settings aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>
      <Listbox
        activeId={rightItems[rightIndex] ? optionId(`site-${rightItems[rightIndex]?.id}`) : undefined}
        activeIndex={rightIndex}
        containerRef={rightRef}
        id={`${uid}-right`}
        label={rightLabel}
        onKeyDown={onRightKeyDown}
        rowHeight={rowHeight}
        rows={rightItems}
        renderRow={(site, index) => (
          <Option
            active={index === rightIndex && pane === 'websites'}
            id={optionId(`site-${site.id}`)}
            index={index}
            key={site.id}
            label={t('switcher.websiteLabel', {
              name: site.name,
              org: previewOrg.name,
              status: t(site.live ? 'switcher.status.live' : 'switcher.status.draft'),
            })}
            onClick={() => openWebsite(site.id)}
            onHover={() => setRightIndex(index)}
            rowHeight={rowHeight}
            selected={site.id === currentProjectId}
          >
            <WebsiteMark icon={site.icon} />
            <LiveDot live={site.live} />
            {/* dir on the truncating box itself, so a Latin name or domain is cut at its end in RTL too. */}
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {site.name}
            </span>
            <span className="max-w-[45%] truncate text-muted-foreground text-xs" dir="ltr">
              {site.domain ?? '—'}
            </span>
          </Option>
        )}
      >
        {websites.isPending ? (
          <div aria-busy="true">
            <p className="sr-only" role="status">
              {t('common.loading')}
            </p>
            {RIGHT_SKELETON_ROWS.map((row) => (
              <div aria-hidden className="flex items-center gap-2.5 px-2.5" key={row} style={{ height: rowHeight }}>
                <Skeleton className="size-6 shrink-0 rounded-md" />
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="ms-auto h-3 w-1/4" />
              </div>
            ))}
          </div>
        ) : websites.isError && !websites.data ? (
          <div className="p-2">
            <QueryErrorState onRetry={() => void websites.refetch()} retrying={websites.isFetching} />
          </div>
        ) : rightItems.length === 0 ? (
          <p className="px-3 py-6 text-center text-muted-foreground text-sm">
            {t(previewOrg.canCreateWebsite ? 'switcher.noWebsitesAdmin' : 'switcher.noWebsitesMember')}
          </p>
        ) : null}
      </Listbox>
    </>
  ) : null;

  const footer = (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-border border-t p-1.5">
      {previewOrg?.canCreateWebsite ? (
        <Button
          className={cn('min-w-0 justify-start', compact && 'min-h-11')}
          nativeButton={false}
          onClick={close}
          render={<Link params={{ orgSlug: previewOrg.slug }} search={{ newSite: true }} to="/app/o/$orgSlug/websites" />}
          size="sm"
          variant="ghost"
        >
          <Plus aria-hidden className="size-4" />
          <span className="truncate">{t('switcher.newWebsiteIn', { org: previewOrg.name })}</span>
        </Button>
      ) : (
        <span />
      )}
      <Button className={cn(compact && 'min-h-11')} onClick={() => controls?.openCreateOrganization()} size="sm" variant="ghost">
        <Plus aria-hidden className="size-4" />
        {t('switcher.newOrganization')}
      </Button>
    </div>
  );

  if (compact) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-compact="true">
        {showingOrgScreen ? null : searchField}
        <div className="flex min-h-0 flex-1 flex-col">{showingOrgScreen ? rightPane : leftPane}</div>
        {footer}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {oneOrg ? searchField : null}
      <div className="flex min-h-0 flex-1">
        {/* Inline-start pane: in RTL it sits on the right and the arrows mirror. */}
        {!oneOrg || recent.length > 0 || searching ? (
          <div className={cn('flex min-h-0 shrink-0 flex-col border-border border-e', oneOrg ? 'w-56' : 'w-[17.5rem]')}>
            {oneOrg ? null : searchField}
            {leftPane}
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{rightPane}</div>
      </div>
      {footer}
    </div>
  );
}

function LeftSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-1 p-1.5">
      {['a', 'b', 'c', 'd'].map((row) => (
        <div className="flex h-9 items-center gap-2.5 px-2" key={row}>
          <Skeleton className="size-6 shrink-0 rounded-md" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** A scrolling listbox using aria-activedescendant; rows past 50 are windowed. */
function Listbox<T>({
  id,
  label,
  rows,
  rowHeight,
  activeIndex,
  activeId,
  containerRef,
  onKeyDown,
  renderRow,
  children,
}: {
  id: string;
  label: string;
  rows: T[];
  rowHeight: number;
  activeIndex: number;
  activeId?: string;
  containerRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  renderRow: (row: T, index: number) => ReactNode;
  children?: ReactNode;
}) {
  const { start, end, padStart, padEnd } = useWindowedRows(containerRef, rows.length, rowHeight, activeIndex);
  return (
    <div
      aria-activedescendant={activeId}
      aria-label={label}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      id={id}
      onKeyDown={onKeyDown}
      ref={containerRef}
      role="listbox"
      tabIndex={0}
    >
      {padStart > 0 ? <div aria-hidden style={{ height: padStart }} /> : null}
      {rows.slice(start, end).map((row, offset) => renderRow(row, start + offset))}
      {padEnd > 0 ? <div aria-hidden style={{ height: padEnd }} /> : null}
      {children}
    </div>
  );
}

function Option({
  id,
  index,
  label,
  active,
  selected,
  previewed = false,
  rowHeight,
  onClick,
  onHover,
  children,
}: {
  id: string;
  index: number;
  label: string;
  active: boolean;
  selected: boolean;
  previewed?: boolean;
  rowHeight: number;
  onClick: () => void;
  onHover: () => void;
  children: ReactNode;
}) {
  return (
    <div
      aria-label={label}
      aria-selected={selected}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 text-sm',
        active ? 'bg-accent text-accent-foreground' : previewed ? 'bg-muted/60' : 'hover:bg-muted/60',
      )}
      data-active={active}
      data-row-index={index}
      id={id}
      onClick={onClick}
      onFocus={onHover}
      onMouseEnter={onHover}
      role="option"
      style={{ height: rowHeight }}
      tabIndex={-1}
    >
      {children}
      {selected ? <Check aria-hidden className="size-4 shrink-0 text-primary" /> : null}
    </div>
  );
}
