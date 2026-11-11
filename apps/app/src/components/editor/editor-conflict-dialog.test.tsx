/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { EditorConflictDialog } from './editor-conflict-dialog';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));

it('keeps the unsaved draft visible until the writer explicitly accepts a merged version', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const resolve = vi.fn();
  const close = vi.fn();
  const draft = { title: 'My title', content: '[link](/old)\nMy unsaved text' };
  try {
    await act(async () =>
      root.render(
        <EditorConflictDialog
          server={{ id: 'page', title: 'Saved title', content: '[link](/new)', updatedAt: '2026-11-11T00:00:00Z' }}
          draft={draft}
          onResolve={resolve}
          onClose={close}
        />,
      ),
    );
    const local = document.querySelector<HTMLTextAreaElement>('#conflict-draft');
    expect(local?.value).toBe(draft.content);
    expect(document.querySelector<HTMLTextAreaElement>('#conflict-server')?.value).toBe('[link](/new)');
    expect(resolve).not.toHaveBeenCalled();
    if (!local) throw new Error('Local draft was not rendered');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(local, '[link](/new)\nMy unsaved text');
      local.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const resume = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('editor.conflict.resolve'));
    const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('common.cancel'));
    await act(async () => cancel?.click());
    expect(close).toHaveBeenCalledWith({ title: 'My title', content: '[link](/new)\nMy unsaved text' });
    await act(async () => resume?.click());
    expect(resolve).toHaveBeenCalledWith({ title: 'My title', content: '[link](/new)\nMy unsaved text' });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
