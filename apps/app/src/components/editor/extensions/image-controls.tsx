import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { type KeyboardEvent, useEffect, useId, useRef } from 'react';
import { imagePromptKey } from './block-image';

export function addImageCaption(editor: Editor): number | null {
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
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      alt: String(current.getAttributes('image').alt ?? ''),
      width: current.getAttributes('image').width as number | '100%' | null,
      prompt: imagePromptKey.getState(current.state) ?? 0,
    }),
  });
  useEffect(() => {
    if (!state.prompt) return;
    // BubbleMenu mounts its portal in the same commit; focus after it is visible.
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [state.prompt]);
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
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="image-description"
      updateDelay={0}
      options={{ placement: 'bottom' }}
      shouldShow={() => editor.isEditable && editor.isActive('image')}
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
            onChange={(event) => editor.commands.updateAttributes('image', { alt: event.target.value })}
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
              editor.commands.updateAttributes('image', {
                width: event.target.value === '100%' ? '100%' : event.target.value ? Number(event.target.value) : null,
                height: null,
              })
            }
          >
            {typeof state.width === 'number' && ![240, 480, 720].includes(state.width) ? (
              <option value={state.width}>{t('editor.image.customSize', { width: state.width })}</option>
            ) : null}
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
            const pos = addImageCaption(editor);
            if (pos !== null)
              requestAnimationFrame(() => {
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
