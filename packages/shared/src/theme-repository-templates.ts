import type { ThemePresetId } from './themes';

export interface ThemeRepositoryTemplateSource {
  componentName: 'HarborTheme' | 'ManuscriptTheme' | 'SignalTheme';
  displayName: 'Harbor' | 'Manuscript' | 'Signal';
  accent: string;
  source: string;
  style: string;
}

export const themeUtilitiesSource = `import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { defaultSchema } from 'rehype-sanitize';
import type { SitePage, SiteSnapshot } from '../nibleaf/runtime';

export { documentationMarkdownComponents } from './mdx-components';

export const visibleDocumentationPages = (pages: SitePage[]): SitePage[] => pages.filter((page) => page.kind === 'PAGE' && !page.hidden);
export const chromeLocale = (languageCode: string | undefined): 'en' | 'ar' => languageCode === 'ar' ? 'ar' : 'en';

export const moveFocusToFirstSearchResult = (event: KeyboardEvent<HTMLInputElement>): boolean => {
  if (event.key !== 'ArrowDown') return false;
  const result = event.currentTarget.closest('[data-documentation-search]')?.querySelector<HTMLButtonElement>('[data-search-result]');
  if (!result) return false;
  event.preventDefault();
  result.focus();
  return true;
};

export const useScopedDocumentation = (snapshot: SiteSnapshot) => {
  const visiblePages = useMemo(() => visibleDocumentationPages(snapshot.pages), [snapshot.pages]);
  const languages = useMemo(() => snapshot.project.languages.filter((item) => item.enabled !== false), [snapshot.project.languages]);
  const defaultLanguage = languages.find((item) => item.isDefault) ?? languages[0] ?? snapshot.project.languages[0];
  const defaultVersion = snapshot.project.versions.find((item) => item.isDefault) ?? snapshot.project.versions[0];
  const initialPage =
    visiblePages.find((item) => item.languageCode === defaultLanguage?.code && item.versionId === defaultVersion?.id) ?? visiblePages[0];
  const [languageCode, setLanguageCode] = useState(initialPage?.languageCode ?? defaultLanguage?.code);
  const [versionId, setVersionId] = useState(initialPage?.versionId ?? defaultVersion?.id);
  const [activeId, setActiveId] = useState(initialPage?.id);
  const [searchQuery, setSearchQuery] = useState('');
  const language = languages.find((item) => item.code === languageCode) ?? defaultLanguage;
  const version = snapshot.project.versions.find((item) => item.id === versionId) ?? defaultVersion;
  const scopedPages = useMemo(
    () => visiblePages.filter((item) => item.languageCode === language?.code && item.versionId === version?.id),
    [language?.code, version?.id, visiblePages],
  );
  const page = scopedPages.find((item) => item.id === activeId) ?? scopedPages[0];
  const pageForScope = (nextLanguageCode: string | undefined, nextVersionId: string | undefined) => {
    const candidates = visiblePages.filter((item) => item.languageCode === nextLanguageCode && item.versionId === nextVersionId);
    return candidates.find((item) => Boolean(page?.translationKey) && item.translationKey === page?.translationKey) ?? candidates[0];
  };
  const selectLanguage = (nextLanguageCode: string) => {
    setLanguageCode(nextLanguageCode);
    setActiveId(pageForScope(nextLanguageCode, version?.id)?.id);
    setSearchQuery('');
  };
  const selectVersion = (nextVersionId: string) => {
    setVersionId(nextVersionId);
    setActiveId(pageForScope(language?.code, nextVersionId)?.id);
    setSearchQuery('');
  };
  const selectPage = (nextPageId: string) => {
    if (scopedPages.some((item) => item.id === nextPageId)) setActiveId(nextPageId);
    setSearchQuery('');
  };
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase(language?.code);
  const searchResults = normalizedQuery
    ? scopedPages
        .filter((item) => [item.title, item.description ?? '', item.content].join(' ').toLocaleLowerCase(language?.code).includes(normalizedQuery))
        .slice(0, 8)
    : [];
  return {
    activeId: page?.id,
    language,
    languages,
    page,
    scopedPages,
    searchQuery,
    searchResults,
    selectLanguage,
    selectPage,
    selectVersion,
    setSearchQuery,
    version,
  };
};

export const documentationSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'callout', 'note', 'info', 'tip', 'check', 'warning', 'danger', 'card', 'cardgroup', 'tabs', 'tab', 'accordion', 'accordiongroup', 'steps', 'step', 'mdxframe', 'tooltip', 'icon', 'paramfield', 'responsefield', 'expandable', 'codegroup', 'update', 'columns', 'column', 'banner', 'badge', 'button', 'filetree', 'folder', 'file', 'apiexample', 'requestexample', 'responseexample', 'relatedcontent', 'relatedcard'],
  attributes: {
    ...defaultSchema.attributes,
    card: ['title', 'href', 'icon'], cardgroup: ['cols'], callout: ['type'], tab: ['title'],
    accordion: ['title', 'defaultOpen', 'defaultopen'], step: ['title'], mdxframe: ['caption'], tooltip: ['tip'], icon: ['icon', 'dataDisplayName', 'color', 'size'],
    paramfield: ['path', 'query', 'header', 'body', 'name', 'type', 'required', 'default', 'deprecated'],
    responsefield: ['name', 'type', 'required', 'default', 'deprecated'], expandable: ['title', 'defaultOpen', 'defaultopen'],
    update: ['label', 'description'], banner: ['type'], badge: ['color'], button: ['href', 'variant'],
    folder: ['dataDisplayName', 'defaultOpen', 'defaultopen'], file: ['dataDisplayName', 'icon'], apiexample: ['title'],
    requestexample: ['title'], responseexample: ['title', 'status'], relatedcontent: ['title'],
    relatedcard: ['title', 'description', 'href', 'icon'],
  },
};

const blockTags = 'Callout|Note|Warning|Info|Tip|Check|Danger|Card|CardGroup|Tabs|Tab|Accordion|AccordionGroup|Steps|Step|Frame|ParamField|ResponseField|Expandable|Update|Columns|Column|Banner|FileTree|Folder|File|ApiExample|RequestExample|ResponseExample|RelatedContent|RelatedCard';
const openBlock = new RegExp(\`^\\\\s*<(?:\${blockTags})\\\\b(?:[^>]*[^/>])?>\\\\s*$\`, 'i');
const closeBlock = new RegExp(\`^\\\\s*</(?:\${blockTags})>\\\\s*$\`, 'i');
const componentLine = new RegExp(\`^\\\\s*</?(?:\${blockTags})\\\\b[^>]*>\\\\s*$\`, 'i');
export const normalizeDocumentationMarkdown = (source: string): string => {
  const lines = source.split('\\n');
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const authoredLine = lines[index] ?? '';
    const line = componentLine.test(authoredLine) ? authoredLine.trim() : authoredLine;
    if (openBlock.test(line)) {
      output.push(line);
      if (lines[index + 1]?.trim()) output.push('');
    } else if (closeBlock.test(line)) {
      if (output.at(-1)?.trim()) output.push('');
      output.push(line);
    } else {
      output.push(line);
    }
  }
  return output.join('\\n').replace(/<(\\/?)Frame\\b/gi, '<$1mdxframe').replace(/<(File|RelatedCard|Icon)\\b([^>]*)\\/>/gi, '<$1$2></$1>');
};

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };
const authoredNameTags = new Set(['folder', 'file', 'paramfield', 'responsefield', 'icon']);
const structuralTags = new Set(['card', 'tab', 'accordion', 'step', 'column', 'folder', 'file', 'requestexample', 'responseexample', 'relatedcard']);
export const rehypeAuthoredComponentProps = () => (tree: HastNode): void => {
  const visit = (node: HastNode): void => {
    if (node.type === 'element' && node.tagName && authoredNameTags.has(node.tagName) && node.properties?.name !== undefined) {
      node.properties.dataDisplayName = node.properties.name;
      delete node.properties.name;
    }
    if (node.children) {
      node.children = node.children.flatMap((child) => {
        if (
          child.type === 'element' &&
          child.tagName === 'p' &&
          child.children?.every((nested) =>
            nested.type === 'text' ? !nested.value?.trim() : Boolean(nested.tagName && structuralTags.has(nested.tagName)),
          )
        ) {
          return child.children;
        }
        return [child];
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
};

export const useDocumentLanguage = (languageCode: string | undefined, direction: 'LTR' | 'RTL' | undefined): void => {
  useEffect(() => {
    if (!languageCode || !direction) return;
    document.documentElement.lang = languageCode;
    document.documentElement.dir = direction === 'RTL' ? 'rtl' : 'ltr';
  }, [direction, languageCode]);
};
`;

export const themeMdxComponentsSource = `import { AlertTriangle, Check, Code2, File, Folder, Info, Link, Star, type LucideIcon } from 'lucide-react';
import { Children, type ComponentPropsWithoutRef, type CSSProperties, type FunctionComponent, type KeyboardEvent, type ReactNode, createElement, isValidElement, useId, useState } from 'react';
import type { Components } from 'react-markdown';
import { z } from 'zod';

interface MdxProps {
  children?: ReactNode;
  [key: string]: unknown;
}

const optionalStringSchema = z.string().optional().catch(undefined);
const truthySchema = z.union([z.literal(true), z.literal(''), z.literal('true')]);
const iconSizeSchema = z.coerce.number().int().min(8).max(96).optional().catch(undefined);
const stringAttr = (value: unknown) => optionalStringSchema.parse(value);
const truthy = (value: unknown) => truthySchema.safeParse(value).success;
const authoredName = (props: MdxProps): string | undefined => stringAttr(props['data-display-name']) ?? stringAttr(props.dataDisplayName) ?? stringAttr(props.name);
const icons: Record<string, LucideIcon> = { info: Info, warning: AlertTriangle, check: Check, code: Code2, file: File, folder: Folder, link: Link, star: Star };

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

const Disclosure = (props: MdxProps) => (
  <li className="mdx-folder"><details open={truthy(props.defaultopen ?? props.defaultOpen)}><summary>{authoredName(props)}</summary><ul>{props.children}</ul></details></li>
);

const Tabs = ({ children }: MdxProps) => {
  const tabs = Children.toArray(children).flatMap((child) => isValidElement<MdxProps>(child) ? [child] : []);
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
  return <div className="mdx-tabs"><div role="tablist">{tabs.map((tab, index) => <button aria-controls={\`\${id}-panel-\${index}\`} aria-selected={index === active} id={\`\${id}-tab-\${index}\`} key={tab.key ?? index} onClick={() => setActive(index)} onKeyDown={onKeyDown} role="tab" tabIndex={index === active ? 0 : -1} type="button">{stringAttr(tab.props.title) ?? index + 1}</button>)}</div><div aria-labelledby={\`\${id}-tab-\${active}\`} id={\`\${id}-panel-\${active}\`} role="tabpanel">{tabs[active]?.props.children}</div></div>;
};

const Accordion = ({ children, title, defaultopen, defaultOpen }: MdxProps) => {
  const id = useId();
  const [open, setOpen] = useState(truthy(defaultopen ?? defaultOpen));
  return <section className="mdx-accordion"><button aria-controls={id} aria-expanded={open} onClick={() => setOpen((value) => !value)} type="button">{stringAttr(title)}</button>{open ? <div id={id}>{children}</div> : null}</section>;
};

const RelatedCard = ({ children, title, description, href }: MdxProps) => {
  const content = <><strong>{stringAttr(title)}</strong>{description ? <span>{stringAttr(description)}</span> : null}{children}</>;
  const safeHref = stringAttr(href);
  return safeHref ? <a className="mdx-related-card" href={safeHref}>{content}</a> : <div className="mdx-related-card">{content}</div>;
};

export const Tooltip = ({ children, tip }: MdxProps) => {
  const id = useId();
  const label = stringAttr(tip);
  if (!label) return <>{children}</>;
  return <span className="mdx-tooltip"><span aria-describedby={id} className="mdx-tooltip-trigger" tabIndex={0}>{children}</span><span className="mdx-tooltip-content" id={id} role="tooltip">{label}</span></span>;
};

type DocumentationTag = 'callout' | 'note' | 'info' | 'tip' | 'check' | 'warning' | 'danger' | 'cardgroup' | 'card' | 'steps' | 'step' | 'tabs' | 'tab' | 'accordiongroup' | 'accordion' | 'expandable' | 'mdxframe' | 'tooltip' | 'icon' | 'paramfield' | 'responsefield' | 'codegroup' | 'update' | 'columns' | 'column' | 'banner' | 'badge' | 'button' | 'filetree' | 'folder' | 'file' | 'apiexample' | 'requestexample' | 'responseexample' | 'relatedcontent' | 'relatedcard';
type ButtonProps = ComponentPropsWithoutRef<'button'> & { href?: unknown; node?: unknown };
type DocumentationComponents = Omit<Record<DocumentationTag, FunctionComponent<MdxProps>>, 'button'> & { button: FunctionComponent<ButtonProps> };

const customComponents: DocumentationComponents = {
  callout: ({ children }: MdxProps) => <aside className="mdx-callout">{children}</aside>,
  note: ({ children }: MdxProps) => <aside className="mdx-callout">{children}</aside>,
  info: ({ children }: MdxProps) => <aside className="mdx-callout">{children}</aside>,
  tip: ({ children }: MdxProps) => <aside className="mdx-callout">{children}</aside>,
  check: ({ children }: MdxProps) => <aside className="mdx-callout">{children}</aside>,
  warning: ({ children }: MdxProps) => <aside className="mdx-callout">{children}</aside>,
  danger: ({ children }: MdxProps) => <aside className="mdx-callout">{children}</aside>,
  cardgroup: ({ children }: MdxProps) => <section className="mdx-card-grid">{children}</section>,
  card: ({ children, href, title }: MdxProps) => {
    const content = <><strong>{stringAttr(title)}</strong>{children}</>;
    const safeHref = stringAttr(href);
    return safeHref ? <a className="mdx-card" href={safeHref}>{content}</a> : <div className="mdx-card">{content}</div>;
  },
  steps: ({ children }: MdxProps) => <ol className="mdx-steps">{Children.toArray(children).filter(isValidElement).map((child) => <li key={child.key}>{child}</li>)}</ol>,
  step: ({ children, title }: MdxProps) => <section><strong>{stringAttr(title)}</strong>{children}</section>,
  tabs: Tabs,
  tab: ({ children }: MdxProps) => <>{children}</>,
  accordiongroup: ({ children }: MdxProps) => <div className="mdx-accordion-group">{children}</div>,
  accordion: Accordion,
  expandable: Accordion,
  mdxframe: ({ caption, children }: MdxProps) => <figure>{children}{caption ? <figcaption>{stringAttr(caption)}</figcaption> : null}</figure>,
  tooltip: Tooltip,
  icon: (props: MdxProps) => {
    const name = stringAttr(props.icon) ?? authoredName(props);
    if (!name) return null;
    const Icon = icons[name.toLowerCase()];
    const numericSize = iconSizeSchema.parse(props.size);
    const style: CSSProperties = { color: stringAttr(props.color) };
    if (numericSize) style.fontSize = numericSize;
    return Icon ? <Icon aria-label={name} className="mdx-icon" role="img" style={style} /> : <span aria-label={name} className="mdx-icon" role="img" style={style}>{name.slice(0, 1).toUpperCase()}</span>;
  },
  paramfield: ({ children, name, type }: MdxProps) => <section className="mdx-field"><code>{stringAttr(name)}</code><span>{stringAttr(type)}</span>{children}</section>,
  responsefield: ({ children, name, type }: MdxProps) => <section className="mdx-field"><code>{stringAttr(name)}</code><span>{stringAttr(type)}</span>{children}</section>,
  codegroup: ({ children }: MdxProps) => <div className="mdx-code-group">{children}</div>,
  update: ({ children, label }: MdxProps) => <section className="mdx-update"><strong>{stringAttr(label)}</strong>{children}</section>,
  columns: ({ children }: MdxProps) => <div className="mdx-columns">{children}</div>,
  column: ({ children }: MdxProps) => <div>{children}</div>,
  banner: ({ children }: MdxProps) => <aside className="mdx-banner">{children}</aside>,
  badge: ({ children }: MdxProps) => <span className="mdx-badge">{children}</span>,
  button: ({ children, href }: ButtonProps) => {
    const safeHref = stringAttr(href);
    return safeHref ? <a className="mdx-button" href={safeHref}>{children}</a> : <span className="mdx-button">{children}</span>;
  },
  filetree: ({ children }: MdxProps) => <ul className="mdx-file-tree">{children}</ul>,
  folder: Disclosure,
  file: (props: MdxProps) => <li className="mdx-file">{authoredName(props)}</li>,
  apiexample: ({ children, title }: MdxProps) => <section className="mdx-api-example">{title ? <strong>{stringAttr(title)}</strong> : null}<div>{children}</div></section>,
  requestexample: ({ children, title }: MdxProps) => <section>{title ? <strong>{stringAttr(title)}</strong> : null}{children}</section>,
  responseexample: ({ children, status, title }: MdxProps) => <section>{title ? <strong>{stringAttr(title)}</strong> : null}{status ? <code>{stringAttr(status)}</code> : null}{children}</section>,
  relatedcontent: ({ children, title }: MdxProps) => <nav aria-label={stringAttr(title)} className="mdx-related-content">{title ? <strong>{stringAttr(title)}</strong> : null}<div>{children}</div></nav>,
  relatedcard: RelatedCard,
};

export const documentationMarkdownComponents = (overview: string, nextSteps: string) => {
  const components: Components = {
    h2({ children, node: _node, ...props }: ComponentPropsWithoutRef<'h2'> & { node?: unknown }) {
      const label = Children.toArray(children).join('').trim();
      const id = label === overview ? 'overview' : label === nextSteps ? 'next-steps' : undefined;
      return createElement('h2', { ...props, id }, children);
    },
    ...customComponents,
  };
  return components;
};
`;

const harborSource = `import { ExternalLink, Search } from 'lucide-react';
import { useId } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import * as m from '../paraglide/messages.js';
import type { SitePage, SiteSnapshot } from '../nibleaf/runtime';
import { chromeLocale, documentationMarkdownComponents, documentationSanitizeSchema, moveFocusToFirstSearchResult, normalizeDocumentationMarkdown, rehypeAuthoredComponentProps, useDocumentLanguage, useScopedDocumentation } from './theme-utils';

export function HarborTheme({ snapshot }: { snapshot: SiteSnapshot }) {
  const scope = useScopedDocumentation(snapshot);
  const { language, languages, page, scopedPages, searchQuery, searchResults, version } = scope;
  const locale = chromeLocale(language?.code);
  const markdownComponents = documentationMarkdownComponents(m.overview({}, { locale }), m.nextSteps({}, { locale }));
  const searchId = useId();
  const showSearchResults = Boolean(searchQuery.trim());
  useDocumentLanguage(language?.code, language?.direction);
  if (!language || !version) return <main className="empty">{m.noVisiblePages({}, { locale })}</main>;
  return (
    <div className="harbor" dir={language.direction === 'RTL' ? 'rtl' : 'ltr'}>
      <header className="topbar">
        <a className="brand" href="/">{snapshot.project.name}<span>{m.themeLabel({}, { locale })}</span></a>
        <div className="scope-controls">
          <label><span>{m.language({}, { locale })}</span><select aria-label={m.language({}, { locale })} data-scope="language" onChange={(event) => scope.selectLanguage(event.target.value)} value={language.code}>{languages.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          <label><span>{m.version({}, { locale })}</span><select aria-label={m.version({}, { locale })} data-scope="version" onChange={(event) => scope.selectVersion(event.target.value)} value={version.id}>{snapshot.project.versions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        <form className="documentation-search" data-documentation-search onSubmit={(event) => event.preventDefault()} role="search">
          <label htmlFor={searchId}><Search aria-hidden="true" size={16} /><span>{m.search({}, { locale })}</span></label>
          <input aria-controls={searchId + '-results'} aria-expanded={showSearchResults} aria-label={m.search({}, { locale })} id={searchId} onChange={(event) => scope.setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') scope.setSearchQuery(''); else moveFocusToFirstSearchResult(event); }} type="search" value={searchQuery} />
          {showSearchResults ? <div className="search-results" id={searchId + '-results'}>{searchResults.length > 0 ? <ul aria-label={m.searchResults({}, { locale })}>{searchResults.map((item) => <li key={item.id}><button data-search-result onClick={() => scope.selectPage(item.id)} type="button">{item.title}</button></li>)}</ul> : <p role="status">{m.noSearchResults({}, { locale })}</p>}</div> : null}
        </form>
        <a className="github" href="https://github.com" rel="noreferrer"><span>{m.github({}, { locale })}</span><ExternalLink aria-hidden="true" size={14} /></a>
      </header>
      <aside className="sidebar">
        <p className="eyebrow">{m.documentation({}, { locale })}</p>
        <nav aria-label={m.documentation({}, { locale })}>{scopedPages.map((item) => <PageLink active={item.id === page?.id} key={item.id} onSelect={() => scope.selectPage(item.id)} page={item} />)}</nav>
        <div className="extension"><strong>{m.customerOwned({}, { locale })}</strong><p>{m.edit({}, { locale })} <code>src/theme/HarborTheme.tsx</code>. {m.syncPreserves({}, { locale })}</p></div>
      </aside>
      <main className="article">
        {page ? <><label className="mobile-page-picker">
          <span>{m.page({}, { locale })}</span>
          <select aria-label={m.choosePage({}, { locale })} onChange={(event) => scope.selectPage(event.target.value)} value={page.id}>
            {scopedPages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <p className="eyebrow">{language.label} · {version.name}</p>
        <h1>{page.title}</h1>
        {page.description ? <p className="lede">{page.description}</p> : null}
        <article className="prose"><ReactMarkdown components={markdownComponents} rehypePlugins={[rehypeRaw, rehypeAuthoredComponentProps, [rehypeSanitize, documentationSanitizeSchema]]} remarkPlugins={[remarkGfm]}>{normalizeDocumentationMarkdown(page.content)}</ReactMarkdown></article></> : <section className="empty-scope" role="status">{m.noVisiblePages({}, { locale })}</section>}
      </main>
      {page ? <aside className="toc"><p className="eyebrow">{m.onThisPage({}, { locale })}</p><a href="#overview">{m.overview({}, { locale })}</a><a href="#next-steps">{m.nextSteps({}, { locale })}</a></aside> : null}
    </div>
  );
}

function PageLink({ active, onSelect, page }: { active: boolean; onSelect(): void; page: SitePage }) {
  return <button className={active ? 'nav-link active' : 'nav-link'} onClick={onSelect} type="button">{page.title}</button>;
}
`;

const harborStyle = `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#182132;background:#fbfcfe;font-synthesis:none}*{box-sizing:border-box}body{margin:0}.harbor{display:grid;min-height:100vh;grid-template-columns:17rem minmax(0,1fr) 13rem;grid-template-rows:4.25rem auto;grid-template-areas:"top top top" "side article toc"}.topbar{grid-area:top;position:sticky;top:0;z-index:4;display:flex;align-items:center;gap:2rem;padding:0 2rem;border-bottom:1px solid #dce3ec;background:rgba(251,252,254,.92);backdrop-filter:blur(14px)}.brand{font-weight:760;color:#142038;text-decoration:none;font-size:1.05rem}.brand span{margin-inline-start:.65rem;border-radius:999px;background:#e7f7f3;color:#087866;padding:.22rem .55rem;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase}.search{margin-inline:auto;display:flex;width:min(28rem,40vw);align-items:center;gap:.55rem;padding:.68rem 1rem;border:1px solid #d8e0e9;border-radius:.7rem;background:#fff;color:#718096;font-size:.86rem;box-shadow:0 1px 2px rgba(30,45,68,.04)}.github{display:flex;align-items:center;gap:.35rem;color:#31506f;text-decoration:none;font-size:.86rem}.sidebar{grid-area:side;padding:2rem 1.4rem;border-inline-end:1px solid #e2e8f0;background:#f7f9fc}.eyebrow{margin:0 0 .9rem;color:#75859a;font-size:.72rem;font-weight:700;letter-spacing:.11em;text-transform:uppercase}.nav-link{display:block;width:100%;margin:.18rem 0;padding:.68rem .8rem;border:0;border-radius:.55rem;background:transparent;color:#52647b;text-align:start;cursor:pointer}.nav-link:hover,.nav-link.active{background:#e5f5f1;color:#087866;font-weight:650}.extension{margin-top:2rem;padding:1rem;border:1px solid #cfe3df;border-radius:.75rem;background:#effaf7;font-size:.75rem;line-height:1.5;color:#385d58}.extension p{margin:.4rem 0 0}.article{grid-area:article;width:min(100%,52rem);padding:4rem 4.5rem 6rem}.mobile-page-picker{display:none}.article h1{margin:.25rem 0 .8rem;color:#111b2d;font-size:clamp(2.2rem,5vw,3.8rem);line-height:1.04;letter-spacing:-.045em}.lede{max-width:44rem;color:#617188;font-size:1.18rem;line-height:1.7}.prose{margin-top:2.8rem;color:#33445b;font-size:1rem;line-height:1.8}.prose h2{margin-top:2.6rem;color:#17243a;font-size:1.5rem}.prose code{padding:.15rem .35rem;border-radius:.3rem;background:#edf2f7;color:#087866}.prose pre{overflow:auto;padding:1.1rem;border-radius:.8rem;background:#101827;color:#dbeafe}.toc{grid-area:toc;padding:4rem 1.2rem}.toc a{display:block;margin:.65rem 0;color:#6a7b91;text-decoration:none;font-size:.82rem}.loading,.empty{padding:3rem}@media(max-width:900px){.harbor{grid-template-columns:1fr;grid-template-areas:"top" "article";grid-template-rows:4rem auto}.topbar{padding:0 1rem}.search,.github,.sidebar,.toc{display:none}.article{padding:2.5rem 1.25rem}.mobile-page-picker{display:grid;gap:.4rem;margin-bottom:1.4rem;color:#52647b;font-size:.75rem;font-weight:650}.mobile-page-picker select{width:100%;padding:.72rem .8rem;border:1px solid #d8e0e9;border-radius:.6rem;background:#fff;color:#182132}.article h1{font-size:2.35rem}}
`;

const manuscriptSource = `import { BookOpen, ExternalLink, Search } from 'lucide-react';
import { useId } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import * as m from '../paraglide/messages.js';
import type { SiteSnapshot } from '../nibleaf/runtime';
import { chromeLocale, documentationMarkdownComponents, documentationSanitizeSchema, moveFocusToFirstSearchResult, normalizeDocumentationMarkdown, rehypeAuthoredComponentProps, useDocumentLanguage, useScopedDocumentation } from './theme-utils';

export function ManuscriptTheme({ snapshot }: { snapshot: SiteSnapshot }) {
  const scope = useScopedDocumentation(snapshot);
  const { language, languages, page, scopedPages, searchQuery, searchResults, version } = scope;
  const locale = chromeLocale(language?.code);
  const markdownComponents = documentationMarkdownComponents(m.overview({}, { locale }), m.nextSteps({}, { locale }));
  const searchId = useId();
  const showSearchResults = Boolean(searchQuery.trim());
  useDocumentLanguage(language?.code, language?.direction);
  if (!language || !version) return <main className="empty">{m.noVisiblePages({}, { locale })}</main>;
  return (
    <div className="manuscript" dir={language.direction === 'RTL' ? 'rtl' : 'ltr'}>
      <header className="masthead">
        <a className="wordmark" href="/"><BookOpen aria-hidden="true" size={20} /><span>{snapshot.project.name}</span><small>{m.themeLabel({}, { locale })}</small></a>
        <div className="masthead-actions">
          <div className="scope-controls">
            <label><span>{m.language({}, { locale })}</span><select aria-label={m.language({}, { locale })} data-scope="language" onChange={(event) => scope.selectLanguage(event.target.value)} value={language.code}>{languages.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
            <label><span>{m.version({}, { locale })}</span><select aria-label={m.version({}, { locale })} data-scope="version" onChange={(event) => scope.selectVersion(event.target.value)} value={version.id}>{snapshot.project.versions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </div>
          <form className="documentation-search" data-documentation-search onSubmit={(event) => event.preventDefault()} role="search">
            <label htmlFor={searchId}><Search aria-hidden="true" size={15} /><span>{m.search({}, { locale })}</span></label>
            <input aria-controls={searchId + '-results'} aria-expanded={showSearchResults} aria-label={m.search({}, { locale })} id={searchId} onChange={(event) => scope.setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') scope.setSearchQuery(''); else moveFocusToFirstSearchResult(event); }} type="search" value={searchQuery} />
            {showSearchResults ? <div className="search-results" id={searchId + '-results'}>{searchResults.length > 0 ? <ul aria-label={m.searchResults({}, { locale })}>{searchResults.map((item) => <li key={item.id}><button data-search-result onClick={() => scope.selectPage(item.id)} type="button">{item.title}</button></li>)}</ul> : <p role="status">{m.noSearchResults({}, { locale })}</p>}</div> : null}
          </form>
          <a className="github" href="https://github.com" rel="noreferrer">{m.github({}, { locale })}<ExternalLink aria-hidden="true" size={13} /></a>
        </div>
      </header>
      <nav aria-label={m.chapters({}, { locale })} className="chapter-deck">
        <strong>{m.chapters({}, { locale })}</strong>
        {scopedPages.map((item, index) => <button className={item.id === page?.id ? 'chapter active' : 'chapter'} key={item.id} onClick={() => scope.selectPage(item.id)} type="button"><span>{String(index + 1).padStart(2, '0')}</span>{item.title}</button>)}
      </nav>
      <div className="paper">
        {page ? <aside className="margin-notes"><p>{m.onThisPage({}, { locale })}</p><a href="#overview">{m.overview({}, { locale })}</a><a href="#next-steps">{m.nextSteps({}, { locale })}</a></aside> : null}
        <main className="article">
          {page ? <><label className="mobile-page-picker"><span>{m.page({}, { locale })}</span><select aria-label={m.choosePage({}, { locale })} onChange={(event) => scope.selectPage(event.target.value)} value={page.id}>{scopedPages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <p className="kicker">{language.label} · {version.name}</p>
          <h1>{page.title}</h1>
          {page.description ? <p className="dek">{page.description}</p> : null}
          <div className="rule" />
          <article className="prose"><ReactMarkdown components={markdownComponents} rehypePlugins={[rehypeRaw, rehypeAuthoredComponentProps, [rehypeSanitize, documentationSanitizeSchema]]} remarkPlugins={[remarkGfm]}>{normalizeDocumentationMarkdown(page.content)}</ReactMarkdown></article>
          <footer className="extension"><strong>{m.customerOwned({}, { locale })}</strong><span>{m.edit({}, { locale })} <code>src/theme/ManuscriptTheme.tsx</code>. {m.syncPreserves({}, { locale })}</span></footer></> : <section className="empty-scope" role="status">{m.noVisiblePages({}, { locale })}</section>}
        </main>
      </div>
    </div>
  );
}
`;

const manuscriptStyle = `:root{font-family:Georgia,'Times New Roman',serif;color:#29251f;background:#eee9df;font-synthesis:none}*{box-sizing:border-box}body{margin:0}.manuscript{min-height:100vh;padding:1.5rem;background:linear-gradient(135deg,#eee9df,#f7f4ed)}.masthead{display:flex;align-items:center;justify-content:space-between;max-width:82rem;margin:auto;padding:1rem 1.3rem;border:1px solid #cfc5b4;border-bottom:0;background:#fffdf8}.wordmark{display:flex;align-items:center;gap:.65rem;color:#28231d;text-decoration:none;font-family:Inter,ui-sans-serif,sans-serif;font-weight:750}.wordmark small{padding-inline-start:.7rem;border-inline-start:1px solid #cfc5b4;color:#8b6548;font-size:.68rem;letter-spacing:.13em;text-transform:uppercase}.masthead-actions{display:flex;align-items:center;gap:1.2rem;font-family:Inter,ui-sans-serif,sans-serif;color:#746b60;font-size:.78rem}.masthead-actions span,.masthead-actions a{display:flex;align-items:center;gap:.4rem;color:inherit;text-decoration:none}.chapter-deck{display:flex;align-items:stretch;max-width:82rem;margin:auto;overflow:auto;border:1px solid #cfc5b4;background:#f7f2e8;font-family:Inter,ui-sans-serif,sans-serif}.chapter-deck>strong{display:flex;align-items:center;padding:0 1.2rem;color:#8b6548;font-size:.67rem;letter-spacing:.12em;text-transform:uppercase}.chapter{display:flex;min-width:11rem;align-items:center;gap:.55rem;padding:.9rem 1rem;border:0;border-inline-start:1px solid #d9d0c1;background:transparent;color:#675f55;text-align:start;cursor:pointer}.chapter span{color:#a2907c;font-size:.68rem}.chapter.active{background:#fffdf8;color:#34291e;font-weight:700}.paper{display:grid;max-width:82rem;min-height:calc(100vh - 9rem);margin:auto;grid-template-columns:12rem minmax(0,46rem);justify-content:center;border:1px solid #cfc5b4;border-top:0;background:#fffdf8;box-shadow:0 25px 70px rgba(74,58,38,.12)}.margin-notes{padding:5.7rem 1.5rem;border-inline-end:1px solid #e0d8ca;font-family:Inter,ui-sans-serif,sans-serif}.margin-notes p,.kicker{color:#9a6a46;font-family:Inter,ui-sans-serif,sans-serif;font-size:.68rem;font-weight:750;letter-spacing:.12em;text-transform:uppercase}.margin-notes a{display:block;margin:.8rem 0;color:#776b5d;text-decoration:none;font-size:.8rem}.article{min-width:0;padding:5.5rem 4.5rem 7rem}.article h1{max-width:42rem;margin:.5rem 0 1rem;font-size:clamp(2.8rem,6vw,5.4rem);font-weight:500;line-height:.98;letter-spacing:-.045em}.dek{max-width:38rem;color:#6b6257;font-size:1.25rem;font-style:italic;line-height:1.65}.rule{width:5rem;height:2px;margin:2.6rem 0;background:#9a6a46}.prose{font-size:1.06rem;line-height:1.9}.prose h2{margin-top:2.7rem;font-size:1.65rem;font-weight:500}.prose code{padding:.15rem .35rem;background:#f0eadf;color:#7c4f31}.prose pre{max-width:100%;overflow:auto;padding:1.2rem;background:#28231d;color:#f9f3e9;font-family:ui-monospace,monospace}.extension{display:grid;gap:.35rem;margin-top:4rem;padding-top:1.2rem;border-top:1px solid #ddd3c4;color:#766b5e;font-family:Inter,ui-sans-serif,sans-serif;font-size:.75rem}.mobile-page-picker{display:none}.empty{padding:3rem}@media(max-width:850px){.manuscript{padding:0}.masthead{border-inline:0}.masthead-actions{display:none}.chapter-deck,.margin-notes{display:none}.paper{display:block;border-inline:0}.article{padding:3rem 1.35rem}.mobile-page-picker{display:grid;gap:.4rem;margin-bottom:2rem;color:#8b6548;font-family:Inter,ui-sans-serif,sans-serif;font-size:.75rem}.mobile-page-picker select{width:100%;padding:.75rem;border:1px solid #cfc5b4;background:#fffdf8}.article h1{font-size:3.1rem}}
`;

const signalSource = `import { ExternalLink, Search, Terminal } from 'lucide-react';
import { useId } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import * as m from '../paraglide/messages.js';
import type { SitePage, SiteSnapshot } from '../nibleaf/runtime';
import { chromeLocale, documentationMarkdownComponents, documentationSanitizeSchema, moveFocusToFirstSearchResult, normalizeDocumentationMarkdown, rehypeAuthoredComponentProps, useDocumentLanguage, useScopedDocumentation } from './theme-utils';

export function SignalTheme({ snapshot }: { snapshot: SiteSnapshot }) {
  const scope = useScopedDocumentation(snapshot);
  const { language, languages, page, scopedPages, searchQuery, searchResults, version } = scope;
  const locale = chromeLocale(language?.code);
  const markdownComponents = documentationMarkdownComponents(m.overview({}, { locale }), m.nextSteps({}, { locale }));
  const searchId = useId();
  const showSearchResults = Boolean(searchQuery.trim());
  useDocumentLanguage(language?.code, language?.direction);
  if (!language || !version) return <main className="empty">{m.noVisiblePages({}, { locale })}</main>;
  return (
    <div className="signal" dir={language.direction === 'RTL' ? 'rtl' : 'ltr'}>
      <header className="command-bar">
        <a className="brand" href="/"><Terminal aria-hidden="true" size={18} /><span>{snapshot.project.name}</span><small>{m.themeLabel({}, { locale })}</small></a>
        <div className="scope-controls">
          <label><span>{m.language({}, { locale })}</span><select aria-label={m.language({}, { locale })} data-scope="language" onChange={(event) => scope.selectLanguage(event.target.value)} value={language.code}>{languages.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          <label><span>{m.version({}, { locale })}</span><select aria-label={m.version({}, { locale })} data-scope="version" onChange={(event) => scope.selectVersion(event.target.value)} value={version.id}>{snapshot.project.versions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        <form className="documentation-search" data-documentation-search onSubmit={(event) => event.preventDefault()} role="search">
          <label htmlFor={searchId}><Search aria-hidden="true" size={15} /><span>{m.search({}, { locale })}</span></label>
          <input aria-controls={searchId + '-results'} aria-expanded={showSearchResults} aria-label={m.search({}, { locale })} id={searchId} onChange={(event) => scope.setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') scope.setSearchQuery(''); else moveFocusToFirstSearchResult(event); }} type="search" value={searchQuery} />
          {showSearchResults ? <div className="search-results" id={searchId + '-results'}>{searchResults.length > 0 ? <ul aria-label={m.searchResults({}, { locale })}>{searchResults.map((item) => <li key={item.id}><button data-search-result onClick={() => scope.selectPage(item.id)} type="button">{item.title}</button></li>)}</ul> : <p role="status">{m.noSearchResults({}, { locale })}</p>}</div> : null}
        </form>
        <a className="github" href="https://github.com" rel="noreferrer">{m.github({}, { locale })}<ExternalLink aria-hidden="true" size={13} /></a>
      </header>
      <div className="workspace">
        <aside className="rail">
          <p>{m.documentation({}, { locale })}</p>
          <nav aria-label={m.documentation({}, { locale })}>{scopedPages.map((item, index) => <RailLink active={item.id === page?.id} index={index} key={item.id} onSelect={() => scope.selectPage(item.id)} page={item} />)}</nav>
          <div className="extension"><strong>{m.customerOwned({}, { locale })}</strong><span>{m.edit({}, { locale })} <code>src/theme/SignalTheme.tsx</code>. {m.syncPreserves({}, { locale })}</span></div>
        </aside>
        <main className="canvas">
          {page ? <><label className="mobile-page-picker"><span>{m.page({}, { locale })}</span><select aria-label={m.choosePage({}, { locale })} onChange={(event) => scope.selectPage(event.target.value)} value={page.id}>{scopedPages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <div className="command-index"><strong>{m.commandIndex({}, { locale })}</strong><a href="#overview">01 {m.overview({}, { locale })}</a><a href="#next-steps">02 {m.nextSteps({}, { locale })}</a></div>
          <section className="panel">
            <p className="status"><span />{language.label} / {version.name}</p>
            <h1>{page.title}</h1>
            {page.description ? <p className="lede">{page.description}</p> : null}
            <article className="prose"><ReactMarkdown components={markdownComponents} rehypePlugins={[rehypeRaw, rehypeAuthoredComponentProps, [rehypeSanitize, documentationSanitizeSchema]]} remarkPlugins={[remarkGfm]}>{normalizeDocumentationMarkdown(page.content)}</ReactMarkdown></article>
          </section></> : <section className="empty-scope" role="status">{m.noVisiblePages({}, { locale })}</section>}
        </main>
      </div>
    </div>
  );
}

function RailLink({ active, index, onSelect, page }: { active: boolean; index: number; onSelect(): void; page: SitePage }) {
  return <button className={active ? 'rail-link active' : 'rail-link'} onClick={onSelect} type="button"><span>{String(index + 1).padStart(2, '0')}</span>{page.title}</button>;
}
`;

const signalStyle = `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e9efff;background:#080b12;font-synthesis:none}*{box-sizing:border-box}body{margin:0}.signal{min-height:100vh;padding:1rem;background:#080b12}.command-bar{display:flex;height:3.75rem;align-items:center;gap:1.5rem;max-width:100rem;margin:auto;border:1px solid #303747;background:#111621;padding:0 1.1rem}.brand{display:flex;align-items:center;gap:.55rem;color:#f1f5ff;text-decoration:none;font-weight:720}.brand small{padding:.18rem .45rem;border:1px solid #506078;color:#91d7ff;font-size:.62rem;letter-spacing:.12em;text-transform:uppercase}.search{display:flex;align-items:center;gap:.5rem;margin-inline:auto;width:min(26rem,36vw);padding:.55rem .75rem;border:1px solid #323b4c;background:#0a0e17;color:#8592a8;font-family:ui-monospace,monospace;font-size:.76rem}.github{display:flex;align-items:center;gap:.35rem;color:#aebbd1;text-decoration:none;font-family:ui-monospace,monospace;font-size:.72rem}.workspace{display:grid;max-width:100rem;min-height:calc(100vh - 5.75rem);margin:auto;grid-template-columns:14.5rem minmax(0,1fr);border:1px solid #303747;border-top:0;background:#f7f9fd}.rail{display:flex;flex-direction:column;padding:1rem;border-inline-end:1px solid #303747;background:#0e131d;color:#c6d0e0}.rail>p,.command-index>strong{color:#718099;font-family:ui-monospace,monospace;font-size:.65rem;letter-spacing:.11em;text-transform:uppercase}.rail-link{display:grid;width:100%;grid-template-columns:2rem 1fr;gap:.35rem;margin:.15rem 0;padding:.68rem .55rem;border:1px solid transparent;background:transparent;color:#9daabc;text-align:start;cursor:pointer;font-size:.78rem}.rail-link span{color:#536078;font-family:ui-monospace,monospace}.rail-link:hover,.rail-link.active{border-color:#39465b;background:#182131;color:#91d7ff}.extension{display:grid;gap:.45rem;margin-top:auto;padding:1rem;border:1px solid #344157;background:#121a27;color:#91a0b7;font-size:.68rem;line-height:1.5}.extension strong{color:#91d7ff}.canvas{padding:1.5rem 2rem 4rem;color:#172033}.command-index{display:flex;align-items:center;gap:1.2rem;padding:.8rem 1rem;border:1px solid #cad3df;background:#edf2f8}.command-index a{color:#4f6076;text-decoration:none;font-family:ui-monospace,monospace;font-size:.7rem}.panel{margin-top:1rem;padding:3rem 3.5rem 5rem;border:1px solid #cad3df;background:#fff;box-shadow:0 18px 50px rgba(25,37,55,.09)}.status{display:flex;align-items:center;gap:.5rem;color:#5f7087;font-family:ui-monospace,monospace;font-size:.68rem;text-transform:uppercase}.status span{width:.5rem;height:.5rem;border-radius:50%;background:#2acb8b;box-shadow:0 0 0 3px #d9f7ea}.panel h1{max-width:58rem;margin:1rem 0;font-size:clamp(2.6rem,5vw,4.7rem);line-height:1;letter-spacing:-.05em}.lede{max-width:52rem;color:#5f6e82;font-size:1.15rem;line-height:1.65}.prose{max-width:64rem;margin-top:3rem;line-height:1.75}.prose h2{margin-top:2.8rem;padding-bottom:.55rem;border-bottom:1px solid #dce2ea;font-family:ui-monospace,monospace;font-size:1.25rem}.prose code{padding:.15rem .35rem;background:#e8f7ff;color:#08779d}.prose pre{overflow:auto;padding:1.2rem;border:1px solid #303747;background:#0d121c;color:#d9e4f7}.mobile-page-picker{display:none}.empty{padding:3rem}@media(max-width:850px){.signal{padding:0}.command-bar{border-inline:0}.search,.github{display:none}.workspace{display:block;border-inline:0}.rail,.command-index{display:none}.canvas{padding:1rem}.mobile-page-picker{display:grid;gap:.4rem;margin-bottom:1rem;color:#52647b;font-size:.75rem}.mobile-page-picker select{width:100%;padding:.72rem;border:1px solid #cad3df;background:#fff}.panel{margin:0;padding:2.5rem 1.25rem 4rem}.panel h1{font-size:2.65rem}}
`;

const scopedNavigationStyle =
  '.scope-controls{display:flex;align-items:end;gap:.45rem}.scope-controls label{display:grid;gap:.18rem;min-width:6.5rem}.scope-controls label>span{font-size:.58rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.scope-controls select{width:100%;min-height:2.35rem;padding-block:.35rem;padding-inline:.5rem 1.7rem;border:1px solid currentColor;border-color:color-mix(in srgb,currentColor 24%,transparent);border-radius:.35rem;background:transparent;color:inherit;font:inherit}.documentation-search{position:relative;min-width:12rem}.documentation-search>label{position:absolute;z-index:1;inset-inline-start:.65rem;inset-block-start:.62rem;display:flex;pointer-events:none}.documentation-search>label span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.documentation-search input{width:100%;min-height:2.35rem;padding-block:.45rem;padding-inline:.7rem;padding-inline-start:2rem;border:1px solid currentColor;border-color:color-mix(in srgb,currentColor 24%,transparent);border-radius:.4rem;background:transparent;color:inherit;font:inherit}.documentation-search input:focus-visible,.scope-controls select:focus-visible{outline:2px solid currentColor;outline-offset:2px}.search-results{position:absolute;z-index:20;inset-block-start:calc(100% + .35rem);inset-inline:0;max-height:18rem;overflow:auto;border:1px solid currentColor;border-color:color-mix(in srgb,currentColor 24%,transparent);border-radius:.45rem;background:#fff;color:#27364a;box-shadow:0 16px 40px rgba(15,23,42,.18)}.search-results ul{margin:0;padding:.35rem;list-style:none}.search-results button{width:100%;padding-block:.62rem;padding-inline:.7rem;border:0;border-radius:.3rem;background:transparent;color:inherit;text-align:start;cursor:pointer}.search-results button:hover,.search-results button:focus-visible{background:color-mix(in srgb,currentColor 9%,transparent);outline:none}.search-results p{margin:0;padding:.8rem;font-size:.78rem}.empty-scope{min-height:18rem;padding-block:4rem;padding-inline:1.5rem;text-align:center;color:color-mix(in srgb,currentColor 65%,transparent)}';
const harborControlsStyle =
  '.harbor .topbar{min-height:4.25rem;height:auto;padding-block:.55rem}.harbor .scope-controls{color:#52647b;font-size:.7rem}.harbor .documentation-search{width:min(22rem,28vw);margin-inline:auto;color:#52647b}.harbor .documentation-search input,.harbor .scope-controls select{background:#fff}@media(max-width:900px){.harbor{grid-template-rows:auto auto}.harbor .topbar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.65rem;padding:.75rem 1rem}.harbor .scope-controls,.harbor .documentation-search{grid-column:1/-1;width:100%;margin:0}.harbor .github{display:none}.harbor .scope-controls label{flex:1;min-width:0}.harbor .article{min-width:0;padding-top:2rem}}';
const manuscriptControlsStyle =
  '.manuscript .masthead-actions{flex:1;justify-content:flex-end}.manuscript .scope-controls{font-family:Inter,ui-sans-serif,sans-serif}.manuscript .documentation-search{width:min(18rem,24vw);font-family:Inter,ui-sans-serif,sans-serif}.manuscript .documentation-search input,.manuscript .scope-controls select{background:#fffdf8}.manuscript .search-results{background:#fffdf8;color:#3b3024}@media(max-width:850px){.manuscript .masthead{display:grid;gap:.85rem}.manuscript .masthead-actions{display:grid;width:100%;gap:.65rem}.manuscript .scope-controls,.manuscript .documentation-search{display:flex;width:100%}.manuscript .scope-controls label{flex:1;min-width:0}.manuscript .github{display:none}.manuscript .paper{grid-template-columns:1fr}.manuscript .article{min-width:0;padding-top:2.25rem}}';
const signalControlsStyle =
  '.signal .command-bar{height:auto;min-height:3.75rem;padding-block:.55rem}.signal .scope-controls{color:#aebbd1;font-family:ui-monospace,monospace;font-size:.65rem}.signal .documentation-search{width:min(20rem,25vw);margin-inline:auto;color:#aebbd1;font-family:ui-monospace,monospace;font-size:.72rem}.signal .documentation-search input,.signal .scope-controls select{border-radius:0;background:#0a0e17;color:#d5dfef}.signal .search-results{border-radius:0;background:#111621;color:#d5dfef}@media(max-width:850px){.signal .command-bar{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.65rem;padding:.75rem 1rem}.signal .scope-controls,.signal .documentation-search{grid-column:1/-1;width:100%;margin:0}.signal .scope-controls label{flex:1;min-width:0}.signal .github{display:none}.signal .workspace{min-height:calc(100vh - 10rem)}.signal .canvas{min-width:0}}';

const componentStyle =
  '.mdx-callout,.mdx-banner,.mdx-card,.mdx-accordion,.mdx-field,.mdx-update,.mdx-file-tree,.mdx-api-example,.mdx-related-card{display:block;margin:1.25rem 0;padding:1rem;border:1px solid currentColor;border-color:color-mix(in srgb,currentColor 22%,transparent);background:color-mix(in srgb,currentColor 4%,transparent)}.mdx-card-grid,.mdx-columns,.mdx-related-content>div,.mdx-api-example>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.mdx-card,.mdx-related-card{margin:0;color:inherit;text-decoration:none}.mdx-related-card{display:grid;gap:.35rem}.mdx-tabs>div:first-child{display:flex;gap:.35rem;overflow:auto;border-bottom:1px solid color-mix(in srgb,currentColor 22%,transparent)}.mdx-tabs [role=tab]{padding:.65rem .8rem;border:0;border-bottom:2px solid transparent;background:transparent;color:inherit;cursor:pointer}.mdx-tabs [aria-selected=true]{border-bottom-color:currentColor;font-weight:700}.mdx-tabs [role=tabpanel]{padding-block:1rem}.mdx-accordion-group{border-block:1px solid color-mix(in srgb,currentColor 22%,transparent)}.mdx-accordion{margin:0;border-width:0 0 1px}.mdx-accordion>button{display:flex;width:100%;padding:.75rem 0;border:0;background:transparent;color:inherit;font:inherit;font-weight:700;text-align:start;cursor:pointer}.mdx-file-tree{font-family:ui-monospace,monospace;list-style:none}.mdx-folder{list-style:none}.mdx-folder summary{cursor:pointer}.mdx-folder ul{padding-inline-start:1.25rem;list-style:none}.mdx-file{padding:.25rem 0}.mdx-field{display:grid;grid-template-columns:max-content max-content 1fr;gap:.65rem}.mdx-code-group{overflow:hidden;border:1px solid color-mix(in srgb,currentColor 22%,transparent)}.mdx-code-group pre{margin:0;border:0}.mdx-badge,.mdx-button{display:inline-flex;padding:.18rem .55rem;border:1px solid currentColor;color:inherit;text-decoration:none;font-size:.8em}.mdx-tooltip{position:relative;display:inline}.mdx-tooltip-trigger{cursor:help;text-decoration:underline dotted;text-underline-offset:.18em}.mdx-tooltip-trigger:focus-visible{outline:2px solid currentColor;outline-offset:.18em}.mdx-tooltip-content{position:absolute;z-index:10;inset-block-end:calc(100% + .45rem);inset-inline-start:50%;width:max-content;max-width:min(18rem,80vw);transform:translateX(-50%);padding:.45rem .6rem;border:1px solid currentColor;border-radius:.35rem;background:#111827;color:#fff;font:500 .75rem/1.4 ui-sans-serif,system-ui,sans-serif;opacity:0;visibility:hidden;pointer-events:none}.mdx-tooltip:hover .mdx-tooltip-content,.mdx-tooltip:focus-within .mdx-tooltip-content{opacity:1;visibility:visible}.mdx-icon{display:inline-block;width:1em;height:1em;vertical-align:-.12em}.mdx-steps{counter-reset:step;list-style:none;padding-inline-start:2.2rem}.mdx-steps>li{position:relative;margin:1.25rem 0}.mdx-steps>li::before{position:absolute;inset-inline-start:-2.2rem;content:counter(list-item);display:grid;width:1.45rem;height:1.45rem;place-items:center;border:1px solid currentColor;border-radius:50%;font-size:.7rem}@media(max-width:700px){.mdx-card-grid,.mdx-columns,.mdx-related-content>div,.mdx-api-example>div{grid-template-columns:1fr}.mdx-field{grid-template-columns:1fr}}';

export const THEME_REPOSITORY_TEMPLATE_SOURCES: Record<ThemePresetId, ThemeRepositoryTemplateSource> = {
  harbor: {
    componentName: 'HarborTheme',
    displayName: 'Harbor',
    accent: '#087866',
    source: harborSource,
    style: `${harborStyle}${scopedNavigationStyle}${harborControlsStyle}${componentStyle}`,
  },
  manuscript: {
    componentName: 'ManuscriptTheme',
    displayName: 'Manuscript',
    accent: '#8b6548',
    source: manuscriptSource,
    style: `${manuscriptStyle}${scopedNavigationStyle}${manuscriptControlsStyle}${componentStyle}`,
  },
  signal: {
    componentName: 'SignalTheme',
    displayName: 'Signal',
    accent: '#4bb8e8',
    source: signalSource,
    style: `${signalStyle}${scopedNavigationStyle}${signalControlsStyle}${componentStyle}`,
  },
};
