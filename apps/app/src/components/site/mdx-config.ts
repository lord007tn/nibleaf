import { normalizeType } from '@nibleaf/shared/callouts';
import {
  type DocumentationComponentContract,
  documentationComponentContractEntries,
  documentationReaderTag,
} from '@nibleaf/shared/documentation-component-contract';
import type { Root } from 'mdast';

// Everything component-specific below is derived from the reader contract in
// @nibleaf/shared/documentation-component-contract; add components there.
const CONTRACT = documentationComponentContractEntries();
const readerTagsWhere = (predicate: (component: DocumentationComponentContract) => boolean): string[] =>
  CONTRACT.flatMap(([tag, component]) => (predicate(component) ? [documentationReaderTag(tag)] : []));

/** The sanitize schema lives in @nibleaf/shared/reader-sanitize: the parser that reads
 * a page's headings as the reader renders them sanitizes with the same one. */
export { MDX_BLOCK_TAGS, normalizeMdxBlocks, readerTagRewriter } from '@nibleaf/shared/reader-markdown';
export { readerSanitizeSchema as sanitizeSchema } from '@nibleaf/shared/reader-sanitize';

// Minimal mdast walker (avoids adding a unist-util-visit dependency).
type AnyNode = {
  type: string;
  value?: string;
  lang?: string;
  meta?: string;
  children?: AnyNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};
function walk(node: AnyNode, type: string, fn: (n: AnyNode) => void) {
  if (node.type === type) {
    fn(node);
  }
  for (const child of node.children ?? []) {
    walk(child, type, fn);
  }
}

const ADMONITION = /^\[!(\w+)\]\s*/;

/** remark plugin: rewrite blockquotes that start with `[!TYPE]` into a
 *  `callout` element with a `type` prop, stripping the marker — so the Callout
 *  authored in the editor (serialized as a GitHub admonition) renders as a
 *  styled callout instead of a raw blockquote showing a literal "[!NOTE]". */
export function remarkCallouts() {
  return (tree: Root) => {
    walk(tree as unknown as AnyNode, 'blockquote', (node) => {
      const firstPara = node.children?.[0];
      if (firstPara?.type !== 'paragraph') {
        return;
      }
      const firstText = firstPara.children?.[0];
      if (firstText?.type !== 'text' || firstText.value === undefined) {
        return;
      }
      const match = ADMONITION.exec(firstText.value);
      if (!match) {
        return;
      }
      firstText.value = firstText.value.replace(ADMONITION, '');
      if (firstText.value === '' && firstPara.children?.length === 1) {
        node.children?.shift();
      }
      node.data = node.data ?? {};
      node.data.hName = 'callout';
      node.data.hProperties = { type: normalizeType(match[1]) };
    });
  };
}

const CODE_TITLE = /title="([^"]*)"|title='([^']*)'/;

/** remark plugin: lift a fenced code block's info string (``` lang title="x")
 *  onto the rendered `<code>` as `data-title`/`data-lang`, so the Pre renderer
 *  can draw a Mintlify-style filename header. */
export function remarkCodeMeta() {
  return (tree: Root) => {
    walk(tree as unknown as AnyNode, 'code', (node) => {
      const meta = node.meta?.trim();
      let title: string | undefined;
      if (meta) {
        const match = CODE_TITLE.exec(meta);
        if (match) {
          title = match[1] ?? match[2];
        } else if (!meta.startsWith('{')) {
          // Bare `lang Some Title` form — take the whole meta as the title.
          title = meta.replace(/^["']|["']$/g, '') || undefined;
        }
      }
      if (!title && !node.lang) {
        return;
      }
      node.data = node.data ?? {};
      const props = (node.data.hProperties ?? {}) as Record<string, unknown>;
      // hast property names are camelCase; mdast→hast/sanitize round-trip these
      // to the `data-title`/`data-lang` DOM attributes the Pre renderer reads.
      if (title) {
        props.dataTitle = title;
      }
      if (node.lang) {
        props.dataLang = node.lang;
      }
      node.data.hProperties = props;
    });
  };
}

// ─── Mermaid ─────────────────────────────────────────────────────────────────

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/** Every component with a `name` prop: the sanitizer strips real `name` attributes (DOM clobbering). */
const DISPLAY_NAME_COMPONENTS = new Set(readerTagsWhere((component) => 'name' in component.attributes));
/** Items inside a container, which Markdown may wrap in a paragraph of their own. */
const STRUCTURAL_COMPONENTS = new Set(readerTagsWhere((component) => component.structural === true));

/** Preserve authored component `name` props without disabling rehype-sanitize's
 * DOM-clobber protection for real HTML name attributes. The display value is
 * moved to a data attribute before sanitization and never interpreted. */
export function rehypeAuthoredComponentProps() {
  return (tree: HastNode) => {
    const visit = (node: HastNode): void => {
      if (node.type === 'element' && node.tagName && DISPLAY_NAME_COMPONENTS.has(node.tagName) && node.properties?.name !== undefined) {
        node.properties.dataDisplayName = node.properties.name;
        delete node.properties.name;
      }
      if (node.children) {
        node.children = node.children.flatMap((child) => {
          if (
            child.type === 'element' &&
            child.tagName === 'p' &&
            child.children?.every((nested) =>
              nested.type === 'text' ? !nested.value?.trim() : Boolean(nested.tagName && STRUCTURAL_COMPONENTS.has(nested.tagName)),
            )
          ) {
            return child.children;
          }
          return [child];
        });
      }
      for (const child of node.children ?? []) {
        visit(child);
      }
    };
    visit(tree);
  };
}

function hastText(node: HastNode): string {
  if (node.type === 'text') {
    return node.value ?? '';
  }
  return (node.children ?? []).map(hastText).join('');
}

/** rehype plugin: replace ```mermaid fenced code with a `<mermaid>` element
 *  carrying the raw diagram source, so a client component can render the SVG
 *  (and rehype-highlight never tries to tokenize the diagram). Runs after
 *  sanitize so the synthesized element survives. */
export function rehypeMermaid() {
  return (tree: HastNode) => {
    const visit = (node: HastNode): void => {
      if (!node.children) {
        return;
      }
      node.children = node.children.map((child) => {
        if (child.type === 'element' && child.tagName === 'pre') {
          const code = child.children?.find((c) => c.type === 'element' && c.tagName === 'code');
          const cls = code?.properties?.className;
          const isMermaid = Array.isArray(cls) ? cls.includes('language-mermaid') : typeof cls === 'string' && cls.includes('language-mermaid');
          if (code && isMermaid) {
            return { type: 'element', tagName: 'mermaid', properties: {}, children: [{ type: 'text', value: hastText(code) }] };
          }
        }
        visit(child);
        return child;
      });
    };
    visit(tree);
  };
}

export { rehypeBlockDirection } from './block-direction';
