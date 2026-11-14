import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { isLocatablePublishCheck, type PublishCheckCode } from '@nibleaf/shared/publish-check-codes';
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { editorIn, prefersReducedMotion } from './editor-sections';
import { setFixHighlight } from './extensions/fix-highlight';
import { requestLinkField } from './extensions/selection-shortcuts';
import { FIX_EXPLANATIONS, FIX_LABELS, type FixMatch, findFixMatches, pageLevelFixTarget } from './publish-fix';

/** A publish check's Fix the editor arrived with (`?fix=<code>&fixTarget=<evidence>`). */
export interface PublishFixArrival {
  code: PublishCheckCode;
  /** The evidence as written in the page; null for a page-level check or a shortened one. */
  target: string | null;
  /** The page (or group) the check is about. */
  pageId: string;
}

/** How long (in frames) arrival waits for the page's content to reach the editor. */
const ARRIVAL_WAIT_FRAMES = 120;

type BarState =
  /** Looking for the page's content: nothing is announced yet. */
  | { phase: 'pending' }
  /** On match `index` of `total`. */
  | { phase: 'found'; index: number; total: number }
  /** The evidence isn't on the page (any more): most likely already fixed. */
  | { phase: 'notFound' }
  /** A page-level check, or one whose evidence couldn't be sent: the bar explains. */
  | { phase: 'page' };

/** Select match `index`, mark every match, scroll it into view and focus the editor. Selection and decorations only. */
function goToMatch(editor: Editor, matches: FixMatch[], index: number, openLink: boolean): void {
  const match = matches[index];
  if (!match) return;
  const { view } = editor;
  const { doc } = view.state;
  const node = match.node ? doc.nodeAt(match.from) : null;
  const selection =
    node && NodeSelection.isSelectable(node)
      ? NodeSelection.create(doc, match.from)
      : TextSelection.between(doc.resolve(match.from), doc.resolve(match.to));
  view.focus();
  let tr = setFixHighlight(view.state.tr.setSelection(selection), matches, index);
  // A link opens the link field, ready to pick the page it should lead to.
  if (openLink && !match.node && editor.isEditable) tr = requestLinkField(tr);
  view.dispatch(tr);
  const at = match.node ? view.nodeDOM(match.from) : view.domAtPos(match.from).node;
  const element = at instanceof Element ? at : at?.parentElement;
  element?.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  // A component's link (a Card's `href`) is edited in its own address field.
  const address = openLink && match.node && editor.isEditable ? element?.querySelector<HTMLInputElement>('input[data-attribute="href"]') : null;
  if (address) {
    address.focus({ preventScroll: true });
    address.select();
  }
}

const clearHighlight = (editor: Editor | null) => {
  if (editor && !editor.isDestroyed) editor.view.dispatch(setFixHighlight(editor.state.tr, [], -1));
};

/**
 * The bar above the canvas after a publish check's Fix (P1-ED-002): it names
 * the problem and its evidence, counts the places it was found ("1 of 3"),
 * moves between them (Next), and leads back to the publish sheet.
 *
 * On arrival a problem found by its evidence is selected, marked and scrolled
 * to (a link also opens its link field); a page-level one focuses its field:
 * the title, the body, or the address in Page settings. Nothing found is said
 * plainly, never as an error. Arriving changes no content and saves nothing:
 * selection, focus and decorations only. `onHandled` runs once arrival is
 * done, so the route can drop the Fix from its address.
 *
 * Keyboard: the bar comes before the canvas in the tab order; Escape closes
 * it. Its text is announced politely as it changes.
 */
export function PublishFixBar({
  arrival,
  group,
  canvas,
  onFocusTitle,
  onOpenSettings,
  onHandled,
  onBackToPublish,
  onDismiss,
}: {
  arrival: PublishFixArrival;
  /** The check is about a group (no title field or body in the canvas). */
  group: boolean;
  /** The element holding the page's editor. */
  canvas: () => HTMLElement | null;
  onFocusTitle: () => void;
  /** Open Page settings with `field` focused. */
  onOpenSettings: (field: 'title' | 'slug') => void;
  onHandled: () => void;
  onBackToPublish: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const { code, target } = arrival;
  const [state, setState] = useState<BarState>({ phase: 'pending' });
  const barRef = useRef<HTMLElement>(null);
  const indexRef = useRef(0);
  // The latest callbacks, so arrival runs once per bar, whatever the route re-renders.
  const callbacks = useRef({ canvas, onFocusTitle, onOpenSettings, onHandled, onDismiss });
  useEffect(() => {
    callbacks.current = { canvas, onFocusTitle, onOpenSettings, onHandled, onDismiss };
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: arrival runs once, when the bar mounts for its page.
  useEffect(() => {
    const { onHandled: handled } = callbacks.current;
    let frame = 0;
    let frames = 0;
    const whenEditor = (then: (editor: Editor | null) => void) => {
      const look = () => {
        const editor = editorIn(callbacks.current.canvas());
        if (editor || frames++ >= ARRIVAL_WAIT_FRAMES) then(editor);
        else frame = requestAnimationFrame(look);
      };
      look();
    };
    if (isLocatablePublishCheck(code) && target) {
      whenEditor((editor) => {
        const matches = editor ? findFixMatches(editor.state.doc, code, target) : [];
        if (editor && matches.length > 0) {
          indexRef.current = 0;
          goToMatch(editor, matches, 0, code === 'broken-internal-link');
          setState({ phase: 'found', index: 0, total: matches.length });
        } else setState({ phase: 'notFound' });
        handled();
      });
      return () => cancelAnimationFrame(frame);
    }
    setState({ phase: 'page' });
    const field = pageLevelFixTarget(code);
    if (field === 'title') {
      if (group) callbacks.current.onOpenSettings('title');
      else callbacks.current.onFocusTitle();
    } else if (field === 'address') callbacks.current.onOpenSettings('slug');
    else if (field === 'body' && !group) {
      whenEditor((editor) => {
        editor?.commands.focus('start');
        handled();
      });
      return () => cancelAnimationFrame(frame);
    }
    handled();
    return () => cancelAnimationFrame(frame);
  }, []);

  const next = useCallback(() => {
    if (!target) return;
    const editor = editorIn(canvas());
    const matches = editor ? findFixMatches(editor.state.doc, code, target) : [];
    if (!editor || matches.length === 0) {
      clearHighlight(editor);
      setState({ phase: 'notFound' });
      return;
    }
    const index = (indexRef.current + 1) % matches.length;
    indexRef.current = index;
    goToMatch(editor, matches, index, false);
    setState({ phase: 'found', index, total: matches.length });
  }, [canvas, code, target]);

  const dismiss = useCallback(() => {
    const editor = editorIn(callbacks.current.canvas());
    clearHighlight(editor);
    // Closing from the bar returns to the page, not to the top of the document.
    if (barRef.current?.contains(document.activeElement)) editor?.view.focus();
    callbacks.current.onDismiss();
  }, []);

  // Escape closes the bar, unless it belongs to something open over the page (a menu, the link field, a dialog).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest('[role="dialog"], [role="menu"], [role="listbox"], [data-editor-bubble-menu]')) return;
      dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismiss]);

  const explanation = FIX_EXPLANATIONS[code];
  const evidence = state.phase === 'pending' ? null : target;
  return (
    <section
      ref={barRef}
      aria-label={t('editor.fix.region')}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-amber-500/35 border-b bg-amber-500/10 px-4 py-2 text-sm"
      data-publish-fix={code}
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0 text-amber-700 dark:text-amber-300" />
      {/* Filled once arrival is done, so the change is announced. */}
      <p aria-atomic="true" aria-live="polite" className="min-w-0 flex-1 text-foreground leading-snug" data-testid="publish-fix-status">
        {state.phase === 'pending' ? null : (
          <>
            <span className="font-medium">{t(FIX_LABELS[code])}</span>
            {evidence ? (
              <>
                {' '}
                <bdi className="break-all rounded bg-background/70 px-1 py-0.5 font-mono text-[12.5px]" dir="ltr">
                  {evidence}
                </bdi>
              </>
            ) : null}
            {state.phase === 'found' ? <span> · {t('editor.fix.count', { current: state.index + 1, total: state.total })}</span> : null}
            {state.phase === 'notFound' ? <span className="text-muted-foreground"> · {t('editor.fix.notFound')}</span> : null}
            {state.phase === 'page' ? (
              <span className="text-muted-foreground"> · {explanation ? t(explanation) : t('editor.fix.findOnPage')}</span>
            ) : null}
          </>
        )}
      </p>
      <div className="flex shrink-0 items-center gap-1">
        {state.phase === 'found' ? (
          <Button className="cursor-pointer" onClick={next} size="sm" variant="outline">
            {t('editor.fix.next')}
          </Button>
        ) : null}
        <Button className="cursor-pointer" onClick={onBackToPublish} size="sm" variant="ghost">
          {t('editor.fix.back')}
        </Button>
        <Button
          aria-label={t('editor.fix.dismiss')}
          className="cursor-pointer"
          onClick={dismiss}
          size="icon-sm"
          title={t('editor.fix.dismiss')}
          variant="ghost"
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>
    </section>
  );
}
