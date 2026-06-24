import { AlertTriangle, Check, ChevronDown, Info, Lightbulb, type LucideIcon, OctagonAlert } from 'lucide-react';
import { Children, isValidElement, type ReactNode, useState } from 'react';
import { type CalloutType, normalizeType } from '@/components/site/mdx-config';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import { cn } from '@/lib/utils';

// ─── Callouts / admonitions ─────────────────────────────────────────────────

const CALLOUT: Record<CalloutType, { icon: LucideIcon; cls: string }> = {
  note: { icon: Info, cls: 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100' },
  info: { icon: Info, cls: 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100' },
  tip: { icon: Lightbulb, cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100' },
  check: { icon: Check, cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100' },
  warning: { icon: AlertTriangle, cls: 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100' },
  danger: { icon: OctagonAlert, cls: 'border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-100' },
};

export function Callout({ type, children }: { type?: string; children?: ReactNode }) {
  const meta = CALLOUT[normalizeType(type)];
  const Icon = meta.icon;
  return (
    <div className={cn('my-5 flex gap-3 rounded-xl border p-4', meta.cls)} role="note">
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>
    </div>
  );
}

// ─── Cards ──────────────────────────────────────────────────────────────────

export function CardGroup({ cols, children }: { cols?: string | number; children?: ReactNode }) {
  const n = Math.min(4, Math.max(1, Number(String(cols ?? 2).replace(/[^0-9]/g, '')) || 2));
  const colsClass = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }[n];
  return <div className={cn('my-5 grid grid-cols-1 gap-4', colsClass)}>{children}</div>;
}

export function Card({ title, href, icon, children }: { title?: string; href?: string; icon?: string; children?: ReactNode }) {
  const inner = (
    <>
      {icon ? (
        <span className="mb-2 grid size-7 place-items-center rounded-lg bg-primary/15 text-primary" aria-hidden>
          {hasIcon(icon) ? <PageIcon name={icon} className="size-4" /> : <span className="font-mono text-[11px]">{icon[0]?.toUpperCase()}</span>}
        </span>
      ) : null}
      {title ? <div className="font-semibold">{title}</div> : null}
      {children ? <div className="mt-1 text-muted-foreground text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div> : null}
    </>
  );
  const base = 'block rounded-xl border border-border bg-card p-4 transition-colors';
  return href ? (
    <a href={href} className={cn(base, 'hover:border-primary/50 hover:bg-muted')}>
      {inner}
    </a>
  ) : (
    <div className={base}>{inner}</div>
  );
}

// ─── Steps ──────────────────────────────────────────────────────────────────

export function Steps({ children }: { children?: ReactNode }) {
  const steps = Children.toArray(children).filter(isValidElement);
  return (
    <div className="my-5 flex flex-col gap-5 border-border border-s ps-6">
      {steps.map((step, i) => (
        <div key={step.key} className="relative">
          <span className="-start-[2.45rem] absolute grid size-7 place-items-center rounded-full bg-primary font-semibold text-primary-foreground text-xs">
            {i + 1}
          </span>
          {step}
        </div>
      ))}
    </div>
  );
}

export function Step({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">
      {title ? <div className="mb-1 font-semibold">{title}</div> : null}
      {children}
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

export function Tabs({ children }: { children?: ReactNode }) {
  const tabs = Children.toArray(children).filter(isValidElement) as Array<React.ReactElement<{ title?: string; children?: ReactNode }>>;
  const [active, setActive] = useState(0);
  if (tabs.length === 0) return null;
  return (
    <div className="my-5">
      <div className="flex gap-1 border-border border-b">
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(i)}
            className={cn(
              '-mb-px cursor-pointer border-b-2 px-3 py-2 font-medium text-sm transition-colors',
              i === active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.props.title ?? `Tab ${i + 1}`}
          </button>
        ))}
      </div>
      <div className="pt-3 [&>:first-child]:mt-0 [&>:last-child]:mb-0">{tabs[active]}</div>
    </div>
  );
}

export function Tab({ children }: { title?: string; children?: ReactNode }) {
  return <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>;
}

// ─── Accordions ─────────────────────────────────────────────────────────────

export function AccordionGroup({ children }: { children?: ReactNode }) {
  return <div className="my-5 divide-y divide-border overflow-hidden rounded-xl border border-border">{children}</div>;
}

export function Accordion({ title, defaultOpen, children }: { title?: string; defaultOpen?: string | boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen === true || defaultOpen === 'true');
  return (
    <div className="border-border [&:not(:first-child)]:border-t">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-start font-medium"
      >
        {title ?? 'Details'}
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? <div className="px-4 pb-4 text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div> : null}
    </div>
  );
}

// ─── Frame & Tooltip ──────────────────────────────────────────────────────────

export function Frame({ caption, children }: { caption?: string; children?: ReactNode }) {
  return (
    <figure className="my-5 overflow-hidden rounded-xl border border-border bg-muted/30 p-3">
      <div className="overflow-hidden rounded-lg [&>img]:my-0 [&>img]:w-full">{children}</div>
      {caption ? <figcaption className="mt-2 text-center text-muted-foreground text-xs">{caption}</figcaption> : null}
    </figure>
  );
}

export function Tooltip({ tip, children }: { tip?: string; children?: ReactNode }) {
  return (
    <span className="cursor-help underline decoration-dotted underline-offset-2" title={tip}>
      {children}
    </span>
  );
}
