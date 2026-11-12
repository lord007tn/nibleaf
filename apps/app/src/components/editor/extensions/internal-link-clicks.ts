import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { type EditorLinks, isWebAddress } from '../editor-links';

/** The link under a pointer event, inside this editor. */
const linkAt = (view: EditorView, event: MouseEvent): HTMLAnchorElement | null => {
  const target = event.target;
  const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
  return anchor && view.dom.contains(anchor) ? anchor : null;
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
 * - A link that reaches no page, an in-page anchor or a file opens nothing.
 *
 * Web addresses (`https://…`, `mailto:`) keep the browser's behaviour. Only the
 * click is handled: the link mark, and the HTML and Markdown it produces, keep
 * the relative address.
 */
export const InternalLinkClicks = Extension.create<{ getLinks: () => EditorLinks | null }>({
  name: 'internalLinkClicks',
  addOptions() {
    return { getLinks: () => null };
  },
  addProseMirrorPlugins() {
    const { getLinks } = this.options;
    const follow = (view: EditorView, event: MouseEvent, newTab: boolean): boolean => {
      const anchor = linkAt(view, event);
      const href = anchor?.getAttribute('href');
      if (!href || isWebAddress(href)) return false;
      event.preventDefault();
      const links = getLinks();
      const target = links?.resolve(href);
      if (!links || target?.kind !== 'page') return false;
      if (newTab) {
        window.open(links.href(target.pageId), '_blank', 'noopener');
        return true;
      }
      if (view.editable) return false;
      links.open(target.pageId);
      return true;
    };
    return [
      new Plugin({
        key: new PluginKey('internalLinkClicks'),
        props: {
          handleDOMEvents: {
            click: (view, event) => event.button === 0 && follow(view, event, event.ctrlKey || event.metaKey || event.shiftKey),
            auxclick: (view, event) => event.button === 1 && follow(view, event, true),
          },
        },
      }),
    ];
  },
});
