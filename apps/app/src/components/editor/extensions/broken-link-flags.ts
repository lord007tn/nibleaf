import { type Locale, translateFn } from '@nibleaf/i18n';
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Mapping, type StepMap } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorLinks } from '../editor-links';

/** Where a link written on the open page leads; `missing` is a page that doesn't exist. */
type ResolveLink = (href: string) => { kind: string };

interface BrokenLinkFlagsOptions {
  /** The page editor's link resolution (`editor-links.ts`); without it nothing is flagged. */
  getLinks: () => EditorLinks | null;
  locale: Locale;
}

const brokenLinkFlagsKey = new PluginKey<DecorationSet>('brokenLinkFlags');
/** Asks for every link to be looked at again: the site's pages changed. */
const REFRESH = 'brokenLinkFlagsRefresh';

const flag = (from: number, to: number, href: string, locale: Locale) =>
  Decoration.inline(
    from,
    to,
    { class: 'pl-broken-link', 'data-broken-link': href, title: translateFn('editor.link.pageNotFound', { href }, locale) },
    { brokenLink: true },
  );

/** Flags for the links in one textblock at `pos` that lead to no page. */
const blockFlags = (block: PMNode, pos: number, resolve: ResolveLink, locale: Locale): Decoration[] => {
  const flags: Decoration[] = [];
  block.forEach((child, offset) => {
    const link = child.marks.find((mark) => mark.type.name === 'link');
    const href = typeof link?.attrs.href === 'string' ? link.attrs.href : '';
    if (!href || resolve(href).kind !== 'missing') return;
    const from = pos + 1 + offset;
    flags.push(flag(from, from + child.nodeSize, href, locale));
  });
  return flags;
};

/** Every flag in the document: when the editor starts, and when the site's pages change. */
export const brokenLinkDecorations = (doc: PMNode, resolve: ResolveLink | null, locale: Locale): DecorationSet => {
  if (!resolve) return DecorationSet.empty;
  const flags: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    flags.push(...blockFlags(node, pos, resolve, locale));
    return false;
  });
  return DecorationSet.create(doc, flags);
};

/** Above this many touched textblocks, the flags are read again in one pass (see `updateBrokenLinks`). */
const INCREMENTAL_BLOCKS = 16;

/** Whether a step's map moves any content (a mark step's never does). */
const movesContent = (map: StepMap): boolean => {
  let moves = false;
  map.forEach(() => {
    moves = true;
  });
  return moves;
};

/** The range a step names itself (`from`/`to` before it), and those of the steps it is made of (undo's `MarkSetStep`). */
const ownRanges = (step: unknown): Array<[number, number]> => {
  const { from, to, steps } = step as { from?: unknown; to?: unknown; steps?: unknown };
  const own: Array<[number, number]> = typeof from === 'number' && typeof to === 'number' ? [[from, to]] : [];
  return Array.isArray(steps) ? [...own, ...steps.flatMap(ownRanges)] : own;
};

/**
 * Keep the flags current after an edit without walking the whole page: map the
 * previous flags, then look again only at the textblocks the edit's steps
 * touched. Typing on a long page costs the same as on a short one.
 *
 * A step's position map says where it inserted or deleted content, but a step
 * that only adds or removes a mark (pointing a link at another page) moves
 * nothing, so its map is empty. Every step's own range counts too.
 *
 * Linear in the transaction: the changed ranges are collected in one sweep over
 * its steps (only a step that moves content moves the ranges collected so far;
 * a bold toggle across a thousand links is a thousand mark steps that move
 * nothing), merged, and the touched blocks found in one walk. A few blocks have
 * their flags swapped in one batch; an edit across many reads every link again
 * in one pass. Either way linear, never quadratic.
 */
export const updateBrokenLinks = (previous: DecorationSet, tr: Transaction, resolve: ResolveLink | null, locale: Locale): DecorationSet => {
  if (!resolve) return DecorationSet.empty;
  if (tr.getMeta(REFRESH)) return brokenLinkDecorations(tr.doc, resolve, locale);
  if (!tr.docChanged) return previous;
  const { doc } = tr;
  // Only the steps that move content move the flags: mapping every flag through a thousand empty maps is quadratic.
  const moving = tr.mapping.maps.filter(movesContent);
  const mapping = moving.length === tr.mapping.maps.length ? tr.mapping : new Mapping(moving);
  // The changed ranges, kept in the coordinates of the document after the steps swept so far.
  let ranges: Array<[number, number]> = [];
  tr.steps.forEach((step, index) => {
    const map = tr.mapping.maps[index];
    if (!map) return;
    const added: Array<[number, number]> = [];
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      added.push([newStart, newEnd]);
    });
    // A mark step's range is the same before and after it (it moves nothing).
    const own = ownRanges(step);
    if (added.length > 0) {
      ranges = ranges.map(([from, to]) => [map.map(from, -1), map.map(to, 1)]);
      for (const [from, to] of own) added.push([map.map(from, -1), map.map(to, 1)]);
    } else added.push(...own);
    // Any other step that names no range: where the document before and after it differ.
    const before = tr.docs[index];
    if (added.length === 0 && before) {
      const after = tr.docs[index + 1] ?? doc;
      const start = before.content.findDiffStart(after.content);
      const end = before.content.findDiffEnd(after.content);
      if (start !== null && end) added.push([start, Math.max(start, end.b)]);
    }
    ranges.push(...added);
  });
  if (ranges.length === 0) return previous.map(mapping, doc);
  // Sorted and merged, so the touched blocks are read in one walk.
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges
    .map(([a, b]): [number, number] => [Math.max(0, Math.min(a, b)), Math.min(doc.content.size, Math.max(a, b))])
    .sort((x, y) => x[0] - y[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  // The textblocks the edit touched, found in one walk.
  const blocks: Array<{ node: PMNode; pos: number }> = [];
  let range = 0;
  doc.nodesBetween(merged[0]?.[0] ?? 0, merged.at(-1)?.[1] ?? 0, (node, pos) => {
    // Positions only grow in this walk, so the first range not yet behind the node is the one to test.
    while (range < merged.length && (merged[range]?.[1] ?? 0) < pos) range += 1;
    const current = merged[range];
    if (!current || current[0] > pos + node.nodeSize) return false;
    if (!node.isTextblock) return true;
    blocks.push({ node, pos });
    return false;
  });
  // ProseMirror's `find` and `remove` each walk the whole set: fine for a few blocks (typing,
  // a link pointed elsewhere), quadratic for many. An edit across many blocks (a paste, a bold
  // toggle over the page) reads every link again instead, once: linear in the page.
  if (blocks.length > INCREMENTAL_BLOCKS) return brokenLinkDecorations(doc, resolve, locale);
  const mapped = previous.map(mapping, doc);
  const stale: Decoration[] = [];
  const fresh: Decoration[] = [];
  for (const { node, pos } of blocks) {
    stale.push(...mapped.find(pos, pos + node.nodeSize, (spec) => spec.brokenLink === true));
    fresh.push(...blockFlags(node, pos, resolve, locale));
  }
  return mapped.remove(stale).add(doc, fresh);
};

/**
 * Links into the site that lead to no page, flagged while writing (P1-ED-002),
 * the way an image without alt text asks to be described: a dotted underline
 * and a tooltip, "Page not found: /configuration". The links resolve with the
 * page editor's own resolver, the one the publish checks use
 * (`editor-links.ts`); a link not known yet (pages loading, another docs
 * version) is never flagged. Decorations only: nothing reaches the document or
 * its Markdown.
 */
export const BrokenLinkFlags = Extension.create<BrokenLinkFlagsOptions>({
  name: 'brokenLinkFlags',
  addOptions() {
    return { getLinks: () => null, locale: 'en' };
  },
  addProseMirrorPlugins() {
    const { getLinks, locale } = this.options;
    const resolver = (): ResolveLink | null => getLinks()?.resolve ?? null;
    return [
      new Plugin<DecorationSet>({
        key: brokenLinkFlagsKey,
        state: {
          init: (_config, state) => brokenLinkDecorations(state.doc, resolver(), locale),
          apply: (tr, previous) => updateBrokenLinks(previous, tr, resolver(), locale),
        },
        props: {
          decorations: (state) => brokenLinkFlagsKey.getState(state) ?? null,
        },
      }),
    ];
  },
});

/** Look at every link again (the site's pages changed): a redraw, never an edit. */
export const refreshBrokenLinks = (tr: Transaction): Transaction => tr.setMeta(REFRESH, true);
