import { cn } from '@nibleaf/design-system/lib/utils';
import { siteContentT } from '@nibleaf/i18n/site-content';
import { Children, isValidElement, type ReactNode, useId, useRef, useState } from 'react';
import { handleTabKeyDown } from './utils';

// ─── Tabs ───────────────────────────────────────────────────────────────────

export function Tabs({ children, language }: { children?: ReactNode; language?: string }) {
  const tabs = Children.toArray(children).filter((child) => isValidElement<{ title?: string; children?: ReactNode }>(child));
  const [active, setActive] = useState(0);
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const t = siteContentT(language);
  if (tabs.length === 0) return null;
  return (
    <div className="my-5">
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
            onClick={() => setActive(i)}
            onKeyDown={(event) => handleTabKeyDown(event, i, tabs.length, language, setActive, tabRefs.current)}
            id={`${tabsId}-tab-${i}`}
            role="tab"
            aria-controls={`${tabsId}-panel-${i}`}
            aria-selected={i === active}
            tabIndex={i === active ? 0 : -1}
            className={cn(
              '-mb-px shrink-0 cursor-pointer border-b-2 px-3 py-2 font-medium text-sm transition-colors',
              i === active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.props.title ?? `${t('tab')} ${i + 1}`}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.key}
          id={`${tabsId}-panel-${i}`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-${i}`}
          hidden={i !== active}
          className="pt-3 [&>:first-child]:mt-0 [&>:last-child]:mb-0"
        >
          {tab}
        </div>
      ))}
    </div>
  );
}

export function Tab({ children }: { title?: string; children?: ReactNode }) {
  return <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>;
}
