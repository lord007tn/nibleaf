// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const provider = (id: 'openai' | 'openrouter') => ({
  id,
  configured: id === 'openrouter',
  verified: id === 'openrouter',
  answerModel: id === 'openrouter' ? 'openai/gpt-6-luna' : null,
  revision: 1,
});
const loaded = {
  selectedProvider: 'openrouter',
  answersEnabled: true,
  encryptionConfigured: true,
  infrastructureConfigured: true,
  instanceConfigured: false,
  instanceAnswersEnabled: false,
  providers: [provider('openai'), provider('openrouter')],
  index: { status: 'READY', chunks: 10, published: true, errorCode: null },
  embeddingModel: 'openai/text-embedding-3-small',
  openaiOAuth: { documentation: 'https://example.com' },
};
const state = vi.hoisted(() => ({
  query: { isPending: true, isError: false, isFetching: true, data: undefined as unknown, refetch: vi.fn() },
  select: { isPending: false, variables: undefined as { providerId: string } | undefined, mutate: vi.fn() },
  models: { isPending: false, isSuccess: false, data: undefined, mutate: vi.fn(), reset: vi.fn() },
  save: { isPending: false, mutate: vi.fn() },
  reindex: { isPending: false, mutate: vi.fn() },
}));
vi.mock('@/hooks/api/workspace-ai', () => ({
  useWorkspaceAi: () => state.query,
  useSelectWorkspaceAi: () => state.select,
  useWorkspaceAiModels: () => state.models,
  useSaveWorkspaceAiConnection: () => state.save,
}));
vi.mock('@/hooks/api', () => ({ useCreateProjectSearchReindex: () => state.reindex }));
vi.mock('@tanstack/react-router', () => ({ Link: (props: Record<string, unknown>) => <a href="/" {...props} /> }));
vi.mock('@/components/query-error-state', () => ({ QueryErrorState: () => <p>error</p> }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));

import { SmartAiSection } from './smart-ai-section';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});
const mount = async () => {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const render = () => act(async () => root.render(<SmartAiSection project={{ id: 'project' } as never} />));
  await render();
  return { container, render };
};
const button = (label: string, index = 0) =>
  [...document.querySelectorAll('button')].filter((candidate) => candidate.textContent?.includes(label))[index];

describe('Smart AI settings', () => {
  it('shows the section heading at once, over a skeleton shaped like the cards', async () => {
    const { container } = await mount();
    expect(container.textContent).toContain('settings.smartAi.description');
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy?.querySelector('[role="status"]')?.textContent).toBe('common.loading');
    // The status card, two provider cards and the index card.
    expect(busy?.querySelectorAll('.rounded-xl.border').length).toBe(4);
  });

  it('shows only the clicked action as working', async () => {
    Object.assign(state.query, { isPending: false, isFetching: false, data: loaded });
    const { render } = await mount();
    expect(button('settings.smartAi.reindex')?.getAttribute('aria-busy')).toBeNull();

    // Enabling OpenAI: its own button works, the others wait.
    Object.assign(state.select, { isPending: true, variables: { providerId: 'openai' } });
    await render();
    expect(button('settings.smartAi.useProvider', 0)?.getAttribute('aria-busy')).toBe('true');
    expect(button('settings.smartAi.useProvider', 1)?.getAttribute('aria-busy')).toBeNull();
    expect(button('settings.smartAi.disable')?.getAttribute('aria-busy')).toBeNull();
    expect(button('settings.smartAi.disable')?.disabled).toBe(true);
    Object.assign(state.select, { isPending: false, variables: undefined });

    // Reindexing: the hook refreshes the status and reports failures, so the button just runs it.
    state.reindex.isPending = true;
    await render();
    expect(button('settings.smartAi.reindex')?.getAttribute('aria-busy')).toBe('true');
    state.reindex.isPending = false;
    await render();
    await act(async () => button('settings.smartAi.reindex')?.click());
    expect(state.reindex.mutate).toHaveBeenCalledWith();
  });
});
