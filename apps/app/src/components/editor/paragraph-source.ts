import { Extension } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import { DOMParser as PMDOMParser, type Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import type { MarkdownNodeSpec } from 'tiptap-markdown';
import { decodeMdxSource, encodeMdxSource } from './extensions/mdx-roundtrip';
import type { MarkdownOutput } from './markdown-output';
import { markTightLists } from './tight-lists';

/*
 * A paragraph wrapped across several lines in the source keeps those lines, so a
 * save writes them back as they were. The editor reads a line break inside a
 * paragraph as a space, and its serializer writes every paragraph on one line,
 * so without this every hard-wrapped paragraph (the starter pages, most imported
 * and Git-authored Markdown) was rewritten the first time its page was saved,
 * even when the writer only changed another paragraph.
 *
 * The lines are written back only while the paragraph still says exactly what
 * they say: the serializer's own output for the paragraph must equal the source
 * lines joined the way the reader joins them. Any edit to the paragraph's text,
 * marks or links makes the two differ, and the paragraph saves in the canonical
 * form, as before. Container prefixes (a quote's `>`, a list item's indent) are
 * not part of the kept text: the containers' serializers write them again.
 */

/** The HTML attribute the markdown-it rule leaves on a paragraph's `<p>`. */
const SOURCE_ATTRIBUTE = 'data-md-paragraph-source';

const isSpaceOrTab = (character: string | undefined): boolean => character === ' ' || character === '\t';

/**
 * The source lines of a paragraph joined the way markdown-it and the editor read
 * them: each line break, with the next line's leading spaces and one trailing
 * space before it, becomes one space. Null when the paragraph has no line break
 * or one of its breaks is a hard break (two or more trailing spaces, or a
 * backslash), which the editor keeps as its own node.
 */
export function joinedSourceLines(source: string): string | null {
  if (!source.includes('\n')) return null;
  const lines = source.split('\n');
  const last = lines.length - 1;
  const parts: string[] = [];
  for (const [index, line] of lines.entries()) {
    let start = 0;
    let end = line.length;
    if (index > 0) while (start < end && isSpaceOrTab(line[start])) start += 1;
    if (index < last) {
      if (line.endsWith('\\') || line.endsWith('  ')) return null;
      if (line.endsWith(' ') && end > start) end -= 1;
    }
    parts.push(line.slice(start, end));
  }
  return parts.join(' ');
}

interface MarkdownToken {
  type: string;
  tag: string;
  content: string;
  hidden: boolean;
  children: MarkdownToken[] | null;
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
}

interface MarkdownCoreState<T extends MarkdownToken> {
  tokens: T[];
}

const LIST_OPEN = new Set(['bullet_list_open', 'ordered_list_open']);
const LIST_CLOSE = new Set(['bullet_list_close', 'ordered_list_close']);
const TASK_ITEM = /^\[[ xX]\][ \t]/;

/**
 * A markdown-it core rule, run after the block rules, in one forward pass over the
 * tokens. Each paragraph written across several lines gets its inline source (the
 * lines without their containers' prefixes) on its `<p>`.
 *
 * markdown-it hides the paragraphs of a tight list, so their `<p>` is never
 * rendered and nothing could carry the source. Such a paragraph is shown. A list
 * reads as tight in tiptap-markdown when it holds no `<p>` at any depth, so each
 * list that held no shown paragraph before, and now holds one of these, is marked
 * tight (`data-tight`, read before looking for a `<p>`): it still saves without
 * blank lines between its items, and lists around it keep their spacing too.
 */
function annotateParagraphs<T extends MarkdownToken>(state: MarkdownCoreState<T>): void {
  const { tokens } = state;
  /** Open lists, innermost last: whether they hold a paragraph shown in the source,
   *  and one shown here. A list hands both to the list around it when it closes. */
  const lists: Array<{ token: T; shown: boolean; revealed: boolean }> = [];
  for (const [index, token] of tokens.entries()) {
    if (LIST_OPEN.has(token.type)) lists.push({ token, shown: false, revealed: false });
    const list = lists[lists.length - 1];
    if (list && LIST_CLOSE.has(token.type)) {
      lists.pop();
      if (list.revealed && !list.shown) {
        list.token.attrSet('data-tight', 'true');
        if (list.token.attrGet('data-md-item-main-tight') !== null) list.token.attrSet('data-md-item-main-tight', 'true');
      }
      const parent = lists[lists.length - 1];
      if (parent) {
        parent.shown ||= list.shown;
        parent.revealed ||= list.revealed;
      }
    }
    if (token.type !== 'paragraph_open') continue;
    const inline = tokens[index + 1];
    const close = tokens[index + 2];
    if (inline?.type !== 'inline' || close?.type !== 'paragraph_close') continue;
    // An empty paragraph is a fence's lead (fence-source.ts), which handles its list.
    if (list && !token.hidden && inline.content !== '') list.shown = true;
    if (joinedSourceLines(inline.content) === null) continue;
    if (token.hidden) {
      // A task item's checkbox is read from the start of its text by a later rule.
      if (!list || TASK_ITEM.test(inline.content)) continue;
      token.hidden = false;
      close.hidden = false;
      list.revealed = true;
    }
    token.attrSet(SOURCE_ATTRIBUTE, encodeMdxSource(inline.content));
  }
}

/**
 * A markdown-it core rule, run after the inline rules: a line break right after an
 * element (the end of bold, code, a link, inline HTML) is rendered as a space.
 * tiptap-markdown renders a line break as a newline and then deletes a newline at
 * the start of the text after an element, so such a line was joined to the next
 * word (`Use **bold**` then `next` read as "Use boldnext") and saved that way.
 * A line break after plain text is left alone: it already reads as a space on
 * load, and pasted plain text keeps it as a line break.
 */
function softBreaksAsSpaces<T extends MarkdownToken>(state: MarkdownCoreState<T>): void {
  for (const token of state.tokens) {
    if (token.type !== 'inline' || !token.children) continue;
    let previous: MarkdownToken | undefined;
    for (const child of token.children) {
      if (child.type === 'softbreak' && previous && previous.type !== 'text' && previous.type !== 'softbreak') {
        child.type = 'text';
        child.tag = '';
        child.content = ' ';
      }
      // Emphasis leaves an empty text token where its closing delimiter was.
      if (child.type !== 'text' || child.content !== '') previous = child;
    }
  }
}

/** The parts of prosemirror-markdown's serializer state a paragraph is written with. */
interface ParagraphSerializeState {
  output: MarkdownOutput;
  write: (content?: string) => void;
  text: (text: string, escapeText?: boolean) => void;
  renderInline: (node: PMNode) => void;
  closeBlock: (node: PMNode) => void;
}

/** The containers whose first line their serializer writes before their first child: a
 *  list item's marker, a quote's `>`. */
const LINE_CONTAINERS: ReadonlySet<string> = new Set(['listItem', 'blockquote']);

/**
 * Whether `node` is an empty paragraph that opens a list item or quote, with a paragraph
 * after it. Markdown has no empty paragraph there: written (`- `, a blank line, then the
 * rest), it read back as an empty item and a paragraph outside the list, so a page with
 * one never saved to a fixed point. It is left out, and the paragraph after it opens the
 * item. Before any other block (a nested list, a quote) it is written as before: left
 * out, that block's own marker would share the item's line (`- - Beta`).
 */
const emptyLead = (node: PMNode, parent: PMNode | Fragment | undefined, index: number | undefined): boolean =>
  index === 0 &&
  node.content.size === 0 &&
  !!parent &&
  'type' in parent &&
  LINE_CONTAINERS.has(parent.type.name) &&
  parent.childCount > 1 &&
  parent.child(1).type.name === 'paragraph';

/**
 * Write a paragraph: its source lines when the paragraph still reads the same as
 * they do (see the note at the top), otherwise the serializer's single line.
 */
function writeParagraph(state: ParagraphSerializeState, node: PMNode, parent?: PMNode | Fragment, index?: number): void {
  if (emptyLead(node, parent, index)) return;
  if (
    index === 0 &&
    node.content.size === 0 &&
    node.attrs.sourceItemLead === 'inline' &&
    parent &&
    'type' in parent &&
    parent.type.name === 'listItem' &&
    parent.childCount > 1 &&
    ['blockquote', 'heading', 'bulletList', 'orderedList'].includes(parent.child(1).type.name)
  )
    return;
  const source = String(node.attrs.sourceParagraph ?? '');
  const joined = source ? joinedSourceLines(source) : null;
  if (joined === null) {
    state.renderInline(node);
    state.closeBlock(node);
    return;
  }
  // Write what comes before the paragraph (closing blank lines, container
  // prefixes) first, so only the paragraph's own text is compared.
  state.write();
  const { output } = state;
  const start = output.length;
  state.renderInline(node);
  if (output.length - start === joined.length && output.sliceFrom(start) === joined) {
    output.truncate(start);
    // Unescaped: these lines are the source, already valid Markdown here.
    state.text(source, false);
  }
  state.closeBlock(node);
}

const paragraphParsers = new WeakSet<object>();

const ITEM_LEAD_NODES = new Set(['blockquote', 'heading', 'bulletList', 'orderedList']);
const ITEM_CONTENT_NODES = new Set(['paragraph', 'text', 'hardBreak', 'listItem', ...ITEM_LEAD_NODES]);

/** Validate the staged lead after callout and task-list DOM conversions. A token
 * called a quote can now be an HTML-backed callout (#871). Probe the unmodified
 * item with the real schema and keep the lead only when fitting hoists its block. */
function fitItemLeads(element: HTMLElement, schema: Schema): void {
  const parser = PMDOMParser.fromSchema(schema);
  const affected = new Set<Element>();
  const leads = Array.from(element.querySelectorAll('li > p[data-md-item-lead]'));
  const candidates = new Set<Element | null>(leads.map((lead) => lead.parentElement));
  const tails = new Map<Element, boolean>();
  // Leads are visited backwards, so following items have their final lead state.
  const followingLeads = (item: Element): boolean => {
    const pending: Element[] = [];
    let result = true;
    for (let next = item.nextElementSibling; next; next = next.nextElementSibling) {
      const cached = tails.get(next);
      if (cached !== undefined) {
        result = cached;
        break;
      }
      pending.push(next);
      if (next.tagName === 'LI' && !next.firstElementChild?.matches('p[data-md-item-lead]')) {
        result = false;
        break;
      }
    }
    for (const next of pending) tails.set(next, result);
    return result;
  };
  const simpleContents = new Map<Element, boolean>();
  const simpleContent = (item: Element): boolean => {
    const cached = simpleContents.get(item);
    if (cached !== undefined) return cached;
    const clone = item.cloneNode(true) as HTMLElement;
    for (const staged of clone.querySelectorAll('p[data-md-item-lead]')) staged.remove();
    let simple = true;
    parser.parseSlice(clone).content.descendants((node) => {
      if (!ITEM_CONTENT_NODES.has(node.type.name)) simple = false;
      return simple;
    });
    simpleContents.set(item, simple);
    return simple;
  };
  for (const lead of leads.reverse()) {
    const item = lead.parentElement;
    const list = item?.parentElement;
    if (!item || !list) continue;
    const original = item.cloneNode(true) as HTMLElement;
    for (const staged of original.querySelectorAll('p[data-md-item-lead]')) staged.remove();
    const first = original.firstElementChild;
    const blockDOM = document.createElement('div');
    if (first) blockDOM.appendChild(first.cloneNode(true));
    const block = parser.parseSlice(blockDOM).content.firstChild;
    const listDOM = list.cloneNode(false) as HTMLElement;
    listDOM.appendChild(original);
    const holder = document.createElement('div');
    holder.appendChild(listDOM);
    const fitted = parser.parse(holder).firstChild?.firstChild;
    let stayed = false;
    fitted?.forEach((child) => {
      if (block && child.eq(block)) stayed = true;
    });
    let safe = simpleContent(list);
    // Hoisting an inline block can turn later ordered items into a new bullet
    // list. Keeping those items byte-identical to main needs a serializer fix.
    // A marker-only item after an edit is a different source shape (#858).
    if (list.tagName === 'OL' && lead.getAttribute('data-md-item-lead') === 'inline') {
      safe &&= followingLeads(item);
    }
    for (let ancestor: Element | null = item; ancestor; ancestor = ancestor.parentElement) {
      if (candidates.has(ancestor) && !simpleContent(ancestor)) safe = false;
      // Canonical markers merge adjacent lists on reload. Restoring an item
      // there needs a separate serializer change, not just a load-time lead.
      if (ancestor.matches('ul,ol') &&
        (ancestor.previousElementSibling?.tagName === ancestor.tagName || ancestor.nextElementSibling?.tagName === ancestor.tagName)) safe = false;
    }
    if (safe && block && ITEM_LEAD_NODES.has(block.type.name) && !stayed) continue;
    lead.remove();
    for (let ancestor: Element | null = list; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.matches('ul,ol')) affected.add(ancestor);
    }
  }
  for (const list of affected) {
    if (!list.querySelector('p[data-md-item-lead]')) {
      if (list.getAttribute('data-md-item-main-tight') === 'true') list.setAttribute('data-tight', 'true');
      else list.removeAttribute('data-tight');
    }
  }
}

// Run after every node's DOM conversion without changing paragraph's schema order.
const ListItemLeadFitting = Extension.create({
  name: 'listItemLeadFitting',
  priority: -1,
  addStorage() {
    return {
      markdown: {
        parse: {
          updateDOM(element) {
            fitItemLeads(element, this.editor.schema);
          },
        },
      } satisfies Pick<MarkdownNodeSpec, 'parse'>,
    };
  },
});

/** StarterKit's paragraph, keeping its source lines (see the note at the top). */
export const SourceParagraph = Paragraph.extend({
  addExtensions() {
    return [ListItemLeadFitting];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      sourceItemLead: {
        // Undefined keeps ordinary paragraphs' serialized JSON unchanged.
        default: undefined,
        keepOnSplit: false,
        parseHTML: (element) => element.getAttribute('data-md-item-lead') ?? undefined,
        rendered: false,
      },
      sourceParagraph: {
        default: '',
        // A new paragraph after Enter starts without a source. (A split mid-paragraph
        // copies it to both halves; neither reads as the source any more, so neither
        // writes it.)
        keepOnSplit: false,
        parseHTML: (element) => decodeMdxSource(element.getAttribute(SOURCE_ATTRIBUTE)),
        rendered: false,
      },
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node, parent, index) {
          // The editor saves with LinearMarkdownSerializerState (markdown-output.ts).
          writeParagraph(state as unknown as ParagraphSerializeState, node, parent, index);
        },
        parse: {
          setup(markdownit) {
            if (paragraphParsers.has(markdownit)) return;
            markdownit.core.ruler.after('block', 'nibleaf_paragraph_source', (state) => annotateParagraphs(state));
            // Reads markdown-it's tight lists before a hidden paragraph is shown (tight-lists.ts).
            markdownit.core.ruler.before('nibleaf_paragraph_source', 'nibleaf_tight_lists', (state) => markTightLists(state));
            markdownit.core.ruler.after('inline', 'nibleaf_soft_breaks', (state) => softBreaksAsSpaces(state));
            paragraphParsers.add(markdownit);
          },
        },
      } satisfies MarkdownNodeSpec,
    };
  },
});
