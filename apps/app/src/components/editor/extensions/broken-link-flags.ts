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

/**
 * Keep the flags current after an edit without walking the whole page: map the
 * previous flags, then look again only at the textblocks the edit's steps
 * touched (as `updateBlockDirections` does). Typing on a long page costs the
 * same as on a short one.
 */
export const updateBrokenLinks = (previous: DecorationSet, tr: Transaction, resolve: ResolveLink | null, locale: Locale): DecorationSet => {
  if (!resolve) return DecorationSet.empty;
  if (tr.getMeta(REFRESH)) return brokenLinkDecorations(tr.doc, resolve, locale);
  if (!tr.docChanged) return previous;
  const { doc } = tr;
  let next = previous.map(tr.mapping, doc);
  tr.mapping.maps.forEach((stepMap, index) => {
    const after = tr.mapping.slice(index + 1);
    stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = Math.max(0, after.map(newStart, -1));
      const to = Math.min(doc.content.size, after.map(newEnd, 1));
      doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;
        const end = pos + node.nodeSize;
        next = next.remove(next.find(pos, end, (spec) => spec.brokenLink === true)).add(doc, blockFlags(node, pos, resolve, locale));
        return false;
      });
    });
  });
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
