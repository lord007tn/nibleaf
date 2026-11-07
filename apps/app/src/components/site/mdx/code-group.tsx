import { cn } from '@nibleaf/design-system/lib/utils';
import { siteContentT } from '@nibleaf/i18n/site-content';
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode, useId, useRef, useState } from 'react';
import { handleTabKeyDown } from './utils';

// ─── CodeGroup (tabbed code blocks) ───────────────────────────────────────────

type CodeProps = { className?: string; 'data-title'?: string; 'data-lang'?: string };
type PreElement = ReactElement<{ headerControl?: ReactNode; 'data-title'?: string; 'data-lang'?: string; children?: { props?: CodeProps } }>;

export function CodeGroup({ children, language, dropdown }: { children?: ReactNode; language?: string; dropdown?: boolean | string }) {
  const blocks = Children.toArray(children).filter((child) =>
    isValidElement<{ 'data-title'?: string; 'data-lang'?: string; children?: { props?: CodeProps } }>(child),
  );
  const [active, setActive] = useState(0);
  const codeGroupId = useId();
  const dropdownMode = dropdown !== undefined && dropdown !== false && dropdown !== 'false';
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  if (blocks.length === 0) {
    return null;
  }
  const labelFor = (block: PreElement, index: number): string => {
    const code = block.props?.children;
    const title = block.props?.['data-title'] ?? code?.props?.['data-title'];
    if (title) {
      return title;
    }
    const codeLanguage = /language-([\w+#-]+)/.exec(code?.props?.className ?? '')?.[1] ?? block.props?.['data-lang'] ?? code?.props?.['data-lang'];
    return codeLanguage ? codeLanguage.toUpperCase() : `${siteContentT(language)('tab')} ${index + 1}`;
  };
  return (
    <div className="my-5 overflow-hidden rounded-xl border border-border">
      {dropdownMode ? null : (
        <div className="flex gap-1 overflow-x-auto border-border border-b bg-muted/40 px-2 pt-1.5" role="tablist" aria-orientation="horizontal">
          {blocks.map((block, index) => (
            <button
              key={block.key}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              onClick={() => setActive(index)}
              onKeyDown={(event) => handleTabKeyDown(event, index, blocks.length, language, setActive, tabRefs.current)}
              id={`${codeGroupId}-tab-${index}`}
              role="tab"
              aria-controls={`${codeGroupId}-panel-${index}`}
              aria-selected={index === active}
              tabIndex={index === active ? 0 : -1}
              className={cn(
                '-mb-px shrink-0 cursor-pointer rounded-t-md border-b-2 px-3 py-1.5 font-mono text-xs transition-colors',
                index === active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {labelFor(block, index)}
            </button>
          ))}
        </div>
      )}
      {blocks.map((block, index) => (
        // biome-ignore lint/a11y/useAriaPropsSupportedByRole: both region and tabpanel support aria-labelledby.
        <div
          key={block.key}
          id={`${codeGroupId}-panel-${index}`}
          role={dropdownMode ? 'region' : 'tabpanel'}
          aria-labelledby={dropdownMode ? undefined : `${codeGroupId}-tab-${index}`}
          aria-label={dropdownMode ? labelFor(block, index) : undefined}
          hidden={index !== active}
          className="[&>div]:my-0 [&>div]:rounded-none [&>div]:border-0"
        >
          {dropdownMode
            ? cloneElement(block as PreElement, {
                headerControl: (
                  <label className="reader-code-language-select">
                    <span className="sr-only">{siteContentT(language)('codeLanguage')}</span>
                    <select
                      value={active}
                      onChange={(event) => setActive(Number(event.target.value))}
                      aria-controls={`${codeGroupId}-panel-${active}`}
                    >
                      {blocks.map((item, option) => (
                        <option key={item.key} value={option}>
                          {labelFor(item, option)}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              })
            : block}
        </div>
      ))}
    </div>
  );
}
