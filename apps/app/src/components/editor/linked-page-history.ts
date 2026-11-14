import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { editorIn, landOnSection, prefersReducedMotion, sectionFragment } from './editor-sections';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The page editor's scroll position when this history entry was left for a linked page. */
    editorScroll?: number;
    /** This entry only rewrote the address of the page on screen (a publish check's Fix
     *  dropping its parameters): the page stays where the writer is. */
    editorKeepScroll?: boolean;
  }
}

const EDITOR_ROUTE = '/app/projects/$projectId/editor';
/** How long (in frames) a section link waits for its page's content to reach the editor. */
const SECTION_WAIT_FRAMES = 60;

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
 * A link to a section (`page#install`) carries it in the entry's hash
 * (`?page=<id>#install`). An entry with a section and no scroll position yet
 * (just followed, or opened in a new tab) goes to that heading once the page's
 * content is in the editor (`jumpToSection`); no such heading leaves it at the
 * top. A section of the page on screen (`#install`) is its own entry too, as on
 * the published site, so Back returns to where the page was.
 *
 * `pageId` is the page on screen; `canvas` holds it. Returns how to open a
 * linked page, here (`open`) or in a new tab (`href`, its address). Opening
 * another page goes through the router's navigation blocker, which saves the
 * page being left.
 */
export function useLinkedPageHistory({
  projectId,
  pageId,
  canvas,
}: {
  projectId: string;
  pageId: string | undefined;
  canvas: () => HTMLElement | null;
}): LinkedPages {
  const navigate = useNavigate();
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const entry = location.state.__TSR_key ?? location.href;
  const named = (location.search as { page?: string }).page;
  const saved = location.state.editorScroll;
  const keep = location.state.editorKeepScroll === true;
  const section = sectionFragment(location.hash);
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

  // One landing on a section at a time; the writer's first move ends it (`landOnSection`).
  const endLanding = useRef<(() => void) | null>(null);
  const startLanding = useCallback((target: string) => {
    endLanding.current?.();
    const end = landOnSection({
      find: () => editorIn(canvasRef.current()),
      section: target,
      smooth: !prefersReducedMotion(),
      waitFrames: SECTION_WAIT_FRAMES,
    });
    endLanding.current = end;
    return end;
  }, []);

  // Once the page an entry names is on screen, put it back where it was left
  // (the top for an entry never scrolled), or go to the section it names.
  const restored = useRef<string | null>(null);
  // The page the last restored entry showed: an in-page section keeps the scroll it starts from.
  const shown = useRef<string | undefined>(undefined);
  // Entries already kept in place: `editorKeepScroll` holds for the rewrite itself, never for a later
  // visit (Back or Forward to that entry restores it like any other).
  const kept = useRef(new Set<string>());
  useEffect(() => {
    if (!pageId || pageId !== named || restored.current === entry) return;
    restored.current = entry;
    const samePage = shown.current === pageId;
    shown.current = pageId;
    if (keep && samePage && !kept.current.has(entry)) {
      kept.current.add(entry);
      return;
    }
    const left = positions.current.get(entry) ?? saved;
    let frames = 0;
    let frame = 0;
    if (left === undefined && section) {
      const scroller = editorScroller(canvasRef.current());
      if (scroller && !samePage) scroller.scrollTop = 0;
      // The page's content reaches the editor over a few frames; then the section is looked up once.
      return startLanding(section);
    }
    const top = left ?? 0;
    // The document renders over a few frames; reapply until it has room.
    const apply = () => {
      const scroller = editorScroller(canvasRef.current());
      if (scroller) scroller.scrollTop = top;
      if (scroller && Math.abs(scroller.scrollTop - top) > 1 && frames++ < 10) frame = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [entry, keep, named, pageId, saved, section, startLanding]);

  const open = useCallback(
    async (id: string, target?: string) => {
      const samePage = id === pageId;
      if (!pageId || (samePage && !target)) return;
      // The section this entry already names: go to it again, as a second click on such a link does on the site.
      if (samePage && target === section && named === pageId) {
        startLanding(target);
        return;
      }
      const top = editorScroller(canvasRef.current())?.scrollTop ?? 0;
      // Rewrite this entry to name the page on screen, then push the linked page.
      // The rewrite stays on this page, so it needs no save; nor does a section of this page.
      await navigate({
        to: EDITOR_ROUTE,
        params: { projectId },
        search: { page: pageId },
        hash: true,
        // The entry is left now: Back restores it, so a Fix's keep-in-place no longer applies.
        state: (previous) => ({ ...previous, editorKeepScroll: undefined, editorScroll: top }),
        replace: true,
        ignoreBlocker: true,
        hashScrollIntoView: false,
      });
      await navigate({
        to: EDITOR_ROUTE,
        params: { projectId },
        search: { page: id },
        hash: target || undefined,
        ignoreBlocker: samePage,
        hashScrollIntoView: false,
      });
    },
    [navigate, named, pageId, projectId, section, startLanding],
  );
  const href = useCallback(
    (id: string, target?: string) =>
      router.buildLocation({ to: EDITOR_ROUTE, params: { projectId }, search: { page: id }, hash: target || undefined }).href,
    [router, projectId],
  );
  return useMemo(() => ({ open, href }), [open, href]);
}

/** Opening a page that a link in the page leads to. */
export interface LinkedPages {
  /** Open page `id` here, in its own history entry, at `section` when given (the page on screen just goes there). */
  open: (id: string, section?: string) => Promise<void>;
  /** Page `id`'s editor address, at `section` when given, for a new tab. */
  href: (id: string, section?: string) => string;
}
