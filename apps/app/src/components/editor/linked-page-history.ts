import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The page editor's scroll position when this history entry was left for a linked page. */
    editorScroll?: number;
  }
}

const EDITOR_ROUTE = '/app/projects/$projectId/editor';

/** The element that scrolls the page being edited: the rich text document, or the canvas itself. */
const editorScroller = (canvas: HTMLElement | null): HTMLElement | null => canvas?.querySelector<HTMLElement>('.pl-document-scroll') ?? canvas;

/**
 * Following a link in the page to another page keeps the browser's Back and
 * Forward working: each page opened from a link is its own history entry, with
 * its scroll position.
 *
 * Before the linked page is pushed, the current entry is rewritten in place to
 * name the page on screen (`?page=<id>`, with its scroll position): the editor
 * may have been opened without `?page=`, or the writer may have moved on in the
 * page list since. Back then lands on an entry naming that page, which the
 * editor's `?page=` handling selects, and this restores its scroll position.
 * Scroll positions are also kept per entry as the writer scrolls, so Forward
 * returns to where the linked page was left.
 *
 * `pageId` is the page on screen; `canvas` holds it. Returns the function that
 * opens a linked page. Pushing it goes through the router's navigation blocker,
 * which saves the page being left.
 */
export function useLinkedPageHistory({
  projectId,
  pageId,
  canvas,
}: {
  projectId: string;
  pageId: string | undefined;
  canvas: () => HTMLElement | null;
}): (id: string) => Promise<void> {
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const entry = location.state.__TSR_key ?? location.href;
  const named = (location.search as { page?: string }).page;
  const saved = location.state.editorScroll;
  const positions = useRef(new Map<string, number>());
  const entryRef = useRef(entry);
  const canvasRef = useRef(canvas);
  useLayoutEffect(() => {
    entryRef.current = entry;
    canvasRef.current = canvas;
  });

  // Remember where each entry was scrolled to, as the writer scrolls.
  useEffect(() => {
    const root = canvas();
    if (!root) return;
    const onScroll = (event: Event) => {
      if (event.target === editorScroller(root)) positions.current.set(entryRef.current, (event.target as HTMLElement).scrollTop);
    };
    root.addEventListener('scroll', onScroll, true);
    return () => root.removeEventListener('scroll', onScroll, true);
  });

  // Once the page an entry names is on screen, put it back where it was left
  // (the top for an entry never scrolled).
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!pageId || pageId !== named || restored.current === entry) return;
    restored.current = entry;
    const top = positions.current.get(entry) ?? saved ?? 0;
    let frames = 0;
    let frame = 0;
    // The document renders over a few frames; reapply until it has room.
    const apply = () => {
      const scroller = editorScroller(canvasRef.current());
      if (scroller) scroller.scrollTop = top;
      if (scroller && Math.abs(scroller.scrollTop - top) > 1 && frames++ < 10) frame = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [entry, named, pageId, saved]);

  return useCallback(
    async (id: string) => {
      if (!pageId || id === pageId) return;
      const top = editorScroller(canvasRef.current())?.scrollTop ?? 0;
      // Rewrite this entry to name the page on screen, then push the linked page.
      // The rewrite stays on this page, so it needs no save.
      await navigate({
        to: EDITOR_ROUTE,
        params: { projectId },
        search: { page: pageId },
        state: (previous) => ({ ...previous, editorScroll: top }),
        replace: true,
        ignoreBlocker: true,
      });
      await navigate({ to: EDITOR_ROUTE, params: { projectId }, search: { page: id } });
    },
    [navigate, pageId, projectId],
  );
}
