import { cn } from '@nibleaf/design-system/lib/utils';
import { siteContentT } from '@nibleaf/i18n/site-content';
import { Children, isValidElement, type ReactElement, type ReactNode, useId, useRef, useState } from 'react';
import { ReaderLabel } from './reader-label';
import { handleTabKeyDown } from './utils';

// ─── CodeGroup (tabbed code blocks) ───────────────────────────────────────────

type CodeProps = { className?: string; 'data-title'?: string; 'data-lang'?: string };
type PreElement = ReactElement<{ 'data-title'?: string; 'data-lang'?: string; children?: { props?: CodeProps } }>;

export function CodeGroup({ children, language }: { children?: ReactNode; language?: string }) {
  const blocks = Children.toArray(children).filter((child) =>
    isValidElement<{ 'data-title'?: string; 'data-lang'?: string; children?: { props?: CodeProps } }>(child),
  );
  const [active, setActive] = useState(0);
  const codeGroupId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  if (blocks.length === 0) {
    return null;
  }
  const labelFor = (block: PreElement, index: number): ReactNode => {
    const code = block.props?.children;
    const title = block.props?.['data-title'] ?? code?.props?.['data-title'];
    if (title) {
      return title;
    }
    const codeLanguage = /language-([\w+#-]+)/.exec(code?.props?.className ?? '')?.[1] ?? block.props?.['data-lang'] ?? code?.props?.['data-lang'];
    return codeLanguage ? (
      codeLanguage.toUpperCase()
    ) : (
      <ReaderLabel language={language}>{`${siteContentT(language)('tab')} ${index + 1}`}</ReaderLabel>
    );
  };
  return (
    <div className="my-5 overflow-hidden rounded-xl border border-border">
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
      {blocks.map((block, index) => (
        <div
          key={block.key}
          id={`${codeGroupId}-panel-${index}`}
          role="tabpanel"
          aria-labelledby={`${codeGroupId}-tab-${index}`}
          hidden={index !== active}
          className="[&>div]:my-0 [&>div]:rounded-none [&>div]:border-0"
        >
          {block}
        </div>
      ))}
    </div>
  );
}
