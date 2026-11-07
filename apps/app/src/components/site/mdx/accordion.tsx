import { cn } from '@nibleaf/design-system/lib/utils';
import { siteContentT } from '@nibleaf/i18n/site-content';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import { AuthoredIcon } from './authored-icon';
import { authoredAnchor, hashMatches, truthyAttr, useLocationHash } from './utils';

// ─── Accordions ─────────────────────────────────────────────────────────────

export function AccordionGroup({ children }: { children?: ReactNode }) {
  return <div className="my-5 divide-y divide-border overflow-hidden rounded-xl border border-border">{children}</div>;
}

export function Accordion({
  title,
  description,
  icon,
  id,
  defaultOpen,
  children,
  language,
}: {
  title?: string;
  /** Detail shown under the title. */
  description?: string;
  icon?: string;
  /** Deep-link anchor (`#id`); the accordion also opens for the slug of its title. */
  id?: unknown;
  defaultOpen?: string | boolean;
  children?: ReactNode;
  language?: string;
}) {
  const [open, setOpen] = useState(() => truthyAttr(defaultOpen));
  const accordionId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const anchor = authoredAnchor(id);
  const t = siteContentT(language);
  useLocationHash((hash) => {
    if (!hashMatches(hash, anchor, title)) return;
    setOpen(true);
    wrapper.current?.scrollIntoView?.({ block: 'start' });
  });
  return (
    <div ref={wrapper} id={anchor} className={anchor ? 'scroll-mt-[var(--content-scroll-mt,6rem)]' : undefined}>
      <button
        id={`${accordionId}-trigger`}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${accordionId}-panel`}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-start font-medium"
      >
        <span className="flex min-w-0 items-start gap-2.5">
          {icon ? (
            <span className="mt-0.5 inline-flex shrink-0 text-primary" aria-hidden>
              <AuthoredIcon icon={icon} className="size-4" />
            </span>
          ) : null}
          <span className="min-w-0">
            <span className="block">{title ?? t('details')}</span>
            {description ? <span className="mt-0.5 block font-normal text-muted-foreground text-sm">{description}</span> : null}
          </span>
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
