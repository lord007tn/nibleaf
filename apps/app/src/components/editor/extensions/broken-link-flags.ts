import { type Locale, translateFn } from '@nibleaf/i18n';
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
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
 */
export const updateBrokenLinks = (previous: DecorationSet, tr: Transaction, resolve: ResolveLink | null, locale: Locale): DecorationSet => {
  if (!resolve) return DecorationSet.empty;
  if (tr.getMeta(REFRESH)) return brokenLinkDecorations(tr.doc, resolve, locale);
  if (!tr.docChanged) return previous;
  const { doc } = tr;
  // The changed ranges, in the final document.
  const ranges: Array<[number, number]> = [];
  tr.steps.forEach((step, index) => {
    const after = tr.mapping.slice(index + 1);
    let found = false;
    tr.mapping.maps[index]?.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      found = true;
      ranges.push([after.map(newStart, -1), after.map(newEnd, 1)]);
    });
    // A mark step's range is the same before and after it (it moves nothing).
    const through = tr.mapping.slice(index);
    for (const [from, to] of ownRanges(step)) {
      found = true;
      ranges.push([through.map(from, -1), through.map(to, 1)]);
    }
    // Any other step that moved nothing: where the document before and after it differ.
    const before = tr.docs[index];
    const stepDoc = tr.docs[index + 1] ?? doc;
    if (!found && before) {
      const start = before.content.findDiffStart(stepDoc.content);
      const end = before.content.findDiffEnd(stepDoc.content);
      if (start !== null && end) ranges.push([after.map(start, -1), after.map(Math.max(start, end.b), 1)]);
    }
  });
  let next = previous.map(tr.mapping, doc);
  const seen = new Set<number>();
  for (const [start, end] of ranges) {
    const from = Math.max(0, Math.min(start, end));
    const to = Math.min(doc.content.size, Math.max(start, end));
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      if (seen.has(pos)) return false;
      seen.add(pos);
      const blockEnd = pos + node.nodeSize;
      next = next.remove(next.find(pos, blockEnd, (spec) => spec.brokenLink === true)).add(doc, blockFlags(node, pos, resolve, locale));
      return false;
    });
  }
  return next;
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
