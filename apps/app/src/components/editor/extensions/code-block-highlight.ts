import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import highlight from 'highlight.js/lib/core';

/*
 * Code block highlighting for the editor (P2-ED-005).
 *
 * CodeBlockLowlight's plugin finds every code block of the old and the new
 * document on every edit, and re-highlights them all whenever the caret is in a
 * code block. The app's CodeBlock also ended up with two copies of it (an
 * extended extension inherits the plugin and adds it again), so each keystroke
 * walked the document four times. This plugin is installed once, re-highlights
 * only the code blocks an edit touches, and maps the other blocks' highlights.
 * A block is highlighted exactly as CodeBlockLowlight highlights it.
 */

/** The parts of lowlight this plugin calls (lowlight's own types are not exported here). */
interface LowlightTree {
  value?: LowlightNode[];
  children?: LowlightNode[];
}
interface LowlightNode {
  value?: string;
  children?: LowlightNode[];
  properties?: { className: string[] };
}
export interface LowlightLike {
  highlight: (language: string, value: string) => LowlightTree;
  highlightAuto: (value: string) => LowlightTree;
  listLanguages: () => string[];
  registered?: (language: string) => boolean;
}

// As CodeBlockLowlight's plugin reads lowlight's output.
function parseNodes(nodes: LowlightNode[], className: string[] = []): Array<{ text: string; classes: string[] }> {
  return nodes.flatMap((node) => {
    const classes = [...className, ...(node.properties ? node.properties.className : [])];
    if (node.children) return parseNodes(node.children, classes);
    return { text: node.value ?? '', classes };
  });
}

const highlightNodes = (result: LowlightTree): LowlightNode[] => result.value || result.children || [];

/** The highlight decorations of one code block at `pos`, as CodeBlockLowlight makes them. */
function codeBlockDecorations(block: PMNode, pos: number, lowlight: LowlightLike, defaultLanguage: string | null | undefined): Decoration[] {
  const decorations: Decoration[] = [];
  let from = pos + 1;
  const language = block.attrs.language || defaultLanguage;
  const languages = lowlight.listLanguages();
  const known = language && (languages.includes(language) || Boolean(highlight.getLanguage(language)) || lowlight.registered?.(language));
  const tree = known ? lowlight.highlight(language, block.textContent) : lowlight.highlightAuto(block.textContent);
  for (const node of parseNodes(highlightNodes(tree))) {
    const to = from + node.text.length;
    if (node.classes.length) decorations.push(Decoration.inline(from, to, { class: node.classes.join(' ') }));
    from = to;
  }
  return decorations;
}

interface HighlightOptions {
  name: string;
  lowlight: LowlightLike;
  defaultLanguage?: string | null;
}

/** Every code block's highlights: what CodeBlockLowlight computes for a document. */
function documentHighlights(doc: PMNode, { name, lowlight, defaultLanguage }: HighlightOptions): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === name) decorations.push(...codeBlockDecorations(node, pos, lowlight, defaultLanguage));
    // A code block holds only text: nothing inside it to look at.
    return node.type.name !== name && !node.isTextblock;
  });
  return DecorationSet.create(doc, decorations);
}

/** The ranges of the new document each step of `tr` changed. */
function changedRanges(tr: Transaction): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  const size = tr.doc.content.size;
  tr.steps.forEach((step, index) => {
    const after = tr.mapping.slice(index + 1);
    tr.mapping.maps[index]?.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push({ from: Math.max(0, after.map(newStart, -1)), to: Math.min(size, after.map(newEnd, 1)) });
    });
    // An attribute step (a code block's language set in place) maps nothing.
    const at = (step as { pos?: unknown }).pos;
    if (typeof at === 'number') {
      const from = after.map(at, 1);
      ranges.push({ from: Math.min(size, from), to: Math.min(size, from + 1) });
    }
  });
  return ranges;
}

/** `previous` brought up to date with `tr`: the touched code blocks highlighted again, the rest mapped. */
function updateHighlights(previous: DecorationSet, tr: Transaction, options: HighlightOptions): DecorationSet {
  if (!tr.docChanged) return previous;
  const { doc } = tr;
  // Every textblock an edit touched: code blocks are highlighted again, and any
  // other textblock (a code block turned into a paragraph) loses what it carried.
  const touched = new Map<number, PMNode>();
  for (const { from, to } of changedRanges(tr)) {
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      touched.set(pos, node);
      return false;
    });
  }
  const next = previous.map(tr.mapping, doc);
  if (touched.size === 0) return next;
  const stale: Decoration[] = [];
  const fresh: Decoration[] = [];
  for (const [pos, node] of touched) {
    stale.push(...next.find(pos, pos + node.nodeSize));
    if (node.type.name === options.name) fresh.push(...codeBlockDecorations(node, pos, options.lowlight, options.defaultLanguage));
  }
  return next.remove(stale).add(doc, fresh);
}

/** The one highlighting plugin for code blocks named `name`. */
export function codeBlockHighlightPlugin(options: HighlightOptions): Plugin<DecorationSet> {
  const key = new PluginKey<DecorationSet>('codeBlockHighlight');
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, { doc }) => documentHighlights(doc, options),
      apply: (tr, previous) => updateHighlights(previous, tr, options),
    },
    props: {
      decorations: (state) => key.getState(state),
    },
  });
}
