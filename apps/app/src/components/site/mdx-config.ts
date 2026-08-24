import type { Root } from 'mdast';
import { defaultSchema } from 'rehype-sanitize';

export type CalloutType = 'note' | 'info' | 'tip' | 'check' | 'warning' | 'danger';

/** Normalize an admonition/callout keyword to one of our supported types. */
export const normalizeType = (raw?: string): CalloutType => {
  const t = (raw ?? 'note').toLowerCase();
  if (t === 'caution') return 'danger';
  if (t === 'important') return 'info';
  if (['note', 'info', 'tip', 'check', 'warning', 'danger'].includes(t)) return t as CalloutType;
  return 'note';
};

/** The custom component tag names the renderer understands (lowercased, as
 *  rehype-raw emits them). */
const COMPONENT_TAGS = [
  'callout',
  'note',
  'warning',
  'info',
  'tip',
  'check',
  'danger',
  'card',
  'cardgroup',
  'tabs',
  'tab',
  'accordion',
  'accordiongroup',
  'steps',
  'step',
  // `<Frame>` is renamed to `mdxframe` before parsing because `frame` is a real
  // (deprecated) HTML element that the HTML5 parser drops outside a frameset.
  'mdxframe',
  'tooltip',
  // API-reference + extra docs primitives (Mintlify parity).
  'paramfield',
  'responsefield',
  'expandable',
  'codegroup',
  'icon',
  'update',
  'columns',
  'column',
  'banner',
  'badge',
  'button',
  // Authored documentation structures. File/folder names are display-only;
  // renderers must never resolve them against a repository or filesystem.
  'filetree',
  'folder',
  'file',
  'apiexample',
  'requestexample',
  'responseexample',
  'relatedcontent',
  'relatedcard',
  // `<mermaid>` is synthesized by rehypeMermaid from ```mermaid fences.
  'mermaid',
] as const;

// Block-level component tags whose inner content should be parsed as Markdown.
const BLOCK_TAGS =
  'Callout|Note|Warning|Info|Tip|Check|Danger|Card|CardGroup|Tabs|Tab|Accordion|AccordionGroup|Steps|Step|Frame|ParamField|ResponseField|Expandable|Update|Columns|Column|Banner|FileTree|Folder|File|ApiExample|RequestExample|ResponseExample|RelatedContent|RelatedCard';
// Matches an opening block tag on its own line — with or without attributes —
// but not a self-closing tag (`<Frame />`).
const OPEN_TAG = new RegExp(`^\\s*<(?:${BLOCK_TAGS})\\b(?:[^>]*[^/>])?>\\s*$`, 'i');
const CLOSE_TAG = new RegExp(`^\\s*</(?:${BLOCK_TAGS})>\\s*$`, 'i');
const COMPONENT_LINE = new RegExp(`^\\s*</?(?:${BLOCK_TAGS})\\b[^>]*>\\s*$`, 'i');

/** Ensure block component tags are separated from their inner content by a blank
 *  line, so CommonMark parses the children as Markdown. Without this, content
 *  directly after `<Note>` is captured as a raw HTML block and inline Markdown
 *  (**bold**, [links]) renders literally. Idempotent. */
export function normalizeMdxBlocks(src: string): string {
  const lines = src.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const authoredLine = lines[i] ?? '';
    // Indentation is visual authoring syntax, not a request to turn component
    // tags into CommonMark code blocks.
    const line = COMPONENT_LINE.test(authoredLine) ? authoredLine.trim() : authoredLine;
    if (OPEN_TAG.test(line)) {
      out.push(line);
      const next = lines[i + 1];
      if (next !== undefined && next.trim() !== '') {
        out.push('');
      }
    } else if (CLOSE_TAG.test(line)) {
      const prev = out[out.length - 1];
      if (prev !== undefined && prev.trim() !== '') {
        out.push('');
      }
      out.push(line);
    } else {
      out.push(line);
    }
  }
  // Rename <Frame> → <mdxframe> to dodge the real HTML <frame> element, which
  // the HTML5 parser drops outside a frameset. Keep the leading "<" (capture
  // group 1 is only the optional closing slash) so the tag stays well-formed.
  return (
    out
      .join('\n')
      .replace(/<(\/?)Frame\b/gi, '<$1mdxframe')
      // HTML parsers do not honor XML self-closing syntax for unknown elements.
      // Expand authored atoms so sibling File/RelatedCard nodes cannot nest.
      .replace(/<(File|RelatedCard|Icon)\b([^>]*)\/>/gi, '<$1$2></$1>')
  );
}

/** Sanitize schema: the GitHub-safe default, extended to permit our component
 *  tags and their props, plus className/id passthrough for headings & code
 *  highlighting. Scripts, event handlers, and unknown attributes are still
 *  stripped — this is what makes raw component HTML safe to render. */
export const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), ...COMPONENT_TAGS],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'id'],
    callout: ['type'],
    card: ['title', 'href', 'icon'],
    cardgroup: ['cols'],
    tab: ['title'],
    accordion: ['title', 'defaultOpen', 'defaultopen'],
    step: ['title'],
    mdxframe: ['caption'],
    tooltip: ['tip'],
    paramfield: ['path', 'query', 'header', 'body', 'dataDisplayName', 'type', 'required', 'default', 'deprecated'],
    responsefield: ['dataDisplayName', 'type', 'required', 'default', 'deprecated'],
    expandable: ['title', 'defaultOpen', 'defaultopen'],
    icon: ['icon', 'dataDisplayName', 'color', 'size'],
    update: ['label', 'description'],
    banner: ['type'],
    badge: ['color'],
    button: ['href', 'variant'],
    folder: ['dataDisplayName', 'defaultOpen', 'defaultopen'],
    file: ['dataDisplayName', 'icon'],
    apiexample: ['title'],
    requestexample: ['title'],
    responseexample: ['title', 'status'],
    relatedcontent: ['title'],
    relatedcard: ['title', 'description', 'href', 'icon'],
    // `dataTitle`/`dataLang` (hast camelCase → data-title/data-lang) carry the
    // fenced-code header (filename + language). mdast→hast may place a code
    // node's hProperties on the wrapping <pre>, so allow them on both elements.
    pre: [...(defaultSchema.attributes?.pre ?? []), 'dataTitle', 'dataLang'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className', 'dataTitle', 'dataLang'],
  },
};

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

const DISPLAY_NAME_COMPONENTS = new Set(['folder', 'file', 'paramfield', 'responsefield', 'icon']);
const STRUCTURAL_COMPONENTS = new Set([
  'card',
  'tab',
  'accordion',
  'step',
  'column',
  'folder',
  'file',
  'requestexample',
  'responseexample',
  'relatedcard',
]);

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
