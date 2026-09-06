/** `src/components/mdx/*`: the Nibleaf authoring components (Callout, Card,
 * Tabs, Steps, FileTree, …) as small readable files. Tag names are lowercase
 * because they arrive through rehype-raw as HTML elements. */
export const mdxSharedTemplate = (): string => String.raw`import type { ReactNode } from 'react';

export interface MdxProps {
  children?: ReactNode;
  [key: string]: unknown;
}

export const stringAttr = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
export const truthy = (value: unknown): boolean => value === true || value === '' || value === 'true';
export const authoredName = (props: MdxProps): string | undefined =>
  stringAttr(props['data-display-name']) ?? stringAttr(props.dataDisplayName) ?? stringAttr(props.name);
/** Only same-site, http(s) and mailto links are rendered as anchors. */
export const safeHref = (value: unknown): string | undefined => {
  const href = stringAttr(value)?.trim();
  return href && /^(?:https?:|mailto:|\/(?!\/)|#|\.\/|\.\.\/)/i.test(href) ? href : undefined;
};
`;

export const mdxCalloutsTemplate = (): string => `import { CircleCheck, Info, Lightbulb, OctagonAlert, TriangleAlert } from 'lucide-react';
import { type MdxProps, stringAttr } from './shared';

const ICONS = { note: Info, info: Info, tip: Lightbulb, check: CircleCheck, warning: TriangleAlert, danger: OctagonAlert } as const;
type CalloutType = keyof typeof ICONS;
const calloutType = (value: unknown): CalloutType => {
  const type = stringAttr(value)?.toLowerCase();
  return type && type in ICONS ? (type as CalloutType) : 'note';
};

export const Callout = ({ children, type }: MdxProps) => {
  const kind = calloutType(type);
  const Icon = ICONS[kind];
  return (
    <aside className={'mdx-callout mdx-callout-' + kind} data-type={kind}>
      <Icon aria-hidden="true" className="mdx-callout-icon" size={18} />
      <div className="mdx-callout-body">{children}</div>
    </aside>
  );
};

export const calloutOf = (kind: CalloutType) =>
  function NamedCallout({ children }: MdxProps) {
    return <Callout type={kind}>{children}</Callout>;
  };

export const Banner = ({ children }: MdxProps) => <aside className="mdx-banner">{children}</aside>;
`;

export const mdxCardsTemplate = (): string => `import { type MdxProps, safeHref, stringAttr } from './shared';

export const CardGroup = ({ children, cols }: MdxProps) => (
  <section className="mdx-card-grid" data-cols={stringAttr(cols)}>
    {children}
  </section>
);

export const Card = ({ children, href, title }: MdxProps) => {
  const content = (
    <>
      <strong className="mdx-card-title">{stringAttr(title)}</strong>
      <div className="mdx-card-body">{children}</div>
    </>
  );
  const link = safeHref(href);
  return link ? (
    <a className="mdx-card" href={link}>
      {content}
    </a>
  ) : (
    <div className="mdx-card">{content}</div>
  );
};

export const Columns = ({ children }: MdxProps) => <div className="mdx-columns">{children}</div>;
export const Column = ({ children }: MdxProps) => <div className="mdx-column">{children}</div>;

export const RelatedContent = ({ children, title }: MdxProps) => (
  <nav aria-label={stringAttr(title)} className="mdx-related-content">
    {title ? <strong>{stringAttr(title)}</strong> : null}
    <div className="mdx-related-grid">{children}</div>
  </nav>
);

export const RelatedCard = ({ children, description, href, title }: MdxProps) => {
  const content = (
    <>
      <strong>{stringAttr(title)}</strong>
      {description ? <span>{stringAttr(description)}</span> : null}
      {children}
    </>
  );
  const link = safeHref(href);
  return link ? (
    <a className="mdx-related-card" href={link}>
      {content}
    </a>
  ) : (
    <div className="mdx-related-card">{content}</div>
  );
};
`;

export const mdxTabsTemplate = (): string => `import { Children, isValidElement, type KeyboardEvent, useId, useState } from 'react';
import { type MdxProps, stringAttr } from './shared';

/** Arrow keys follow the reading direction, so RTL readers move "forward" with ArrowLeft. */
export const nextTabIndex = (active: number, count: number, key: string, direction: 'ltr' | 'rtl'): number | null => {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  if (key === forward) return (active + 1) % count;
  if (key === backward) return (active + count - 1) % count;
  return null;
};

export const Tabs = ({ children }: MdxProps) => {
  const tabs = Children.toArray(children).flatMap((child) => (isValidElement<MdxProps>(child) ? [child] : []));
  const [active, setActive] = useState(0);
  const id = useId();
  if (tabs.length === 0) return null;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
    const next = nextTabIndex(active, tabs.length, event.key, direction);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div className="mdx-tabs">
      <div role="tablist">
        {tabs.map((tab, index) => (
          <button
            aria-controls={id + '-panel-' + index}
            aria-selected={index === active}
            id={id + '-tab-' + index}
            key={tab.key ?? index}
            onClick={() => setActive(index)}
            onKeyDown={onKeyDown}
            role="tab"
            tabIndex={index === active ? 0 : -1}
            type="button"
          >
            {stringAttr(tab.props.title) ?? index + 1}
          </button>
        ))}
      </div>
      <div aria-labelledby={id + '-tab-' + active} id={id + '-panel-' + active} role="tabpanel">
        {tabs[active]?.props.children}
      </div>
    </div>
  );
};

export const Tab = ({ children }: MdxProps) => <>{children}</>;
export const CodeGroup = ({ children }: MdxProps) => <div className="mdx-code-group">{children}</div>;
`;

export const mdxDisclosureTemplate = (): string => `import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { type MdxProps, stringAttr, truthy } from './shared';

export const Accordion = ({ children, defaultOpen, defaultopen, title }: MdxProps) => {
  const id = useId();
  const [open, setOpen] = useState(truthy(defaultopen ?? defaultOpen));
  return (
    <section className="mdx-accordion">
      <button aria-controls={id} aria-expanded={open} onClick={() => setOpen((value) => !value)} type="button">
        <span>{stringAttr(title)}</span>
        <ChevronDown aria-hidden="true" className={open ? 'rotate-180 transition-transform' : 'transition-transform'} size={16} />
      </button>
      {open ? <div id={id}>{children}</div> : null}
    </section>
  );
};

export const AccordionGroup = ({ children }: MdxProps) => <div className="mdx-accordion-group">{children}</div>;
export const Expandable = Accordion;
`;

export const mdxStepsTemplate = (): string => `import { Children, isValidElement } from 'react';
import { type MdxProps, stringAttr } from './shared';

export const Steps = ({ children }: MdxProps) => (
  <ol className="mdx-steps">
    {Children.toArray(children)
      .filter(isValidElement)
      .map((child) => (
        <li key={child.key}>{child}</li>
      ))}
  </ol>
);

export const Step = ({ children, title }: MdxProps) => (
  <section>
    {title ? <strong className="mdx-step-title">{stringAttr(title)}</strong> : null}
    {children}
  </section>
);

export const Update = ({ children, label }: MdxProps) => (
  <section className="mdx-update">
    <strong>{stringAttr(label)}</strong>
    {children}
  </section>
);
`;

export const mdxFieldsTemplate = (): string => `import { type MdxProps, stringAttr, truthy } from './shared';

const Field = ({ children, name, required, type }: MdxProps) => (
  <section className="mdx-field">
    <code dir="ltr">{stringAttr(name)}</code>
    <span className="mdx-field-type">
      {stringAttr(type)}
      {truthy(required) ? ' · required' : ''}
    </span>
    <div>{children}</div>
  </section>
);

export const ParamField = Field;
export const ResponseField = Field;
`;

export const mdxFileTreeTemplate = (): string => `import { File as FileIcon, Folder as FolderIcon } from 'lucide-react';
import { authoredName, type MdxProps, truthy } from './shared';

export const FileTree = ({ children }: MdxProps) => (
  <ul className="mdx-file-tree" dir="ltr">
    {children}
  </ul>
);

export const Folder = (props: MdxProps) => (
  <li className="mdx-folder">
    <details open={truthy(props.defaultopen ?? props.defaultOpen)}>
      <summary>
        <FolderIcon aria-hidden="true" className="mdx-icon" />
        {' '}
        {authoredName(props)}
      </summary>
      <ul>{props.children}</ul>
    </details>
  </li>
);

export const File = (props: MdxProps) => (
  <li className="mdx-file">
    <FileIcon aria-hidden="true" className="mdx-icon" />
    {' '}
    {authoredName(props)}
  </li>
);
`;

export const mdxApiExampleTemplate = (): string => `import { type MdxProps, stringAttr } from './shared';

export const ApiExample = ({ children, title }: MdxProps) => (
  <section className="mdx-api-example">
    {title ? <strong>{stringAttr(title)}</strong> : null}
    <div>{children}</div>
  </section>
);

export const RequestExample = ({ children, title }: MdxProps) => (
  <section>
    {title ? <strong>{stringAttr(title)}</strong> : null}
    {children}
  </section>
);

export const ResponseExample = ({ children, status, title }: MdxProps) => (
  <section>
    {title ? <strong>{stringAttr(title)}</strong> : null}
    {status ? <code dir="ltr">{stringAttr(status)}</code> : null}
    {children}
  </section>
);
`;

export const mdxTooltipTemplate = (): string => `import { useId } from 'react';
import { type MdxProps, stringAttr } from './shared';

/** Keyboard users reach the trigger with Tab; the text is exposed through
 * aria-describedby and never traps focus. */
export const Tooltip = ({ children, tip }: MdxProps) => {
  const id = useId();
  const label = stringAttr(tip);
  if (!label) return <>{children}</>;
  return (
    <span className="mdx-tooltip">
      <span aria-describedby={id} className="mdx-tooltip-trigger" tabIndex={0}>
        {children}
      </span>
      <span className="mdx-tooltip-content" id={id} role="tooltip">
        {label}
      </span>
    </span>
  );
};
`;

export const mdxInlineTemplate = (): string => `import { Code, File, Folder, Info, Link, type LucideIcon, Star, TriangleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';
import { authoredName, type MdxProps, safeHref, stringAttr } from './shared';

const icons: Record<string, LucideIcon> = { info: Info, warning: TriangleAlert, code: Code, file: File, folder: Folder, link: Link, star: Star };
const iconSize = (value: unknown): number | undefined => {
  const size = Number(value);
  return Number.isInteger(size) && size >= 8 && size <= 96 ? size : undefined;
};

export const Icon = (props: MdxProps) => {
  const name = stringAttr(props.icon) ?? authoredName(props);
  if (!name) return null;
  const Glyph = icons[name.toLowerCase()];
  const style: CSSProperties = { color: stringAttr(props.color) };
  const size = iconSize(props.size);
  if (size) style.fontSize = size;
  return Glyph ? (
    <Glyph aria-label={name} className="mdx-icon" role="img" style={style} />
  ) : (
    <span aria-label={name} className="mdx-icon" role="img" style={style}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
};

export const Badge = ({ children }: MdxProps) => <span className="mdx-badge">{children}</span>;

export const Button = ({ children, href }: MdxProps) => {
  const link = safeHref(href);
  return link ? (
    <a className="mdx-button" href={link}>
      {children}
    </a>
  ) : (
    <span className="mdx-button">{children}</span>
  );
};

export const Frame = ({ caption, children }: MdxProps) => (
  <figure className="mdx-frame">
    {children}
    {caption ? <figcaption>{stringAttr(caption)}</figcaption> : null}
  </figure>
);
`;

export const mdxIndexTemplate = (): string => `import type { ComponentPropsWithoutRef, FunctionComponent } from 'react';
import { ApiExample, RequestExample, ResponseExample } from './api-example';
import { Banner, Callout, calloutOf } from './callouts';
import { Card, CardGroup, Column, Columns, RelatedCard, RelatedContent } from './cards';
import { Accordion, AccordionGroup, Expandable } from './disclosure';
import { ParamField, ResponseField } from './fields';
import { File, FileTree, Folder } from './file-tree';
import { Badge, Button, Frame, Icon } from './inline';
import type { MdxProps } from './shared';
import { Step, Steps, Update } from './steps';
import { CodeGroup, Tab, Tabs } from './tabs';
import { Tooltip } from './tooltip';

export { nextTabIndex } from './tabs';
export { Tooltip } from './tooltip';

type DocumentationTag =
  | 'callout' | 'note' | 'info' | 'tip' | 'check' | 'warning' | 'danger'
  | 'cardgroup' | 'card' | 'columns' | 'column' | 'relatedcontent' | 'relatedcard'
  | 'tabs' | 'tab' | 'codegroup' | 'accordiongroup' | 'accordion' | 'expandable'
  | 'steps' | 'step' | 'update' | 'paramfield' | 'responsefield'
  | 'filetree' | 'folder' | 'file' | 'apiexample' | 'requestexample' | 'responseexample'
  | 'tooltip' | 'icon' | 'badge' | 'banner' | 'mdxframe';
type ButtonProps = ComponentPropsWithoutRef<'button'> & { href?: unknown; node?: unknown };
type DocumentationComponents = Record<DocumentationTag, FunctionComponent<MdxProps>> & { button: FunctionComponent<ButtonProps> };

/** Lowercase keys: rehype-raw lowercases authored tag names. */
export const mdxComponents: DocumentationComponents = {
  callout: Callout,
  note: calloutOf('note'),
  info: calloutOf('info'),
  tip: calloutOf('tip'),
  check: calloutOf('check'),
  warning: calloutOf('warning'),
  danger: calloutOf('danger'),
  banner: Banner,
  cardgroup: CardGroup,
  card: Card,
  columns: Columns,
  column: Column,
  relatedcontent: RelatedContent,
  relatedcard: RelatedCard,
  tabs: Tabs,
  tab: Tab,
  codegroup: CodeGroup,
  accordiongroup: AccordionGroup,
  accordion: Accordion,
  expandable: Expandable,
  steps: Steps,
  step: Step,
  update: Update,
  paramfield: ParamField,
  responsefield: ResponseField,
  filetree: FileTree,
  folder: Folder,
  file: File,
  apiexample: ApiExample,
  requestexample: RequestExample,
  responseexample: ResponseExample,
  tooltip: Tooltip,
  icon: Icon,
  badge: Badge,
  button: ({ children, href }: ButtonProps) => <Button href={href}>{children}</Button>,
  mdxframe: Frame,
};
`;
