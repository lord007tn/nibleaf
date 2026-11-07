import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@nibleaf/design-system/components/ui/popover';
import { Sheet, SheetContent } from '@nibleaf/design-system/components/ui/sheet';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { Settings2, X } from 'lucide-react';
import { type CSSProperties, lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../use-media-query';
import { isolate } from './bidi';
import { activeComponentTarget, componentNameKey, componentTargetsAt, type SettingsTarget, sameTarget, targetNode } from './schema';

// The form (and its icon set) loads the first time a writer opens a component's settings.
const ComponentSettingsPanel = lazy(() => import('./component-settings-panel'));

/** Shown in the gear's tooltip; the binding itself is `Alt-Enter` in extensions/component-settings.ts. */
const SHORTCUT_LABEL = 'Alt+Enter';
const GEAR_SIZE = 28;

/** The component under the pointer, from any element inside the editor. */
function componentAtElement(editor: Editor, element: Element | null): SettingsTarget | null {
  const host = element?.closest<HTMLElement>('[data-mdx], [data-callout]');
  if (!host || !editor.view.dom.contains(host)) return null;
  let pos: number;
  try {
    pos = editor.view.posAtDOM(host, 0);
  } catch {
    return null;
  }
  const candidates = componentTargetsAt(editor.state, pos);
  // Prefer the innermost component whose DOM holds the hovered element.
  return (
    candidates.find((candidate) => {
      const dom = editor.view.nodeDOM(candidate.pos);
      return dom instanceof Node && (dom === host || dom.contains(host));
    }) ??
    candidates[0] ??
    null
  );
}

/** Where the gear sits: the block's top end corner, or just above an inline component. */
function gearPosition(editor: Editor, target: SettingsTarget, layer: HTMLElement, rtl: boolean): CSSProperties | null {
  const dom = editor.view.nodeDOM(target.pos);
  const parent = layer.offsetParent ?? layer.parentElement;
  if (!(dom instanceof HTMLElement) || !parent) return null;
  const box = dom.getBoundingClientRect();
  const frame = parent.getBoundingClientRect();
  const inline = targetNode(editor.state, target)?.isInline ?? false;
  const top = inline ? box.top - frame.top - GEAR_SIZE - 2 : box.top - frame.top + 4;
  const left = rtl ? box.left - frame.left + (inline ? 0 : 4) : box.right - frame.left - GEAR_SIZE - (inline ? 0 : 4);
  return { top: Math.max(0, top), left: Math.max(0, left) };
}

/**
 * Component settings, attached to the editor. A gear button follows the
 * component under the pointer, or the one holding the caret (on touch screens it
 * is always shown for the component being edited). It opens the component's
 * settings in a popover — a bottom sheet on narrow screens. Alt+Enter opens the
 * same panel from the keyboard; Escape closes it and returns to the text.
 */
export function ComponentSettingsLayer({ editor, dir }: { editor: Editor; dir: 'ltr' | 'rtl' }) {
  const t = useT();
  const layer = useRef<HTMLDivElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const narrow = useMediaQuery('(max-width: 640px)');
  const [hovered, setHovered] = useState<SettingsTarget | null>(null);
  const [open, setOpen] = useState<SettingsTarget | null>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => (current.isEditable ? activeComponentTarget(current.state) : null),
    equalityFn: sameTarget,
  });
  const target = open ?? hovered ?? active;

  // Keep the open panel on its component while the document changes around it.
  useEffect(() => {
    const follow = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map: (pos: number) => number } } }) => {
      if (!transaction.docChanged) return;
      const map = (current: SettingsTarget | null) => {
        if (!current) return current;
        const moved = { ...current, pos: transaction.mapping.map(current.pos) };
        return targetNode(editor.state, moved) ? moved : null;
      };
      setOpen(map);
      setHovered(map);
    };
    editor.on('transaction', follow);
    return () => {
      editor.off('transaction', follow);
    };
  }, [editor]);

  // Pointer tracking: the gear follows the hovered component.
  useEffect(() => {
    const dom = editor.view.dom;
    let frame = 0;
    const onMove = (event: MouseEvent) => {
      cancelAnimationFrame(frame);
      const element = event.target instanceof Element ? event.target : null;
      frame = requestAnimationFrame(() => {
        const next = componentAtElement(editor, element);
        setHovered((current) => (sameTarget(current, next) ? current : next));
      });
    };
    const onLeave = (event: MouseEvent) => {
      if (gear.current && event.relatedTarget instanceof Node && gear.current.contains(event.relatedTarget)) return;
      cancelAnimationFrame(frame);
      setHovered(null);
    };
    dom.addEventListener('mouseover', onMove);
    dom.addEventListener('mouseleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      dom.removeEventListener('mouseover', onMove);
      dom.removeEventListener('mouseleave', onLeave);
    };
  }, [editor]);

  // The keyboard shortcut (extensions/component-settings.ts) opens through here.
  useEffect(() => {
    editor.storage.componentSettings.open = (next) => setOpen(next);
    return () => {
      editor.storage.componentSettings.open = null;
    };
  }, [editor]);

  const place = useCallback(() => {
    const next = target && layer.current ? gearPosition(editor, target, layer.current, dir === 'rtl') : null;
    // Only a real move re-renders (this runs after every render and transaction).
    setPosition((current) => (current?.top === next?.top && current?.left === next?.left && Boolean(current) === Boolean(next) ? current : next));
  }, [dir, editor, target]);
  useLayoutEffect(place, [place]);
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    editor.on('transaction', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      editor.off('transaction', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [editor, place]);

  const nameKey = target ? componentNameKey(target.tag) : undefined;
  const component = target ? (nameKey ? t(nameKey) : target.tag) : '';
  const close = () => setOpen(null);
  // Closing returns to the text, where the caret still is.
  const backToText = () => {
    queueMicrotask(() => {
      if (!editor.isDestroyed) editor.commands.focus();
    });
    return false;
  };
  const panel = open ? (
    <Suspense fallback={<div className="h-24" />}>
      <ComponentSettingsPanel editor={editor} target={open} titleId={titleId} onNavigate={setOpen} />
    </Suspense>
  ) : null;
  const gearButtonProps = {
    type: 'button' as const,
    'aria-label': t('editor.componentSettings.buttonLabel', { component }),
    'aria-keyshortcuts': 'Alt+Enter',
    title: t('editor.componentSettings.buttonTitle', { component, shortcut: isolate(SHORTCUT_LABEL) }),
    'data-component-settings-trigger': '',
    className: cn(
      'pl-component-settings-trigger pointer-events-auto absolute grid size-7 cursor-pointer place-items-center rounded-md border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
      open && 'text-foreground',
    ),
    style: position ?? undefined,
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onMouseLeave: (event: React.MouseEvent) => {
      if (!(event.relatedTarget instanceof Node && editor.view.dom.contains(event.relatedTarget))) setHovered(null);
    },
  };
  const visible = Boolean(target && position);
  return (
    <div ref={layer} className="pl-component-settings-layer pointer-events-none absolute inset-0" data-dir={dir}>
      {narrow ? (
        <>
          {visible && target ? (
            <button {...gearButtonProps} ref={gear} aria-haspopup="dialog" onClick={() => setOpen(target)}>
              <Settings2 className="size-4" aria-hidden />
            </button>
          ) : null}
          <Sheet open={open !== null} onOpenChange={(next) => (next ? undefined : close())}>
            <SheetContent
              side="bottom"
              dir={dir}
              aria-labelledby={titleId}
              closeLabel={t('editor.componentSettings.close')}
              finalFocus={backToText}
              className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              {panel}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Popover open={open !== null} onOpenChange={(next) => (next ? setOpen(target) : close())} modal="trap-focus">
          {visible && target ? (
            <PopoverTrigger {...gearButtonProps} ref={gear}>
              <Settings2 className="size-4" aria-hidden />
            </PopoverTrigger>
          ) : null}
          <PopoverContent
            side="bottom"
            align="end"
            dir={dir}
            aria-labelledby={titleId}
            finalFocus={backToText}
            className="relative max-h-[min(36rem,var(--available-height))] w-80 overflow-y-auto"
          >
            <PopoverClose
              aria-label={t('editor.componentSettings.close')}
              className="absolute end-2 top-2 grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-4" aria-hidden />
            </PopoverClose>
            {panel}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
