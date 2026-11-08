// @vitest-environment jsdom
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';

const state = vi.hoisted(() => ({ draft: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn(), toastMessage: vi.fn() }));
vi.mock('@/services/api', () => ({ api: { app: { projects: { ':projectId': { ai: { $post: state.draft } } } } } }));
vi.mock('sonner', () => ({ toast: { success: state.toastSuccess, message: state.toastMessage, error: state.toastError } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));

import { AiAssist } from './ai-assist';
import { aiAssistPageId, useAiAssistSession } from './use-ai-assist-session';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
let queryClient: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  queryClient?.clear();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const mount = async () => {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  queryClient = createQueryClient();
  let shown = true;
  let editorShown = true;
  let pageId: string | null = 'a';
  const changes = vi.fn();
  const openPage = vi.fn();
  function Editor() {
    const [content, setContent] = useState('# Page');
    const session = useAiAssistSession({
      projectId: 'project',
      pageId,
      pageTitle: `Page ${pageId?.toUpperCase() ?? ''}`,
      content,
      onContentChange: (next) => {
        changes(pageId, next);
        setContent(next);
      },
      openPage,
    });
    return (
      <>
        <input aria-label="content" value={content} onChange={(event) => setContent(event.target.value)} />
        {shown ? <AiAssist session={session} /> : null}
      </>
    );
  }
  const render = () =>
    act(async () => root.render(<QueryClientProvider client={queryClient}>{editorShown ? <Editor /> : <p>Settings</p>}</QueryClientProvider>));
  await render();
  return {
    changes,
    openPage,
    show: async (value: boolean) => {
      shown = value;
      await render();
    },
    /** Leave the editor route entirely (e.g. open project settings), or come back. */
    editor: async (value: boolean) => {
      editorShown = value;
      await render();
    },
    page: async (id: string | null, content: string) => {
      pageId = id;
      await render();
      await edit('input', content);
    },
  };
};
const button = (label: string) => [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(label));
const click = (label: string) =>
  act(async () => {
    const target = button(label);
    if (!target) throw new Error(`Missing button: ${label}`);
    target.click();
  });
const edit = (selector: 'input' | 'textarea', value: string) =>
  act(async () => {
    const field = document.querySelector(selector);
    if (!field) throw new Error(`Missing ${selector}`);
    const prototype = selector === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
const deferDraft = () => {
  let answer!: (response: Response) => void;
  state.draft.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      answer = resolve;
    }),
  );
  return (text: string, status = 200) =>
    act(async () => {
      answer(
        new Response(JSON.stringify(status === 200 ? { data: { text } } : { error: { message: 'Internal error' } }), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
};

describe('AI assist session', () => {
  it('retains the clicked button loading state after the card remounts', async () => {
    const finish = deferDraft();
    const editor = await mount();
    await click('editor.ai.rephrase');
    expect(state.draft.mock.calls[0]?.[0]).toEqual({ param: { projectId: 'project' }, json: { mode: 'rephrase', content: '# Page' } });
    await editor.show(false);
    await editor.show(true);
    expect(button('editor.ai.rephrasing')?.getAttribute('aria-busy')).toBe('true');
    for (const label of ['editor.ai.continue', 'editor.ai.outline', 'editor.ai.summarize', 'editor.ai.generate']) {
      expect(button(label)?.disabled).toBe(true);
      expect(button(label)?.getAttribute('aria-busy')).toBeNull();
    }
    await finish('Rephrased');
  });

  it('shows a rephrase that finished while the AI card was unmounted', async () => {
    const finish = deferDraft();
    const editor = await mount();
    await click('editor.ai.rephrase');
    await editor.show(false);
    await finish('A clearer page');
    expect(editor.changes).not.toHaveBeenCalled();
    await editor.show(true);
    expect(document.body.textContent).toContain('A clearer page');
    expect(button('editor.ai.rephrase')?.getAttribute('aria-busy')).toBeNull();
    await click('editor.ai.replace');
    expect(editor.changes).toHaveBeenLastCalledWith('a', 'A clearer page');
    expect(button('editor.ai.replace')).toBeUndefined();
  });

  it.each(['continue', 'outline'])('appends %s to the latest content while the card is unmounted', async (mode) => {
    const finish = deferDraft();
    const editor = await mount();
    await click(`editor.ai.${mode}`);
    await editor.show(false);
    await edit('input', '# Page with new writing');
    await finish('An AI addition');
    expect(editor.changes).toHaveBeenCalledExactlyOnceWith('a', '# Page with new writing\n\nAn AI addition');
    expect(state.toastSuccess).toHaveBeenCalledExactlyOnceWith(mode === 'outline' ? 'editor.ai.outlineAdded' : 'editor.ai.sectionDrafted');
    await editor.show(true);
    expect(button('editor.ai.insert')).toBeUndefined();
  });

  it.each(['continue', 'outline', 'rephrase', 'summarize'])('keeps a %s draft for page A without writing into page B', async (mode) => {
    const finish = deferDraft();
    const editor = await mount();
    await click(`editor.ai.${mode}`);
    await editor.show(false);
    await editor.page('b', '# Other page');
    await finish('Draft for A');
    expect(editor.changes).not.toHaveBeenCalled();
    expect(state.toastSuccess).not.toHaveBeenCalled();
    await editor.show(true);
    expect(document.body.textContent).not.toContain('Draft for A');
    await editor.page('a', '# Page A edited');
    expect(document.body.textContent).toContain('Draft for A');
    await click('editor.ai.insert');
    expect(editor.changes).toHaveBeenCalledExactlyOnceWith('a', '# Page A edited\n\nDraft for A');
  });

  it('says why the actions wait on another page while a draft for page A runs', async () => {
    const finish = deferDraft();
    const editor = await mount();
    // The live region exists before its text changes, so screen readers announce it.
    const region = document.querySelector('[role="status"]');
    expect(region?.className).toContain('sr-only');
    await click('editor.ai.rephrase');
    expect(region?.textContent).toBe('');
    await editor.page('b', '# Other page');
    expect(document.querySelector('[role="status"]')).toBe(region);
    expect(region?.textContent).toBe('editor.ai.busyOtherPage');
    expect(button('editor.ai.rephrase')?.disabled).toBe(true);
    await finish('Draft for A');
    expect(region?.textContent).toBe('');
    expect(button('editor.ai.rephrase')?.disabled).toBe(false);
  });

  it('keeps previews for separate pages until the writer uses them', async () => {
    const finishA = deferDraft();
    const editor = await mount();
    await click('editor.ai.rephrase');
    await finishA('Preview A');
    await editor.page('b', '# B');
    const finishB = deferDraft();
    await click('editor.ai.summarize');
    await finishB('Preview B');
    expect(document.body.textContent).toContain('Preview B');
    await editor.page('a', '# A');
    expect(document.body.textContent).toContain('Preview A');
    expect(document.body.textContent).not.toContain('Preview B');
    await editor.page('b', '# B');
    expect(document.body.textContent).toContain('Preview B');
  });

  it('keeps an append as a preview if the target page is still loading', async () => {
    const finish = deferDraft();
    const editor = await mount();
    await click('editor.ai.continue');
    await editor.page(null, '');
    await finish('Saved draft');
    expect(editor.changes).not.toHaveBeenCalled();
    expect(button('editor.ai.continue')?.disabled).toBe(true);
    await editor.page('a', '# A');
    expect(document.body.textContent).toContain('Saved draft');
  });

  it('reports a failure once through the real mutation cache while hidden and enables retry', async () => {
    const finish = deferDraft();
    const editor = await mount();
    await click('editor.ai.rephrase');
    await editor.show(false);
    await finish('', 500);
    await vi.waitFor(() => expect(state.toastError).toHaveBeenCalledExactlyOnceWith('editor.ai.draftError'));
    await editor.show(true);
    expect(button('editor.ai.rephrase')?.disabled).toBe(false);
    expect(editor.changes).not.toHaveBeenCalled();
    expect(state.toastSuccess).not.toHaveBeenCalled();
  });

  it('keeps Generate as the running action for a custom instruction after remount', async () => {
    const finish = deferDraft();
    const editor = await mount();
    await edit('textarea', 'Add a FAQ');
    await click('editor.ai.generate');
    expect(state.draft.mock.calls[0]?.[0].json).toEqual({ mode: 'continue', content: '# Page', instruction: 'Add a FAQ' });
    await editor.show(false);
    await editor.show(true);
    expect(button('editor.ai.generate')?.getAttribute('aria-busy')).toBe('true');
    expect(button('editor.ai.continue')?.getAttribute('aria-busy')).toBeNull();
    await finish('FAQ');
  });

  it('reports an empty answer without writing or showing a preview', async () => {
    const finish = deferDraft();
    const editor = await mount();
    await click('editor.ai.continue');
    await editor.show(false);
    await finish('   ');
    expect(state.toastMessage).toHaveBeenCalledExactlyOnceWith('editor.ai.empty');
    expect(editor.changes).not.toHaveBeenCalled();
    await editor.show(true);
    expect(button('editor.ai.insert')).toBeUndefined();
  });
  it.each(['continue', 'rephrase'])('keeps a %s draft that lands after the writer left the editor, without claiming it was added', async (mode) => {
    const finish = deferDraft();
    const editor = await mount();
    await click(`editor.ai.${mode}`);
    await editor.editor(false);
    await finish('Late draft');
    expect(editor.changes).not.toHaveBeenCalled();
    expect(state.toastSuccess).not.toHaveBeenCalled();
    expect(state.toastMessage).toHaveBeenCalledExactlyOnceWith(
      'editor.ai.readyOnPage',
      expect.objectContaining({ action: expect.objectContaining({ label: 'editor.ai.openPage' }) }),
    );
    // The toast's action opens the page the draft belongs to.
    const options = state.toastMessage.mock.calls[0]?.[1] as { action: { onClick: () => void } };
    options.action.onClick();
    expect(editor.openPage).toHaveBeenCalledExactlyOnceWith('a');
    await editor.editor(true);
    expect(document.body.textContent).toContain('Late draft');
    await click('editor.ai.insert');
    expect(editor.changes).toHaveBeenCalledExactlyOnceWith('a', '# Page\n\nLate draft');
  });

  it('points to the AI panel when a suggestion for this page lands while the panel is hidden', async () => {
    const finish = deferDraft();
    const editor = await mount();
    await click('editor.ai.summarize');
    await editor.show(false);
    await finish('Short summary');
    expect(state.toastMessage).toHaveBeenCalledExactlyOnceWith('editor.ai.readyInPanel');
    await editor.show(true);
    expect(document.body.textContent).toContain('Short summary');
  });

  it('does not announce a suggestion that appears in the visible card', async () => {
    const finish = deferDraft();
    await mount();
    await click('editor.ai.rephrase');
    await finish('Shown right here');
    expect(state.toastMessage).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Shown right here');
  });

  it('offers the other page when a draft for page A lands on page B', async () => {
    const finish = deferDraft();
    const editor = await mount();
    await click('editor.ai.rephrase');
    await editor.page('b', '# B');
    await finish('For A');
    expect(state.toastMessage).toHaveBeenCalledExactlyOnceWith('editor.ai.readyOnPage', expect.anything());
  });

  it('keeps an older suggestion from being applied while a newer request is running', async () => {
    const finishFirst = deferDraft();
    await mount();
    await click('editor.ai.rephrase');
    await finishFirst('Older suggestion');
    const finishSecond = deferDraft();
    await click('editor.ai.continue');
    expect(button('editor.ai.replace')?.disabled).toBe(true);
    expect(button('editor.ai.insert')?.disabled).toBe(true);
    await finishSecond('Newer section');
    expect(button('editor.ai.replace')?.disabled).toBe(false);
  });

  it('sends one request for a double click', async () => {
    const finish = deferDraft();
    await mount();
    await act(async () => {
      button('editor.ai.rephrase')?.click();
      button('editor.ai.rephrase')?.click();
    });
    expect(state.draft).toHaveBeenCalledTimes(1);
    await finish('Once');
  });
});

describe('aiAssistPageId', () => {
  const ready = { switching: false, activeId: 'a', loadedPageId: 'a', syncedPageId: 'a' };
  it('is the open page once it has loaded and its draft is hydrated', () => {
    expect(aiAssistPageId(ready)).toBe('a');
  });
  it.each([
    ['a page switch is in progress', { switching: true }],
    ['no page is open', { activeId: null }],
    ['the page is still loading', { loadedPageId: undefined }],
    ['the loaded page is the previous one', { loadedPageId: 'b' }],
    ['the draft still belongs to the previous page', { syncedPageId: 'b' }],
  ])('is none while %s', (_reason, change) => {
    expect(aiAssistPageId({ ...ready, ...change })).toBeNull();
  });
});

describe('which AI drafts here', () => {
  const session = { pending: false, running: null, preview: null, run: vi.fn(), busyElsewhere: false, trackCard: () => undefined } as never;
  const render = async (source: Parameters<typeof AiAssist>[0]['source']) => {
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<AiAssist session={session} source={source} />));
    return container.querySelector('[data-testid="ai-source"]')?.textContent ?? null;
  };

  it('says it uses the site’s own Smart AI connection, naming the provider', async () => {
    expect(await render({ source: 'workspace', provider: 'openai' })).toBe('editor.ai.source.site');
  });

  it('says it uses the server’s AI when the site has no connection of its own', async () => {
    expect(await render({ source: 'instance', provider: 'openrouter' })).toBe('editor.ai.source.instance');
  });

  it('says nothing while the source is unknown', async () => {
    expect(await render(undefined)).toBeNull();
  });
});
