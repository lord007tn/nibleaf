import { cn } from '@nibleaf/design-system/lib/utils';
import { siteContentT } from '@nibleaf/i18n/site-content';
import { blockDirection } from '@nibleaf/shared/script-direction';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { ReaderLabel } from './reader-label';
import { truthyAttr } from './utils';

// ─── Accordions ─────────────────────────────────────────────────────────────

export function AccordionGroup({ children }: { children?: ReactNode }) {
  return <div className="my-5 divide-y divide-border overflow-hidden rounded-xl border border-border">{children}</div>;
}

export function Accordion({
  title,
  defaultOpen,
  children,
  language,
}: {
  title?: string;
  defaultOpen?: string | boolean;
  children?: ReactNode;
  language?: string;
}) {
  const [open, setOpen] = useState(() => truthyAttr(defaultOpen));
  const accordionId = useId();
  const t = siteContentT(language);
  return (
    <div>
      <button
        id={`${accordionId}-trigger`}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${accordionId}-panel`}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-start font-medium"
      >
        <span className="min-w-0" dir={title ? blockDirection(title) : undefined}>
          {title ?? <ReaderLabel language={language}>{t('details')}</ReaderLabel>}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <section
        id={`${accordionId}-panel`}
        aria-labelledby={`${accordionId}-trigger`}
        hidden={!open}
        className="px-4 pb-4 text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0"
      >
        {children}
      </section>
    </div>
  );
}
