import { resolveDocHref, type SiteLinkContext } from '@/components/markdown';
import { Accordion, AccordionGroup } from './accordion';
import { ApiExample, RequestExample, ResponseExample } from './api-examples';
import { Callout } from './callout';
import { Card, CardGroup } from './cards';
import { CodeGroup } from './code-group';
import { CustomCallout } from './custom-callout';
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
import { authoredList } from './utils';

/** Renderers that can only be reached from authored raw HTML/MDX tags. `callout`
 *  is here too: an authored `<Callout icon color>` needs the custom look, which
 *  `> [!NOTE]` admonitions (rendered without this map) never carry. */
export type RichMdxComponents = Omit<DocumentationComponents, 'mermaid'>;

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
    callout: ({ type, icon, color, children }) => (
      <CustomCallout type={str(type)} icon={str(icon)} color={str(color)}>
        {children}
      </CustomCallout>
    ),
    note: ({ children }) => <Callout type="note">{children}</Callout>,
    info: ({ children }) => <Callout type="info">{children}</Callout>,
    tip: ({ children }) => <Callout type="tip">{children}</Callout>,
    check: ({ children }) => <Callout type="check">{children}</Callout>,
    warning: ({ children }) => <Callout type="warning">{children}</Callout>,
    danger: ({ children }) => <Callout type="danger">{children}</Callout>,
    // Card links are internal doc targets too — rewrite them to the site base.
    card: (props: MdxProps) => (
      <Card
        title={str(props.title)}
        href={resolveDocHref(str(props.href), site)}
        icon={str(props.icon)}
        horizontal={props.horizontal}
        img={str(props.img)}
        cta={str(props.cta)}
        arrow={props.arrow}
        color={str(props.color)}
      >
        {props.children}
      </Card>
    ),
    // `cols` may arrive as a number: the HTML parser types the `cols` attribute.
    cardgroup: ({ cols, children }) => <CardGroup cols={cols}>{children}</CardGroup>,
    tabs: ({ defaulttabindex, sync, borderbottom, children }: MdxProps) => (
      <Tabs language={site?.lang} defaultTabIndex={defaulttabindex} sync={sync} borderBottom={borderbottom}>
        {children}
      </Tabs>
    ),
    tab: ({ title, icon, id, children }) => (
      <Tab title={str(title)} icon={str(icon)} id={id}>
        {children}
      </Tab>
    ),
    accordion: ({ title, description, icon, id, defaultopen, children }: MdxProps) => (
      <Accordion title={str(title)} description={str(description)} icon={str(icon)} id={id} defaultOpen={str(defaultopen)} language={site?.lang}>
        {children}
      </Accordion>
    ),
    accordiongroup: ({ children }) => <AccordionGroup>{children}</AccordionGroup>,
    steps: ({ titlesize, children }) => <Steps titleSize={titlesize}>{children}</Steps>,
    step: ({ title, icon, stepnumber, titlesize, children }) => (
      <Step title={str(title)} icon={str(icon)} stepNumber={stepnumber} titleSize={titlesize}>
        {children}
      </Step>
    ),
    mdxframe: ({ caption, hint, children }) => (
      <Frame caption={str(caption)} hint={str(hint)}>
        {children}
      </Frame>
    ),
    tooltip: ({ tip, headline, cta, href, children }) => (
      <Tooltip tip={str(tip)} headline={str(headline)} cta={str(cta)} href={resolveDocHref(str(href), site)}>
        {children}
      </Tooltip>
    ),
    icon: (props) => <Icon icon={str(props.icon)} name={authoredName(props)} color={str(props.color)} size={str(props.size)} />,
    update: ({ label, description, tags, children }) => (
      <Update label={str(label)} description={str(description)} tags={authoredList(tags)} language={site?.lang}>
        {children}
      </Update>
    ),
    codegroup: ({ children }: MdxProps) => <CodeGroup language={site?.lang}>{children}</CodeGroup>,
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
        placeholder={str(props.placeholder)}
        pre={authoredList(props.pre)}
        post={authoredList(props.post)}
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
        pre={authoredList(props.pre)}
        post={authoredList(props.post)}
        language={site?.lang}
      >
        {props.children}
      </ResponseField>
    ),
    columns: ({ cols, children }) => <Columns cols={cols}>{children}</Columns>,
    column: ({ children }) => <Column>{children}</Column>,
    banner: ({ type, children }) => <Banner type={str(type)}>{children}</Banner>,
    badge: ({ color, size, shape, icon, stroke, disabled, children }) => (
      <Badge color={str(color)} size={str(size)} shape={str(shape)} icon={str(icon)} stroke={stroke} disabled={disabled}>
        {children}
      </Badge>
    ),
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
