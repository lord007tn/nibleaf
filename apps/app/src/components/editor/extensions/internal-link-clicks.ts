import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { type EditorLinks, type EditorLinkTarget, editorLinkResolver, isWebAddress } from '../editor-links';

/** The link under a pointer event, inside this editor. */
const linkAt = (view: EditorView, event: MouseEvent): HTMLAnchorElement | null => {
  const target = event.target;
  const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
  return anchor && view.dom.contains(anchor) ? anchor : null;
};

/** How far the pointer may move between press and release and still be a click, not a drag-select. */
const DRAG_DISTANCE = 4;

/** Without the page editor nothing is known about the site: anchors are anchors, the rest is unknown. */
const withoutSite = editorLinkResolver(null, undefined);

/** Open `href`'s page once it is resolved, in a tab opened now (so the browser allows it). */
const openInNewTab = (links: EditorLinks, href: string, target: EditorLinkTarget) => {
  if (target.kind === 'page') {
    window.open(links.href(target.pageId, target.anchor), '_blank', 'noopener');
    return;
  }
  const tab = window.open('about:blank', '_blank');
  if (!tab) return;
  tab.opener = null;
  void links.resolveAsync(href).then(
    (resolved) => (resolved.kind === 'page' ? tab.location.replace(links.href(resolved.pageId, resolved.anchor)) : tab.close()),
    () => tab.close(),
  );
};

/**
 * Clicks on the links in the page. A link into the site is stored relative, so
 * the browser would follow it to the dashboard's own domain (a broken app
 * address). Here such a link opens the linked page in the editor instead:
 *
 * - Ctrl/⌘/Shift+click and middle-click open the page's editor in a new tab.
 * - A plain click (or Enter on a focused link) while reading, when the page
 *   can't be edited, opens it in this tab. While editing, a plain click only
 *   places the caret, as before.
 * - A link to a page, to no page, or not resolved yet never reaches the app's
 *   address. A link to no page opens nothing.
 * - A link to a section (`setup#install`, or `#install` on this page) opens
 *   the page at that heading (#553).
 * - Editing wins: a click while composing text (IME), a Shift+click that
 *   extends the selection, and a drag that ends on a link select text as usual
 *   and open nothing.
 *
 * Web addresses (`https://…`, `mailto:`) and files keep the
 * browser's behaviour. Only the click is handled: the link mark, and the HTML
 * and Markdown it produces, keep the relative address.
 */
export const InternalLinkClicks = Extension.create<{ getLinks: () => EditorLinks | null }>({
  name: 'internalLinkClicks',
  addOptions() {
    return { getLinks: () => null };
  },
  addProseMirrorPlugins() {
    const { getLinks } = this.options;
    // Where the pointer went down, to tell a click from a drag-select.
    let pressed: { x: number; y: number } | null = null;
    const editing = (view: EditorView, event: MouseEvent): boolean => {
      const down = pressed;
      pressed = null;
      // A keyboard "click" (Enter) has no pointer movement.
      const dragged = event.detail > 0 && down !== null && Math.hypot(event.clientX - down.x, event.clientY - down.y) > DRAG_DISTANCE;
      const extendsSelection = event.shiftKey && (view.editable || !view.state.selection.empty);
      return view.composing || extendsSelection || dragged;
    };
    const follow = (view: EditorView, event: MouseEvent, newTab: boolean): boolean => {
      const href = linkAt(view, event)?.getAttribute('href');
      if (!href || isWebAddress(href)) return false;
      const links = getLinks();
      const target = links ? links.resolve(href) : withoutSite(href);
      // Files and other site routes keep the browser's behaviour.
      if (target.kind === 'web' || target.kind === 'other') return false;
      // A page, no page, or not known yet: never the app's own address.
      event.preventDefault();
      if (!links || target.kind === 'missing' || editing(view, event)) return false;
      if (newTab) {
        openInNewTab(links, href, target);
        return true;
      }
      if (view.editable) return false;
      if (target.kind === 'page') links.open(target.pageId, target.anchor);
      else void links.resolveAsync(href).then((resolved) => resolved.kind === 'page' && links.open(resolved.pageId, resolved.anchor));
      return true;
    };
    return [
      new Plugin({
        key: new PluginKey('internalLinkClicks'),
        props: {
          handleDOMEvents: {
            mousedown: (_view, event) => {
              pressed = { x: event.clientX, y: event.clientY };
              return false;
            },
            click: (view, event) => event.button === 0 && follow(view, event, event.ctrlKey || event.metaKey || event.shiftKey),
            auxclick: (view, event) => event.button === 1 && follow(view, event, true),
          },
        },
      }),
    ];
  },
});
