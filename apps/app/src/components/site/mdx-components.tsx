import { cn } from '@nibleaf/design-system/lib/utils';
import { siteT } from '@nibleaf/i18n/site';
import {
  AlertTriangle,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FolderClosed,
  FolderOpen,
  Info,
  Lightbulb,
  Link as LinkIcon,
  type LucideIcon,
  OctagonAlert,
} from 'lucide-react';
import {
  Children,
  type CSSProperties,
  isValidElement,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';
import { z } from 'zod';
import { type CalloutType, normalizeType } from '@/components/site/mdx-config';
import { hasIcon, PageIcon } from '@/components/site/page-icon';

// ─── Callouts / admonitions ─────────────────────────────────────────────────

const CALLOUT: Record<CalloutType, { icon: LucideIcon; token: string }> = {
  note: { icon: Info, token: 'var(--theme-info,var(--primary))' },
  info: { icon: Info, token: 'var(--theme-info,var(--primary))' },
  tip: { icon: Lightbulb, token: 'var(--theme-success,var(--primary))' },
  check: { icon: Check, token: 'var(--theme-success,var(--primary))' },
  warning: { icon: AlertTriangle, token: 'var(--theme-warning,var(--primary))' },
  danger: { icon: OctagonAlert, token: 'var(--theme-danger,var(--destructive))' },
};

export function Callout({ type, children }: { type?: string; children?: ReactNode }) {
  const meta = CALLOUT[normalizeType(type)];
  const Icon = meta.icon;
  return (
    <div
      className="my-5 flex gap-3 rounded-xl border p-4 text-foreground"
      data-theme-component="callout"
      role="note"
      style={
        {
          '--callout-color': meta.token,
          '--callout-border': `color-mix(in oklab,${meta.token} 38%,transparent)`,
          '--callout-bg': `color-mix(in oklab,${meta.token} 10%,transparent)`,
        } as CSSProperties
      }
    >
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
        <span className="mb-3 inline-flex text-primary" aria-hidden>
          {hasIcon(icon) ? (
            <PageIcon name={icon} className="size-5" />
          ) : (
            <span className="grid size-5 place-items-center rounded-md bg-primary/10 font-mono text-[11px]">{icon[0]?.toUpperCase()}</span>
          )}
        </span>
      ) : null}
      {title ? <div className="font-semibold">{title}</div> : null}
      {children ? <div className="mt-1.5 text-muted-foreground text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div> : null}
    </>
  );
  const base = 'block rounded-xl border border-border bg-card p-5 transition-all';
  return href ? (
    <a data-theme-component="card" href={href} className={cn(base, 'hover:-translate-y-px hover:border-primary/50 hover:shadow-sm')}>
      {inner}
    </a>
  ) : (
    <div className={base} data-theme-component="card">
      {inner}
    </div>
  );
}

// ─── Steps ──────────────────────────────────────────────────────────────────

export function Steps({ children }: { children?: ReactNode }) {
  const steps = Children.toArray(children).filter(isValidElement);
  return (
    <div className="my-5 flex flex-col gap-6 border-border border-s ps-6">
      {steps.map((step, i) => (
        <div key={step.key} className="relative">
          {/* size-6 chip at -start-9 centers exactly on the 1.5rem rail line. */}
          <span className="-start-9 absolute grid size-6 place-items-center rounded-full border border-border bg-muted font-semibold text-foreground text-xs">
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

const truthyAttr = (value: unknown): boolean => value === true || value === '' || value === 'true';

function handleTabKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  current: number,
  count: number,
  language: string | undefined,
  setActive: (index: number) => void,
  tabRefs: Array<HTMLButtonElement | null>,
) {
  const explicitDirection = event.currentTarget.closest('[dir]')?.getAttribute('dir');
  const rtl = explicitDirection ? explicitDirection === 'rtl' : /^(ar|fa|he|ur)(-|$)/i.test(language ?? '');
  let next: number | undefined;
  if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = count - 1;
  } else if (event.key === 'ArrowRight') {
    next = (current + (rtl ? -1 : 1) + count) % count;
  } else if (event.key === 'ArrowLeft') {
    next = (current + (rtl ? 1 : -1) + count) % count;
  }
  if (next === undefined) {
    return;
  }
  event.preventDefault();
  setActive(next);
  tabRefs[next]?.focus();
}

export function Tabs({ children, language }: { children?: ReactNode; language?: string }) {
  const tabs = Children.toArray(children).filter((child) => isValidElement<{ title?: string; children?: ReactNode }>(child));
  const [active, setActive] = useState(0);
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const t = siteT(language);
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
  const t = siteT(language);
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
        {title ?? t('details')}
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

// ─── Inline icon ──────────────────────────────────────────────────────────────

export function Icon({ icon, name, color, size }: { icon?: string; name?: string; color?: string; size?: string | number }) {
  const resolved = icon ?? name;
  if (!resolved) {
    return null;
  }
  const parsedSize = z.coerce
    .number()
    .min(1)
    .max(128)
    .safeParse(String(size ?? '').replace(/[^0-9.]/g, ''));
  const px = parsedSize.success ? parsedSize.data : undefined;
  const style: CSSProperties = { color };
  if (px) {
    style.width = px;
    style.height = px;
  }
  return (
    <span className="inline-flex align-text-bottom" style={style}>
      <PageIcon name={resolved} className={px ? 'h-full w-full' : 'size-[1.1em]'} />
    </span>
  );
}

// ─── API reference: ParamField / ResponseField / Expandable ───────────────────

function FieldRow({
  name,
  type,
  required,
  defaultValue,
  deprecated,
  children,
  language,
}: {
  name?: string;
  type?: string;
  required?: unknown;
  defaultValue?: string;
  deprecated?: unknown;
  children?: ReactNode;
  language?: string;
}) {
  const t = siteT(language);
  return (
    <div className="border-border border-b py-3 first:pt-0 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {name ? <code className="rounded bg-muted px-1.5 py-0.5 font-mono font-semibold text-[0.8rem]">{name}</code> : null}
        {type ? <span className="font-mono text-muted-foreground text-xs">{type}</span> : null}
        {truthyAttr(required) ? (
          <span className="font-medium text-[11px] text-red-600 uppercase tracking-wide dark:text-red-400">{t('required')}</span>
        ) : null}
        {truthyAttr(deprecated) ? (
          <span className="font-medium text-[11px] text-amber-600 uppercase tracking-wide dark:text-amber-400">{t('deprecated')}</span>
        ) : null}
        {defaultValue ? (
          <span className="text-muted-foreground text-xs">
            {t('defaultValue')}: <code className="font-mono">{defaultValue}</code>
          </span>
        ) : null}
      </div>
      {children ? <div className="mt-1.5 text-muted-foreground text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div> : null}
    </div>
  );
}

export function ParamField({
  path,
  query,
  header,
  body,
  name,
  type,
  required,
  default: defaultValue,
  deprecated,
  children,
  language,
}: {
  path?: string;
  query?: string;
  header?: string;
  body?: string;
  name?: string;
  type?: string;
  required?: unknown;
  default?: string;
  deprecated?: unknown;
  children?: ReactNode;
  language?: string;
}) {
  return (
    <FieldRow
      name={path ?? query ?? header ?? body ?? name}
      type={type}
      required={required}
      defaultValue={defaultValue}
      deprecated={deprecated}
      language={language}
    >
      {children}
    </FieldRow>
  );
}

export function ResponseField({
  name,
  type,
  required,
  default: defaultValue,
  deprecated,
  children,
  language,
}: {
  name?: string;
  type?: string;
  required?: unknown;
  default?: string;
  deprecated?: unknown;
  children?: ReactNode;
  language?: string;
}) {
  return (
    <FieldRow name={name} type={type} required={required} defaultValue={defaultValue} deprecated={deprecated} language={language}>
      {children}
    </FieldRow>
  );
}

export function Expandable({
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
  const expandableId = useId();
  const t = siteT(language);
  return (
    <div className="my-4 overflow-hidden rounded-xl border border-border">
      <button
        id={`${expandableId}-trigger`}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={`${expandableId}-panel`}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-start font-medium text-sm"
      >
        <ChevronRight className={cn('size-4 shrink-0 transition-transform rtl:-scale-x-100', open && 'rotate-90')} aria-hidden />
        {title ?? t('showProperties')}
      </button>
      <section
        id={`${expandableId}-panel`}
        aria-labelledby={`${expandableId}-trigger`}
        hidden={!open}
        className="border-border border-t px-4 py-3 [&>:first-child]:mt-0 [&>:last-child]:mb-0"
      >
        {children}
      </section>
    </div>
  );
}

// ─── Update (changelog entry) ─────────────────────────────────────────────────

export function Update({ label, description, children }: { label?: string; description?: string; children?: ReactNode }) {
  return (
    <div className="my-6 border-border border-s ps-6">
      {label ? (
        <span className="-ms-[calc(1.5rem+0.5px)] mb-2 inline-block rounded-full border border-border bg-card px-3 py-0.5 font-medium text-xs">
          {label}
        </span>
      ) : null}
      {description ? <div className="mb-2 text-muted-foreground text-sm">{description}</div> : null}
      <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>
    </div>
  );
}

// ─── Layout and inline UI ────────────────────────────────────────────────────

export function Columns({ children }: { children?: ReactNode }) {
  const count = Math.min(4, Math.max(1, Children.toArray(children).filter(isValidElement).length));
  const colsClass = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' }[count];
  return <div className={cn('my-5 grid grid-cols-1 gap-4', colsClass)}>{children}</div>;
}

export function Column({ children }: { children?: ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-5 [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>;
}

export function Banner({ type, children }: { type?: string; children?: ReactNode }) {
  return (
    <div
      className={cn(
        'my-5 rounded-xl border px-4 py-3 text-sm',
        type === 'warning' ? 'border-amber-500/35 bg-amber-500/10' : 'border-primary/30 bg-primary/8',
      )}
    >
      {children}
    </div>
  );
}

export function Badge({ color, children }: { color?: string; children?: ReactNode }) {
  return (
    <span data-color={color} className="inline-flex rounded-full bg-muted px-2 py-0.5 font-semibold text-[0.78em] text-foreground align-middle">
      {children}
    </span>
  );
}

export function MdxButton({ href, variant, children }: { href?: string; variant?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      data-variant={variant}
      className={cn(
        'inline-flex items-center rounded-lg px-3 py-1.5 font-semibold text-sm no-underline',
        variant === 'outline' ? 'border border-border bg-card text-foreground' : 'bg-primary text-primary-foreground',
      )}
    >
      {children}
    </a>
  );
}

// ─── Authored file tree ─────────────────────────────────────────────────────

/** Visualizes authored names only. It deliberately has no path, repository,
 * manifest, snapshot, or network integration. */
export function FileTree({ children }: { children?: ReactNode }) {
  return (
    <ul
      className="my-5 list-none rounded-xl border border-border bg-muted/25 p-3 font-mono text-sm [&_ul]:ms-4 [&_ul]:list-none [&_ul]:border-border [&_ul]:border-s [&_ul]:ps-2"
      data-theme-component="file-tree"
    >
      {children}
    </ul>
  );
}

export function Folder({ name, defaultOpen, children }: { name?: string; defaultOpen?: string | boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(() => truthyAttr(defaultOpen));
  const folderId = useId();
  if (!name) {
    return (
      <li>
        <ul>{children}</ul>
      </li>
    );
  }
  const FolderIcon = open ? FolderOpen : FolderClosed;
  return (
    <li className="my-0.5">
      <button
        id={`${folderId}-trigger`}
        type="button"
        aria-controls={`${folderId}-contents`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform rtl:-scale-x-100', open && 'rotate-90')} aria-hidden />
        <FolderIcon className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 truncate">{name}</span>
      </button>
      <ul id={`${folderId}-contents`} aria-labelledby={`${folderId}-trigger`} hidden={!open}>
        {children}
      </ul>
    </li>
  );
}

export function File({ name, icon }: { name?: string; icon?: string }) {
  if (!name) {
    return null;
  }
  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1 text-muted-foreground">
      <span className="size-3.5 shrink-0" aria-hidden />
      {icon && hasIcon(icon) ? (
        <PageIcon name={icon} className="size-4 shrink-0" aria-hidden />
      ) : (
        <FileIcon className="size-4 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 truncate">{name}</span>
    </li>
  );
}

// ─── Authored API examples ──────────────────────────────────────────────────

export function ApiExample({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <section className="my-6 overflow-hidden rounded-xl border border-border" data-theme-component="api-example" aria-label={title}>
      {title ? <div className="border-border border-b bg-muted/40 px-4 py-3 font-semibold">{title}</div> : null}
      <div className="grid grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0 rtl:lg:divide-x-reverse">{children}</div>
    </section>
  );
}

function ExamplePanel({ title, status, kind, children }: { title?: string; status?: string; kind: 'request' | 'response'; children?: ReactNode }) {
  return (
    <section data-example-kind={kind} className="min-w-0 p-4 [&>:last-child]:mb-0" aria-label={title}>
      {title || status ? (
        <div className="mb-3 flex min-h-6 items-center justify-between gap-3">
          {title ? (
            <div className="flex items-center gap-2 font-semibold text-sm">
              <Braces className="size-4 text-primary" aria-hidden />
              {title}
            </div>
          ) : (
            <span />
          )}
          {status ? <code className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{status}</code> : null}
        </div>
      ) : null}
      <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>
    </section>
  );
}

export function RequestExample({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <ExamplePanel title={title} kind="request">
      {children}
    </ExamplePanel>
  );
}

export function ResponseExample({ title, status, children }: { title?: string; status?: string; children?: ReactNode }) {
  return (
    <ExamplePanel title={title} status={status} kind="response">
      {children}
    </ExamplePanel>
  );
}

// ─── Related content ────────────────────────────────────────────────────────

export function RelatedContent({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <section className="my-8" data-theme-component="related-content">
      {title ? <h2 className="mb-3 text-lg">{title}</h2> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function RelatedCard({
  title,
  description,
  href,
  icon,
  children,
}: {
  title?: string;
  description?: string;
  href?: string;
  icon?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      <span className="mt-0.5 text-primary" aria-hidden>
        {icon && hasIcon(icon) ? <PageIcon name={icon} className="size-4" /> : <LinkIcon className="size-4" />}
      </span>
      <span className="min-w-0">
        {title ? <span className="block font-semibold text-foreground">{title}</span> : null}
        {description ? <span className="mt-1 block text-muted-foreground text-sm">{description}</span> : null}
        {children ? <span className="mt-1 block text-muted-foreground text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</span> : null}
      </span>
    </>
  );
  const className = 'flex gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-colors hover:border-primary/50';
  return href ? (
    <a href={href} className={className} data-theme-component="related-card">
      {body}
    </a>
  ) : (
    <div className={className} data-theme-component="related-card">
      {body}
    </div>
  );
}

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
  const labelFor = (block: PreElement, index: number): string => {
    const code = block.props?.children;
    const title = block.props?.['data-title'] ?? code?.props?.['data-title'];
    if (title) {
      return title;
    }
    const codeLanguage = /language-([\w+#-]+)/.exec(code?.props?.className ?? '')?.[1] ?? block.props?.['data-lang'] ?? code?.props?.['data-lang'];
    return codeLanguage ? codeLanguage.toUpperCase() : `${siteT(language)('tab')} ${index + 1}`;
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
