import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { type KeyboardEvent, useCallback, useEffect, useId, useRef } from 'react';
import { imagePromptKey } from './block-image';
import { canEditImages } from './image-upload';

export function addImageCaption(editor: Editor): number | null {
  if (!canEditImages(editor)) return null;
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return null;
  for (let depth = selection.$from.depth; depth > 0; depth--) {
    if (selection.$from.node(depth).type.name === 'mdxFrame') return selection.$from.before(depth);
  }
  const frame = editor.schema.nodes.mdxFrame;
  if (!frame) return null;
  editor.view.dispatch(editor.state.tr.replaceWith(selection.from, selection.to, frame.create({ caption: '' }, selection.node)));
  return selection.from;
}

export function ImageControls({ editor, dir }: { editor: Editor; dir: 'ltr' | 'rtl' }) {
  const t = useT();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const dismissed = useRef(false);
  const previousImage = useRef<{ key: string; node: NodeSelection['node'] | null }>({ key: '', node: null });
  const hide = useCallback(() => {
    if (editor.isDestroyed || dismissed.current) return;
    dismissed.current = true;
    editor.commands.setMeta('image-description', 'hide');
  }, [editor]);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      alt: String(current.getAttributes('image').alt ?? ''),
      width: current.getAttributes('image').width as number | string | null,
      prompt: imagePromptKey.getState(current.state) ?? 0,
      canEdit: canEditImages(current),
      image: current.state.selection instanceof NodeSelection ? current.state.selection.node : null,
      selected:
        current.state.selection instanceof NodeSelection && current.state.selection.node.type.name === 'image'
          ? `${current.state.selection.from}:${current.state.selection.node.attrs.src}`
          : '',
    }),
  });
  useEffect(() => {
    if (
      state.selected &&
      state.selected !== previousImage.current.key &&
      state.image !== previousImage.current.node &&
      !document.activeElement?.classList.contains('pl-frame-title-input')
    ) {
      dismissed.current = false;
      if (!editor.isDestroyed) editor.commands.setMeta('image-description', 'show');
    }
    previousImage.current = { key: state.selected, node: state.image };
  }, [editor, state.selected, state.image]);
  useEffect(() => {
    const onOutside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node) || menu.current?.contains(target) || editor.isDestroyed) return;
      if (target === editor.view.dom || (target instanceof Element && editor.view.dom.contains(target) && target.closest('.editor-image'))) {
        const selectedImage = editor.isActive('image') ? editor.view.nodeDOM(editor.state.selection.from) : null;
        const reopen = dismissed.current && editor.isEditable && (target === editor.view.dom || selectedImage?.contains(target));
        dismissed.current = false;
        if (reopen && selectedImage) editor.commands.setMeta('image-description', 'show');
        return;
      }
      hide();
    };
    document.addEventListener('focusin', onOutside, true);
    document.addEventListener('pointerdown', onOutside, true);
    return () => {
      document.removeEventListener('focusin', onOutside, true);
      document.removeEventListener('pointerdown', onOutside, true);
    };
  }, [editor, hide]);
  useEffect(() => {
    if (!state.prompt || !canEditImages(editor) || !editor.isActive('image')) return;
    dismissed.current = false;
    editor.commands.setMeta('image-description', 'show');
    // BubbleMenu mounts its portal in the same commit; focus after it is visible.
    const frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed && !dismissed.current && editor.isActive('image')) input.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, state.prompt]);
  const dismiss = () => {
    const { selection, doc } = editor.state;
    if (selection instanceof NodeSelection) {
      const next = TextSelection.near(doc.resolve(selection.to));
      if (next instanceof TextSelection) editor.view.dispatch(editor.state.tr.setSelection(next));
      else editor.commands.createParagraphNear();
    }
    editor.commands.focus();
  };
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    dismiss();
  };
  if (!state.canEdit) return null;
  return (
    <BubbleMenu
      data-editor-bubble-menu=""
      ref={menu}
      editor={editor}
      pluginKey="image-description"
      updateDelay={0}
      options={{ placement: 'bottom' }}
      shouldShow={() =>
        canEditImages(editor) && editor.isActive('image') && !dismissed.current && !document.activeElement?.classList.contains('pl-frame-title-input')
      }
    >
      <div
        role="dialog"
        aria-label={t('editor.image.description')}
        tabIndex={-1}
        dir={dir}
        className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm shadow-lg"
      >
        <label className="flex flex-col gap-1">
          {t('editor.image.description')}
          <input
            ref={input}
            onKeyDown={onEscape}
            aria-describedby={hintId}
            className="min-h-11 rounded border border-border bg-background p-2 focus-visible:outline-2 focus-visible:outline-ring"
            dir="auto"
            value={state.alt}
            onChange={(event) => {
              if (canEditImages(editor)) editor.commands.updateAttributes('image', { alt: event.target.value });
            }}
          />
        </label>
        <p id={hintId} className="text-muted-foreground text-xs">
          {t('editor.image.descriptionHint')}
        </p>
        <label className="flex items-center justify-between gap-2">
          {t('editor.image.size')}
          <select
            onKeyDown={onEscape}
            aria-label={t('editor.image.size')}
            className="min-h-11 rounded border border-border bg-background px-2 focus-visible:outline-2 focus-visible:outline-ring"
            value={state.width ?? ''}
            onChange={(event) =>
              canEditImages(editor) &&
              editor.commands.updateAttributes('image', {
                width: event.target.value.endsWith('%') ? event.target.value : event.target.value ? Number(event.target.value) : null,
                height: null,
              })
            }
          >
            {typeof state.width === 'number' && ![240, 480, 720].includes(state.width) ? (
              <option value={state.width}>{t('editor.image.customSize', { width: state.width })}</option>
            ) : null}
            {typeof state.width === 'string' && state.width !== '100%' ? <option value={state.width}>{state.width}</option> : null}
            <option value="">{t('editor.image.originalSize')}</option>
            <option value="240">{t('editor.image.small')}</option>
            <option value="480">{t('editor.image.medium')}</option>
            <option value="720">{t('editor.image.large')}</option>
            <option value="100%">{t('editor.image.fullWidth')}</option>
          </select>
        </label>
        <Button
          onKeyDown={onEscape}
          variant="outline"
          className="min-h-11"
          onClick={() => {
            hide();
            const pos = addImageCaption(editor);
            if (pos !== null)
              requestAnimationFrame(() => {
                if (editor.isDestroyed) return;
                const dom = editor.view.nodeDOM(pos);
                if (dom instanceof HTMLElement) dom.querySelector<HTMLInputElement>('.pl-frame-title-input')?.focus();
              });
          }}
        >
          {t('editor.image.addCaption')}
        </Button>
      </div>
    </BubbleMenu>
  );
}
