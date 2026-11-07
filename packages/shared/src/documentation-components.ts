import { CALLOUT_TYPES, type CalloutType } from './callouts';
import {
  DOCUMENTATION_COMPONENT_CONTRACT,
  type DocumentationComponentAttributeName,
  type DocumentationComponentAttributeType,
  type DocumentationComponentContract,
  type DocumentationComponentTag,
  documentationReaderTag,
} from './documentation-component-contract';

export type { DocumentationComponentAttributeType, DocumentationComponentTag } from './documentation-component-contract';

export const DOCUMENTATION_COMPONENT_SCHEMA_VERSION = 1 as const;

export type DocumentationComponentCategory = 'structure' | 'emphasis' | 'media' | 'api' | 'navigation' | 'inline';
export type DocumentationComponentSyntax = 'mdx' | 'markdown' | 'fence';

/** One entry of the versioned public catalog (`DOCUMENTATION_COMPONENT_CATALOG`). */
export interface DocumentationComponentCapability {
  id: string;
  syntax: DocumentationComponentSyntax;
  tag?: string;
  category: DocumentationComponentCategory;
  kind: 'block' | 'inline';
  attributes: readonly string[];
  allowedChildren?: readonly string[];
  visualEditor: boolean;
  interactive: boolean;
}

export interface DocumentationComponentAttribute {
  /** Authored spelling (`defaultOpen`, not `defaultopen`). */
  name: string;
  type: DocumentationComponentAttributeType;
  /** Choices for an `enum` attribute. */
  values?: readonly string[];
  /** Value assumed when the attribute is absent. The editor round-trip compares
   *  edits against it, so it must match what the editor node defaults to;
   *  leaving it out means the empty string. */
  default?: string | boolean | number;
  /** A `boolean` that is a presence flag (`required`, `deprecated`): written
   *  bare, absent by default (empty string), and any non-boolean value is kept
   *  as authored. Without it a boolean is a true/false switch (`defaultOpen`)
   *  that defaults to `false`. The editor picks its attribute parser from this. */
  presence?: boolean;
  /** Preserved by the editor round-trip only: never sanitized for the reader
   *  and never listed in the public catalog. */
  editorOnly?: boolean;
}

/** How the public reader treats an MDX component (see `DocumentationComponentContract`). */
export interface DocumentationComponentReader {
  /** Element name after HTML parsing (`mdxframe` for `<Frame>`). */
  tag: string;
  /** `name` travels as `dataDisplayName` through the sanitizer. */
  displayName: boolean;
  structural: boolean;
  markdownBody: boolean;
  callout?: CalloutType;
}

/** The full registry entry: everything the editor, reader and catalog know about a component. */
export interface DocumentationComponentDefinition {
  id: string;
  syntax: DocumentationComponentSyntax;
  tag?: DocumentationComponentTag;
  category: DocumentationComponentCategory;
  kind: 'block' | 'inline';
  selfClosing: boolean;
  attributes: readonly DocumentationComponentAttribute[];
  allowedChildren?: readonly DocumentationComponentTag[];
  visualEditor: boolean;
  interactive: boolean;
  /** Present for MDX components. */
  reader?: DocumentationComponentReader;
  /** False keeps the entry out of the versioned public catalog. */
  catalog: boolean;
}

type AttributeDetails = Pick<DocumentationComponentAttribute, 'values' | 'default' | 'presence'>;

interface ComponentDetails<Tag extends DocumentationComponentTag> {
  id: string;
  category: DocumentationComponentCategory;
  visualEditor: boolean;
  interactive: boolean;
  allowedChildren?: readonly DocumentationComponentTag[];
  /** Enum values and defaults, keyed by an attribute the contract declares. */
  attributes?: { readonly [Name in DocumentationComponentAttributeName<Tag>]?: AttributeDetails };
  /** Attributes the editor round-trips that are not part of the portable contract. */
  editorOnlyAttributes?: Readonly<Record<string, AttributeDetails & { type: DocumentationComponentAttributeType }>>;
  /** Mintlify aliases outside the versioned public catalog. */
  catalog?: false;
}

const mdx = <Tag extends DocumentationComponentTag>(tag: Tag, details: ComponentDetails<Tag>): DocumentationComponentDefinition => {
  const contract: DocumentationComponentContract = DOCUMENTATION_COMPONENT_CONTRACT[tag];
  const attributeDetails = (details.attributes ?? {}) as Readonly<Record<string, AttributeDetails>>;
  const attributes: DocumentationComponentAttribute[] = [
    ...Object.entries(contract.attributes).map(([name, type]) => ({ name, type, ...attributeDetails[name] })),
    ...Object.entries(details.editorOnlyAttributes ?? {}).map(([name, attribute]) => ({ name, ...attribute, editorOnly: true })),
  ];
  return {
    id: details.id,
    syntax: 'mdx',
    tag,
    category: details.category,
    kind: contract.kind,
    selfClosing: contract.selfClosing ?? false,
    attributes,
    ...(details.allowedChildren ? { allowedChildren: details.allowedChildren } : {}),
    visualEditor: details.visualEditor,
    interactive: details.interactive,
    reader: {
      tag: documentationReaderTag(tag),
      displayName: 'name' in contract.attributes,
      structural: contract.structural ?? false,
      markdownBody: contract.markdownBody ?? false,
      ...(contract.callout ? { callout: contract.callout } : {}),
    },
    catalog: details.catalog ?? true,
  };
};

/** Plain Markdown / fenced syntax the visual editor also authors. */
const native = (
  entry: Pick<DocumentationComponentDefinition, 'id' | 'syntax' | 'category' | 'attributes' | 'visualEditor' | 'interactive'>,
): DocumentationComponentDefinition => ({ ...entry, kind: 'block', selfClosing: false, catalog: true });

/**
 * The single registry of documentation components, in public catalog order.
 * The reader's sanitizer and parsing rules, the editor's MDX round-trip, and the
 * public catalog are all derived from it (plus the reader contract it extends).
 */
export const DOCUMENTATION_COMPONENTS: readonly DocumentationComponentDefinition[] = [
  mdx('Callout', { id: 'callout', category: 'emphasis', visualEditor: true, interactive: false, attributes: { type: { values: CALLOUT_TYPES } } }),
  mdx('Note', { id: 'note', category: 'emphasis', visualEditor: true, interactive: false }),
  mdx('Tip', { id: 'tip', category: 'emphasis', visualEditor: true, interactive: false }),
  mdx('Check', { id: 'check', category: 'emphasis', visualEditor: true, interactive: false }),
  mdx('Warning', { id: 'warning', category: 'emphasis', visualEditor: true, interactive: false }),
  mdx('Danger', { id: 'danger', category: 'emphasis', visualEditor: true, interactive: false }),
  // Supported by the editor and reader but not (yet) part of the versioned v1 catalog.
  mdx('Info', { id: 'info', category: 'emphasis', visualEditor: true, interactive: false, catalog: false }),
  mdx('CardGroup', {
    id: 'card-group',
    category: 'navigation',
    visualEditor: true,
    interactive: false,
    allowedChildren: ['Card'],
    attributes: { cols: { values: ['1', '2', '3', '4'], default: 2 } },
  }),
  mdx('Card', { id: 'card', category: 'navigation', visualEditor: true, interactive: true }),
  mdx('Steps', { id: 'steps', category: 'structure', visualEditor: true, interactive: false, allowedChildren: ['Step'] }),
  mdx('Step', { id: 'step', category: 'structure', visualEditor: true, interactive: false }),
  mdx('Tabs', { id: 'tabs', category: 'structure', visualEditor: true, interactive: true, allowedChildren: ['Tab'] }),
  mdx('Tab', { id: 'tab', category: 'structure', visualEditor: true, interactive: false }),
  mdx('AccordionGroup', { id: 'accordion-group', category: 'structure', visualEditor: true, interactive: false, allowedChildren: ['Accordion'] }),
  mdx('Accordion', {
    id: 'accordion',
    category: 'structure',
    visualEditor: true,
    interactive: true,
    attributes: { defaultOpen: { default: false } },
  }),
  mdx('CodeGroup', { id: 'code-group', category: 'api', visualEditor: true, interactive: true }),
  mdx('Frame', { id: 'frame', category: 'media', visualEditor: true, interactive: false }),
  native({
    id: 'image',
    syntax: 'markdown',
    category: 'media',
    attributes: [
      { name: 'src', type: 'url' },
      { name: 'alt', type: 'string' },
      { name: 'title', type: 'string' },
    ],
    visualEditor: true,
    interactive: false,
  }),
  native({ id: 'table', syntax: 'markdown', category: 'structure', attributes: [], visualEditor: true, interactive: false }),
  native({
    id: 'code-block',
    syntax: 'fence',
    category: 'api',
    attributes: [
      { name: 'language', type: 'string' },
      { name: 'title', type: 'string' },
    ],
    visualEditor: true,
    interactive: true,
  }),
  native({ id: 'mermaid', syntax: 'fence', category: 'media', attributes: [], visualEditor: true, interactive: true }),
  mdx('ParamField', {
    id: 'param-field',
    category: 'api',
    visualEditor: true,
    interactive: false,
    attributes: { required: { presence: true }, deprecated: { presence: true } },
  }),
  mdx('ResponseField', {
    id: 'response-field',
    category: 'api',
    visualEditor: true,
    interactive: false,
    attributes: { required: { presence: true }, deprecated: { presence: true } },
  }),
  mdx('Expandable', { id: 'expandable', category: 'api', visualEditor: true, interactive: true, attributes: { defaultOpen: { default: false } } }),
  mdx('Columns', { id: 'columns', category: 'structure', visualEditor: true, interactive: false, allowedChildren: ['Column'] }),
  mdx('Column', { id: 'column', category: 'structure', visualEditor: true, interactive: false }),
  mdx('Banner', {
    id: 'banner',
    category: 'emphasis',
    visualEditor: true,
    interactive: false,
    attributes: { type: { values: ['info', 'warning'] } },
    editorOnlyAttributes: { dismissible: { type: 'boolean', presence: true } },
  }),
  mdx('Badge', { id: 'badge', category: 'inline', visualEditor: true, interactive: false }),
  mdx('Button', {
    id: 'button',
    category: 'inline',
    visualEditor: true,
    interactive: true,
    attributes: { variant: { values: ['default', 'outline'] } },
  }),
  mdx('Tooltip', { id: 'tooltip', category: 'inline', visualEditor: true, interactive: true }),
  mdx('Icon', { id: 'icon', category: 'inline', visualEditor: true, interactive: false }),
  mdx('Update', { id: 'update', category: 'emphasis', visualEditor: true, interactive: false }),
  mdx('FileTree', { id: 'file-tree', category: 'structure', visualEditor: true, interactive: false, allowedChildren: ['Folder', 'File'] }),
  mdx('Folder', {
    id: 'folder',
    category: 'structure',
    visualEditor: true,
    interactive: true,
    allowedChildren: ['Folder', 'File'],
    attributes: { defaultOpen: { default: false } },
  }),
  mdx('File', { id: 'file', category: 'structure', visualEditor: true, interactive: false }),
  mdx('ApiExample', {
    id: 'api-example',
    category: 'api',
    visualEditor: true,
    interactive: false,
    allowedChildren: ['RequestExample', 'ResponseExample'],
  }),
  mdx('RequestExample', { id: 'request-example', category: 'api', visualEditor: true, interactive: false }),
  mdx('ResponseExample', { id: 'response-example', category: 'api', visualEditor: true, interactive: false }),
  mdx('RelatedContent', { id: 'related-content', category: 'navigation', visualEditor: true, interactive: false, allowedChildren: ['RelatedCard'] }),
  mdx('RelatedCard', { id: 'related-card', category: 'navigation', visualEditor: true, interactive: true }),
];

const toCapability = (component: DocumentationComponentDefinition): DocumentationComponentCapability => ({
  id: component.id,
  syntax: component.syntax,
  ...(component.tag ? { tag: component.tag } : {}),
  category: component.category,
  kind: component.kind,
  attributes: component.attributes.filter((attribute) => !attribute.editorOnly).map((attribute) => attribute.name),
  ...(component.allowedChildren ? { allowedChildren: component.allowedChildren } : {}),
  visualEditor: component.visualEditor,
  interactive: component.interactive,
});

/**
 * Public, code-only authoring contract shared by the editor, renderer, exports,
 * and capability adapters. Entries describe authored syntax only: consumers
 * must never interpret File/Folder names as repository paths or fetch component
 * attributes over the network.
 */
export const DOCUMENTATION_COMPONENT_CATALOG: readonly DocumentationComponentCapability[] = DOCUMENTATION_COMPONENTS.filter(
  (component) => component.catalog,
).map(toCapability);

export const documentationComponentTags = (): readonly string[] =>
  DOCUMENTATION_COMPONENT_CATALOG.flatMap((component: DocumentationComponentCapability) => (component.tag ? [component.tag] : []));
