import { type DirectionTally, EMPTY_TALLY, mergeTallies, tallyBlockDirection, tallyMajority, tallyText } from '@nibleaf/shared/script-direction';

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/** Blocks of running text: each lays itself out by its own script. */
const TEXT_BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'dt', 'dd', 'caption', 'figcaption', 'summary']);
/** Blocks that hold other blocks. Their direction places list markers, a
 *  quote's rule and a callout's icon, so it follows their content. Tables are
 *  handled apart: their structure follows the header row. */
const CONTAINER_BLOCKS = new Set(['ul', 'ol', 'blockquote', 'details', 'callout', 'note', 'info', 'tip', 'check', 'warning', 'danger']);
/** Code reads left to right whatever language surrounds it. */
const CODE = new Set(['pre', 'code']);
/** Text that never decides a container's direction. */
const NOT_PROSE = new Set(['pre', 'code', 'kbd', 'samp', 'script', 'style', 'svg', 'math', 'mermaid']);
/** Phrasing elements: their text continues the surrounding words, so
 *  `N<strong>ible</strong>af` is one word. Any other element is a word boundary. */
const INLINE = new Set(
  'a abbr b bdi bdo cite code data del dfn em i img ins kbd mark q s samp small span strong sub sup time u var wbr tooltip icon badge'.split(' '),
);

const classNames = (node: HastNode): string[] => {
  const value = node.properties?.className;
  return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/\s+/) : [];
};

const isProse = (node: HastNode): boolean => !NOT_PROSE.has(node.tagName ?? '') && !classNames(node).some((name) => name.startsWith('katex'));

/**
 * What a node shows its parent, in document order: strings are inline text
 * still being joined into words, tallies are finished blocks (and act as word
 * boundaries). Two views are kept:
 * - `own`: the text the browser's `dir="auto"` reads, which skips descendants
 *   carrying their own `dir` (code, nested blocks).
 * - `prose`: all prose, code and math left out, for container direction.
 */
type Part = string | DirectionTally;
interface Contribution {
  own: Part[];
  prose: Part[];
}

const BOUNDARY: Part[] = [EMPTY_TALLY];

const append = (parts: Part[], more: readonly Part[]): void => {
  for (const part of more) {
    const last = parts.at(-1);
    if (typeof part === 'string' && typeof last === 'string') parts[parts.length - 1] = last + part;
    else parts.push(part);
  }
};

/** Each string is scanned exactly once, when its nearest block finishes. */
const finish = (parts: readonly Part[]): DirectionTally =>
  parts.reduce<DirectionTally>((tally, part) => mergeTallies(tally, typeof part === 'string' ? tallyText(part) : part), EMPTY_TALLY);

/**
 * rehype plugin: give each rendered block its own reading direction, so Arabic
 * paragraphs on an English page (or English ones in an Arabic shell) lay out by
 * their own script instead of the page's.
 *
 * - Text blocks (paragraphs, headings, list items, table cells…) get
 *   `dir="auto"`, or an explicit direction when they open with a word in the
 *   minority script (see blockDirection).
 * - Lists, quotes and callouts get the direction most of their words use;
 *   `dir="auto"` cannot work there, because the browser skips the text of
 *   children that carry their own `dir`.
 * - A table's structure (column order) follows its header row: the direction
 *   most header words use. With no header row, or a header without letters or
 *   evenly split, the table gets no `dir` and keeps the page's direction. Data
 *   cells never decide it, so Arabic product names cannot reverse an English
 *   table; each cell is still isolated in its own direction.
 * - `pre` and `code` are always `dir="ltr"`.
 * - An authored `dir` is kept and scopes its subtree: nothing inside it is
 *   inferred, except that code stays left to right.
 *
 * One bottom-up pass: every block's statistics are built from its children's,
 * and each text node is scanned once. The result depends only on the content,
 * so server and client render identical attributes.
 */
export function rehypeBlockDirection() {
  return (tree: HastNode) => {
    /** Prose tallies of finished rows, so a table reads its header row without rescanning it. */
    const proseTallies = new Map<HastNode, DirectionTally>();
    const visit = (node: HastNode, authoredScope: boolean): Contribution => {
      if (node.type === 'text') {
        const value = node.value ?? '';
        return { own: [value], prose: [value] };
      }
      if (node.type !== 'element' && node.type !== 'root') return { own: [], prose: [] };
      const tag = node.tagName ?? '';
      const authored = node.properties?.dir !== undefined;
      const scope = authoredScope || authored;
      const own: Part[] = [];
      const prose: Part[] = [];
      for (const child of node.children ?? []) {
        const contribution = visit(child, scope);
        append(own, contribution.own);
        append(prose, contribution.prose);
      }
      const ownTally = finish(own);
      const proseTally = finish(prose);
      if (tag === 'thead' || tag === 'tr') proseTallies.set(node, proseTally);
      // The header row: <thead>, else the first row (of the table or its body).
      let header: DirectionTally | undefined;
      if (tag === 'table') {
        const sections = (node.children ?? []).filter((child) => child.type === 'element');
        const row =
          sections.find((child) => child.tagName === 'thead') ??
          sections.flatMap((child) => (child.tagName === 'tr' ? [child] : (child.children ?? []).filter((item) => item.tagName === 'tr'))).at(0);
        header = row ? proseTallies.get(row) : undefined;
      }

      if (node.type === 'element' && !authored) {
        let dir: string | undefined;
        if (CODE.has(tag)) dir = 'ltr';
        else if (scope) dir = undefined;
        else if (TEXT_BLOCKS.has(tag)) dir = tallyBlockDirection(ownTally);
        else if (CONTAINER_BLOCKS.has(tag)) dir = tallyMajority(proseTally);
        else if (tag === 'table' && header) dir = tallyMajority(header);
        if (dir) node.properties = { ...node.properties, dir };
      }

      const hasDir = node.properties?.dir !== undefined;
      const prosePart = isProse(node);
      if (node.type === 'element' && INLINE.has(tag)) {
        return { own: hasDir ? BOUNDARY : own, prose: prosePart ? prose : BOUNDARY };
      }
      return { own: hasDir ? BOUNDARY : [ownTally], prose: prosePart ? [proseTally] : BOUNDARY };
    };
    visit(tree, false);
    proseTallies.clear();
  };
}
