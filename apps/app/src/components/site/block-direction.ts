import { blockDirection, dominantDirection } from '@nibleaf/shared/script-direction';

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/** Blocks of running text: each lays itself out by its own script. */
const TEXT_BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'dt', 'dd', 'caption', 'figcaption', 'summary']);
/** Blocks that hold other blocks. Their direction places list markers, table
 *  columns, a quote's rule and a callout's icon, so it follows their content. */
const CONTAINER_BLOCKS = new Set(['ul', 'ol', 'table', 'blockquote', 'details', 'callout', 'note', 'info', 'tip', 'check', 'warning', 'danger']);
/** Code reads left to right whatever language surrounds it. */
const CODE = new Set(['pre', 'code']);
/** Text that never decides a container's direction. */
const NOT_PROSE = new Set(['pre', 'code', 'kbd', 'samp', 'script', 'style', 'svg', 'math', 'mermaid']);

const classNames = (node: HastNode): string[] => {
  const value = node.properties?.className;
  return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/\s+/) : [];
};

const isProse = (node: HastNode): boolean => !NOT_PROSE.has(node.tagName ?? '') && !classNames(node).some((name) => name.startsWith('katex'));

/** The text the browser's `dir="auto"` reads: descendants with their own `dir`
 *  (code, nested blocks) are skipped, so the first strong letter agrees with it. */
const ownText = (node: HastNode): string =>
  node.type === 'text'
    ? (node.value ?? '')
    : (node.children ?? [])
        .filter((child) => child.type === 'text' || (child.type === 'element' && child.properties?.dir === undefined))
        .map(ownText)
        .join(' ');

/** All the prose inside a container, code and math left out. */
const proseText = (node: HastNode): string =>
  node.type === 'text'
    ? (node.value ?? '')
    : (node.children ?? [])
        .filter((child) => child.type === 'text' || (child.type === 'element' && isProse(child)))
        .map(proseText)
        .join(' ');

/**
 * rehype plugin: give each rendered block its own reading direction, so Arabic
 * paragraphs on an English page (or English ones in an Arabic shell) lay out by
 * their own script instead of the page's.
 *
 * - Text blocks (paragraphs, headings, list items, table cells…) get
 *   `dir="auto"`, or an explicit direction when they open with a word in the
 *   minority script (see blockDirection).
 * - Containers (lists, tables, quotes, callouts) get the direction most of
 *   their words are written in; `dir="auto"` cannot work there, because the
 *   browser skips the text of children that carry their own `dir`.
 * - `pre` and `code` are always `dir="ltr"`.
 *
 * Authored `dir` attributes are kept. The result depends only on the content,
 * so server and client render identical attributes.
 */
export function rehypeBlockDirection() {
  return (tree: HastNode) => {
    const visit = (node: HastNode): void => {
      for (const child of node.children ?? []) {
        if (child.type === 'element') visit(child);
      }
      if (node.type !== 'element' || !node.tagName) return;
      const properties = node.properties ?? {};
      if (properties.dir !== undefined) return;
      let dir: string | undefined;
      if (CODE.has(node.tagName)) dir = 'ltr';
      else if (TEXT_BLOCKS.has(node.tagName)) dir = blockDirection(ownText(node));
      else if (CONTAINER_BLOCKS.has(node.tagName)) dir = dominantDirection(proseText(node));
      if (dir) node.properties = { ...properties, dir };
    };
    visit(tree);
  };
}
