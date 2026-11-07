// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

type DraftOptions = { onSuccess?: (result: { text: string }) => void; onError?: unknown; onSettled?: () => void };
const state = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, toastError: vi.fn() }));
vi.mock('@/hooks/api', () => ({ useAiDraft: () => ({ mutate: state.mutate, isPending: state.isPending }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), message: vi.fn(), error: state.toastError } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));

import { AiAssist } from './ai-assist';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  state.isPending = false;
  vi.clearAllMocks();
});

const mount = async () => {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const render = () => act(async () => root.render(<AiAssist content="# Page" onContentChange={vi.fn()} projectId="project" />));
  await render();
  return render;
};
const button = (label: string) => [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(label));

describe('AI assist', () => {
  it('shows the work on the clicked button, keeps the others in place, and leaves failures to the hook', async () => {
    const render = await mount();
    await act(async () => button('editor.ai.rephrase')?.click());
    const [body, options] = state.mutate.mock.calls[0] as [unknown, DraftOptions];
    expect(body).toEqual({ mode: 'rephrase', content: '# Page' });
    // useAiDraft's meta.errorMessage reports a failure once; the card adds no toast of its own.
    expect(options.onError).toBeUndefined();

    state.isPending = true;
    await render();
    const working = button('editor.ai.rephrasing');
    expect(working?.getAttribute('aria-busy')).toBe('true');
    // Every action is still there (nothing jumps), and none can start meanwhile.
    for (const label of ['editor.ai.continue', 'editor.ai.outline', 'editor.ai.summarize', 'editor.ai.generate']) {
      expect(button(label)?.disabled).toBe(true);
      expect(button(label)?.getAttribute('aria-busy')).toBeNull();
    }

    state.isPending = false;
    await act(async () => options.onSettled?.());
    await render();
    expect(button('editor.ai.rephrase')?.getAttribute('aria-busy')).toBeNull();
    expect(state.toastError).not.toHaveBeenCalled();
  });

  it('marks Generate, not Continue writing, as working on the person’s own instruction', async () => {
    const render = await mount();
    const field = document.querySelector('textarea');
    if (!field) throw new Error('instruction field');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, 'Add a FAQ');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('editor.ai.generate')?.click());
    expect(state.mutate.mock.calls[0]?.[0]).toEqual({ mode: 'continue', content: '# Page', instruction: 'Add a FAQ' });

    state.isPending = true;
    await render();
    expect(button('editor.ai.generate')?.getAttribute('aria-busy')).toBe('true');
    expect(button('editor.ai.continue')?.getAttribute('aria-busy')).toBeNull();
  });
});
