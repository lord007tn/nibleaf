import { cn } from '@nibleaf/design-system/lib/utils';
import { siteContentT } from '@nibleaf/i18n/site-content';
import { Children, isValidElement, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { AuthoredIcon } from './authored-icon';
import { authoredAnchor, handleTabKeyDown, hashMatches, optionalNumber, truthyAttr, useLocationHash } from './utils';

// ─── Tabs ───────────────────────────────────────────────────────────────────

interface TabProps {
  title?: string;
  icon?: string;
  /** Deep-link anchor (`#id`); a tab is also reachable by the slug of its title. */
  id?: unknown;
  children?: ReactNode;
}

/** Tabs with `sync` (the default) switch together when a tab with the same title is picked anywhere on the page. */
const TAB_SYNC_EVENT = 'nibleaf:tab-sync';
type TabSyncDetail = { title: string; source: string };

export function Tabs({
  children,
  language,
  defaultTabIndex,
  sync,
  borderBottom,
}: {
  children?: ReactNode;
  language?: string;
  defaultTabIndex?: unknown;
  sync?: unknown;
  borderBottom?: unknown;
}) {
  const tabs = Children.toArray(children).filter((child) => isValidElement<TabProps>(child));
  const initial = Math.min(Math.max(0, Math.trunc(optionalNumber(defaultTabIndex) ?? 0)), Math.max(0, tabs.length - 1));
  const [active, setActive] = useState(initial);
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const t = siteContentT(language);
  const synced = sync === undefined || sync === null || sync === '' || truthyAttr(sync);
  const titles = tabs.map((tab) => tab.props.title ?? '');
  const anchors = tabs.map((tab) => authoredAnchor(tab.props.id));
  const titlesKey = titles.join('\u0000');

  useLocationHash((hash) => {
    const index = tabs.findIndex((_tab, i) => hashMatches(hash, anchors[i], titles[i]));
    if (index < 0) return;
    setActive(index);
    tabRefs.current[index]?.scrollIntoView?.({ block: 'nearest' });
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `titlesKey` stands for the `titles` it is built from.
  useEffect(() => {
    if (!synced) return;
    const follow = (event: Event) => {
      const detail = (event as CustomEvent<TabSyncDetail>).detail;
      if (!detail || detail.source === tabsId) return;
      const index = titles.indexOf(detail.title);
      if (index >= 0) setActive(index);
    };
    window.addEventListener(TAB_SYNC_EVENT, follow);
    return () => window.removeEventListener(TAB_SYNC_EVENT, follow);
  }, [synced, tabsId, titlesKey]);

  const select = (index: number) => {
    setActive(index);
    const title = titles[index];
    if (synced && title) {
      window.dispatchEvent(new CustomEvent<TabSyncDetail>(TAB_SYNC_EVENT, { detail: { title, source: tabsId } }));
    }
  };

  if (tabs.length === 0) return null;
  const tabId = (i: number) => anchors[i] ?? `${tabsId}-tab-${i}`;
  return (
    <div className={cn('my-5', truthyAttr(borderBottom) && 'border-border border-b pb-5')} data-tabs-sync={synced ? undefined : 'false'}>
      <div
        className="flex gap-1 overflow-x-auto border-border border-b"
        data-theme-component="tabs-list"
        role="tablist"
        aria-orientation="horizontal"
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(element) => {
              tabRefs.current[i] = element;
            }}
            type="button"
            onClick={() => select(i)}
            onKeyDown={(event) => handleTabKeyDown(event, i, tabs.length, language, select, tabRefs.current)}
            id={tabId(i)}
            role="tab"
            aria-controls={`${tabsId}-panel-${i}`}
            aria-selected={i === active}
            tabIndex={i === active ? 0 : -1}
            className={cn(
              '-mb-px inline-flex shrink-0 scroll-mt-[var(--content-scroll-mt,6rem)] cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 font-medium text-sm transition-colors',
              i === active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <AuthoredIcon icon={tab.props.icon} className="size-4 shrink-0" />
            {tab.props.title ?? `${t('tab')} ${i + 1}`}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.key}
          id={`${tabsId}-panel-${i}`}
          role="tabpanel"
          aria-labelledby={tabId(i)}
          hidden={i !== active}
          className="pt-3 [&>:first-child]:mt-0 [&>:last-child]:mb-0"
        >
          {tab}
        </div>
      ))}
    </div>
  );
}

export function Tab({ children }: TabProps) {
  return <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>;
}
