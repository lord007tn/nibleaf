import type { CalloutType } from './callouts';

/**
 * The reader half of the documentation component registry: the facts the public
 * renderer needs to parse, sanitize and render authored MDX components. It is
 * deliberately small because the public docs reader bundles it. Editor-only
 * metadata (catalog ids, categories, defaults, enum values, allowed children)
 * lives in `./documentation-components`, which is type-checked against this
 * contract so the two halves cannot drift.
 *
 * Adding a component starts here, plus its entry in `./documentation-components`.
 * The contract test (`apps/app/src/components/documentation-component-contract.test.tsx`)
 * then fails for every surface that still needs it:
 *  - editor node: `apps/app/src/components/editor/extensions/mdx/` (callout
 *    variants: `extensions/callout.ts`); it must save every registry attribute;
 *  - reader renderer: `apps/app/src/components/site/mdx/` and
 *    `site/mdx/component-map.tsx`, which must receive the content and props;
 *  - reader sanitizer and parsing rules (`site/mdx-config.ts`, derived here);
 *  - portable public Markdown: `packages/shared/src/public-markdown-content.ts`;
 *  - exported theme repositories: `theme-repository-templates/markdown.ts` and
 *    `theme-repository-templates/mdx-components.ts` (their output is pinned).
 * The editor's MDX inventory and the public catalog are derived automatically;
 * a slash menu item (`editor/extensions/slash-items/`) is optional.
 */

export type DocumentationComponentAttributeType = 'string' | 'boolean' | 'number' | 'enum' | 'url' | 'icon' | 'color';

export interface DocumentationComponentContract {
  kind: 'block' | 'inline';
  /**
   * May be authored self-closing (`<File name="…" />`). HTML parsers ignore XML
   * self-closing syntax on unknown elements, so the reader expands these into an
   * explicit open/close pair before parsing.
   */
  selfClosing?: boolean;
  /**
   * Portable attributes, in authored spelling, with their value type. Each one
   * is allowed through the reader's sanitizer: a camelCase name is allowed in
   * its lowercase HTML spelling too, and `name` travels as `dataDisplayName`
   * (it is display text, and a real `name` attribute would enable DOM clobbering).
   */
  attributes: Readonly<Record<string, DocumentationComponentAttributeType>>;
  /** The body is Markdown: the reader pads the tags with blank lines so CommonMark parses it. */
  markdownBody?: boolean;
  /** An item inside a container: the reader unwraps paragraphs that hold only such items. */
  structural?: boolean;
  /** A callout variant (`<Note>`, `<Warning>`…); `Callout` itself reads its `type` attribute. */
  callout?: CalloutType;
  /** Element name the reader parses the tag as, when the lowercase tag is a real HTML element. */
  readerTag?: string;
}

/** Keyed by canonical (PascalCase) MDX tag. */
export const DOCUMENTATION_COMPONENT_CONTRACT = {
  Callout: { kind: 'block', attributes: { type: 'enum' }, markdownBody: true, callout: 'note' },
  Note: { kind: 'block', attributes: {}, markdownBody: true, callout: 'note' },
  Tip: { kind: 'block', attributes: {}, markdownBody: true, callout: 'tip' },
  Check: { kind: 'block', attributes: {}, markdownBody: true, callout: 'check' },
  Warning: { kind: 'block', attributes: {}, markdownBody: true, callout: 'warning' },
  Danger: { kind: 'block', attributes: {}, markdownBody: true, callout: 'danger' },
  Info: { kind: 'block', attributes: {}, markdownBody: true, callout: 'info' },
  CardGroup: { kind: 'block', attributes: { cols: 'number' }, markdownBody: true },
  Card: { kind: 'block', attributes: { title: 'string', icon: 'icon', href: 'url' }, markdownBody: true, structural: true },
  Steps: { kind: 'block', attributes: {}, markdownBody: true },
  Step: { kind: 'block', attributes: { title: 'string' }, markdownBody: true, structural: true },
  Tabs: { kind: 'block', attributes: {}, markdownBody: true },
  Tab: { kind: 'block', attributes: { title: 'string' }, markdownBody: true, structural: true },
  AccordionGroup: { kind: 'block', attributes: {}, markdownBody: true },
  Accordion: { kind: 'block', attributes: { title: 'string', defaultOpen: 'boolean' }, markdownBody: true, structural: true },
  // Holds fenced code blocks only, so its tags are left exactly as authored.
  CodeGroup: { kind: 'block', attributes: {} },
  // `frame` is a real (deprecated) HTML element that the HTML5 parser drops outside a frameset.
  Frame: { kind: 'block', attributes: { caption: 'string' }, markdownBody: true, readerTag: 'mdxframe' },
  ParamField: {
    kind: 'block',
    attributes: {
      path: 'string',
      query: 'string',
      header: 'string',
      body: 'string',
      name: 'string',
      type: 'string',
      required: 'boolean',
      default: 'string',
      deprecated: 'boolean',
    },
    markdownBody: true,
  },
  ResponseField: {
    kind: 'block',
    attributes: { name: 'string', type: 'string', required: 'boolean', default: 'string', deprecated: 'boolean' },
    markdownBody: true,
  },
  Expandable: { kind: 'block', attributes: { title: 'string', defaultOpen: 'boolean' }, markdownBody: true },
  Columns: { kind: 'block', attributes: {}, markdownBody: true },
  Column: { kind: 'block', attributes: {}, markdownBody: true, structural: true },
  Banner: { kind: 'block', attributes: { type: 'enum' }, markdownBody: true },
  Badge: { kind: 'inline', attributes: { color: 'color' } },
  Button: { kind: 'inline', attributes: { href: 'url', variant: 'enum' } },
  Tooltip: { kind: 'inline', attributes: { tip: 'string' } },
  Icon: { kind: 'inline', selfClosing: true, attributes: { icon: 'icon', name: 'icon', color: 'color', size: 'number' } },
  Update: { kind: 'block', attributes: { label: 'string', description: 'string' }, markdownBody: true },
  // File/folder names are display-only: nothing may resolve them against a repository or filesystem.
  FileTree: { kind: 'block', attributes: {}, markdownBody: true },
  Folder: { kind: 'block', attributes: { name: 'string', defaultOpen: 'boolean' }, markdownBody: true, structural: true },
  File: { kind: 'block', selfClosing: true, attributes: { name: 'string', icon: 'icon' }, markdownBody: true, structural: true },
  ApiExample: { kind: 'block', attributes: { title: 'string' }, markdownBody: true },
  RequestExample: { kind: 'block', attributes: { title: 'string' }, markdownBody: true, structural: true },
  ResponseExample: { kind: 'block', attributes: { title: 'string', status: 'string' }, markdownBody: true, structural: true },
  RelatedContent: { kind: 'block', attributes: { title: 'string' }, markdownBody: true },
  RelatedCard: {
    kind: 'block',
    selfClosing: true,
    attributes: { title: 'string', description: 'string', href: 'url', icon: 'icon' },
    markdownBody: true,
    structural: true,
  },
} as const satisfies Readonly<Record<string, DocumentationComponentContract>>;

export type DocumentationComponentTag = keyof typeof DOCUMENTATION_COMPONENT_CONTRACT;

/** Authored attribute names of one component. */
export type DocumentationComponentAttributeName<Tag extends DocumentationComponentTag> =
  keyof (typeof DOCUMENTATION_COMPONENT_CONTRACT)[Tag]['attributes'] & string;

type ReaderTagOf<Tag extends DocumentationComponentTag> = (typeof DOCUMENTATION_COMPONENT_CONTRACT)[Tag] extends {
  readerTag: infer Name extends string;
}
  ? Name
  : Lowercase<Tag>;

/** Element names the reader sees after HTML parsing (`<Frame>` becomes `mdxframe`). */
export type DocumentationReaderTag = { [Tag in DocumentationComponentTag]: ReaderTagOf<Tag> }[DocumentationComponentTag];

export const documentationComponentContractEntries = (): Array<[DocumentationComponentTag, DocumentationComponentContract]> =>
  Object.entries(DOCUMENTATION_COMPONENT_CONTRACT) as Array<[DocumentationComponentTag, DocumentationComponentContract]>;

export const documentationReaderTag = (tag: DocumentationComponentTag): DocumentationReaderTag =>
  ((DOCUMENTATION_COMPONENT_CONTRACT[tag] as DocumentationComponentContract).readerTag ?? tag.toLowerCase()) as DocumentationReaderTag;
