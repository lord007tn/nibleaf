import { resolveDocHref, type SiteLinkContext } from '@/components/markdown';
import { Accordion, AccordionGroup } from './accordion';
import { ApiExample, RequestExample, ResponseExample } from './api-examples';
import { Callout } from './callout';
import { Card, CardGroup } from './cards';
import { CodeGroup } from './code-group';
import { Expandable, ParamField, ResponseField } from './fields';
import { File, FileTree, Folder } from './file-tree';
import { Frame } from './frame';
import { Icon } from './icon';
import { Badge, Banner, Column, Columns, MdxButton } from './layout';
import { authoredName, type ButtonMdxProps, type DocumentationComponents, type MdxProps, str } from './props';
import { RelatedCard, RelatedContent } from './related';
import { Step, Steps } from './steps';
import { Tab, Tabs } from './tabs';
import { Tooltip } from './tooltip';
import { Update } from './update';

/** Renderers that can only be reached from authored raw HTML/MDX tags. */
export type RichMdxComponents = Omit<DocumentationComponents, 'callout' | 'mermaid'>;

/**
 * Renderers for MDX component tags. Authored tags only reach the renderer
 * through raw HTML, which already loads the lazy rich renderer, so these stay
 * out of the bundle every public page loads. (`callout` from `> [!NOTE]` and
 * `mermaid` from ```mermaid fences need no raw HTML and live in markdown.tsx.)
 * Built per site so labels follow the page language and internal doc links
 * resolve to the site base.
 */
export function readerMdxComponents(site: SiteLinkContext | undefined): RichMdxComponents {
  return {
    note: ({ children }) => <Callout type="note">{children}</Callout>,
    info: ({ children }) => <Callout type="info">{children}</Callout>,
    tip: ({ children }) => <Callout type="tip">{children}</Callout>,
    check: ({ children }) => <Callout type="check">{children}</Callout>,
    warning: ({ children }) => <Callout type="warning">{children}</Callout>,
    danger: ({ children }) => <Callout type="danger">{children}</Callout>,
    // Card links are internal doc targets too — rewrite them to the site base.
    card: ({ title, href, icon, children }: MdxProps) => (
      <Card title={str(title)} href={resolveDocHref(str(href), site)} icon={str(icon)}>
        {children}
      </Card>
    ),
    cardgroup: ({ cols, children }) => <CardGroup cols={str(cols)}>{children}</CardGroup>,
    tabs: ({ children }: MdxProps) => <Tabs language={site?.lang}>{children}</Tabs>,
    tab: ({ title, children }) => <Tab title={str(title)}>{children}</Tab>,
    accordion: ({ title, defaultopen, children }: MdxProps) => (
      <Accordion title={str(title)} defaultOpen={str(defaultopen)} language={site?.lang}>
        {children}
      </Accordion>
    ),
    accordiongroup: ({ children }) => <AccordionGroup>{children}</AccordionGroup>,
    steps: ({ children }) => <Steps>{children}</Steps>,
    step: ({ title, children }) => <Step title={str(title)}>{children}</Step>,
    mdxframe: ({ caption, children }) => <Frame caption={str(caption)}>{children}</Frame>,
    tooltip: ({ tip, children }) => <Tooltip tip={str(tip)}>{children}</Tooltip>,
    icon: (props) => <Icon icon={str(props.icon)} name={authoredName(props)} color={str(props.color)} size={str(props.size)} />,
    update: ({ label, description, children }) => (
      <Update label={str(label)} description={str(description)}>
        {children}
      </Update>
    ),
    codegroup: ({ children, dropdown }: MdxProps) => (
      <CodeGroup language={site?.lang} dropdown={dropdown as string | boolean | undefined}>
        {children}
      </CodeGroup>
    ),
    expandable: ({ title, defaultopen, children }: MdxProps) => (
      <Expandable title={str(title)} defaultOpen={str(defaultopen)} language={site?.lang}>
        {children}
      </Expandable>
    ),
    paramfield: (props: MdxProps) => (
      <ParamField
        path={str(props.path)}
        query={str(props.query)}
        header={str(props.header)}
        body={str(props.body)}
        name={authoredName(props)}
        type={str(props.type)}
        required={props.required}
        default={str(props.default)}
        deprecated={props.deprecated}
        language={site?.lang}
      >
        {props.children}
      </ParamField>
    ),
    responsefield: (props: MdxProps) => (
      <ResponseField
        name={authoredName(props)}
        type={str(props.type)}
        required={props.required}
        default={str(props.default)}
        deprecated={props.deprecated}
        language={site?.lang}
      >
        {props.children}
      </ResponseField>
    ),
    columns: ({ children }) => <Columns>{children}</Columns>,
    column: ({ children }) => <Column>{children}</Column>,
    banner: ({ type, children }) => <Banner type={str(type)}>{children}</Banner>,
    badge: ({ color, children }) => <Badge color={str(color)}>{children}</Badge>,
    button: ({ href, variant, children }: ButtonMdxProps) => (
      <MdxButton href={resolveDocHref(str(href), site)} variant={str(variant)}>
        {children}
      </MdxButton>
    ),
    filetree: ({ children }) => <FileTree>{children}</FileTree>,
    folder: (props) => (
      <Folder name={authoredName(props)} defaultOpen={str(props.defaultopen)}>
        {props.children}
      </Folder>
    ),
    file: (props) => <File name={authoredName(props)} icon={str(props.icon)} />,
    apiexample: ({ title, children }) => <ApiExample title={str(title)}>{children}</ApiExample>,
    requestexample: ({ title, children }) => <RequestExample title={str(title)}>{children}</RequestExample>,
    responseexample: ({ title, status, children }) => (
      <ResponseExample title={str(title)} status={str(status)}>
        {children}
      </ResponseExample>
    ),
    relatedcontent: ({ title, children }) => <RelatedContent title={str(title)}>{children}</RelatedContent>,
    relatedcard: ({ title, description, href, icon, children }: MdxProps) => (
      <RelatedCard title={str(title)} description={str(description)} href={resolveDocHref(str(href), site)} icon={str(icon)}>
        {children}
      </RelatedCard>
    ),
  };
}
