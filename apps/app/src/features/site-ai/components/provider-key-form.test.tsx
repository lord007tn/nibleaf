// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The site's own key, inside its source card on AI answers (moved from the old
 * Smart AI section's provider cards). Choosing the source is the card's radio,
 * so the form has no "Use this provider" step any more.
 */

const state = vi.hoisted(() => ({
  connection: null as Record<string, unknown> | null,
  canSave: true,
  models: { isPending: false, isSuccess: false, data: undefined as unknown, mutate: vi.fn(), reset: vi.fn() },
  save: { isPending: false, mutate: vi.fn() },
}));
vi.mock('../api/hooks', () => ({
  useAiKeyConnection: () => ({ data: { connection: state.connection, canSave: state.canSave } }),
  useAiKeyModels: () => state.models,
  useSaveAiKey: () => state.save,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));

import { ProviderKeyForm } from './provider-key-form';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot> | undefined;
beforeEach(() => {
  state.connection = null;
  state.canSave = true;
  Object.assign(state.models, { isPending: false, isSuccess: false, data: undefined });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const mount = async (onSaved?: () => void) => {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<ProviderKeyForm onSaved={onSaved} projectId="site" providerId="openai" />));
  return container;
};
const steps = () =>
  [...document.querySelectorAll('[data-testid="smart-ai-steps"] li')].map((item) => (item.hasAttribute('data-done') ? 'done' : 'todo'));
const saveButton = () => [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('common.save'));
const typeKey = async (value: string) => {
  const input = document.querySelector<HTMLInputElement>('input[name="ai-provider-api-key"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('ProviderKeyForm', () => {
  it('shows four steps in order and why Save is not ready on first setup, with no "use this provider" step', async () => {
    await mount();
    expect(steps()).toEqual(['todo', 'todo', 'todo', 'todo']);
    expect(document.body.textContent).not.toContain('settings.smartAi.step.enable');
    expect(document.body.textContent).not.toContain('settings.smartAi.useProvider');
    expect(saveButton()?.disabled).toBe(true);
    expect(document.getElementById(saveButton()?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('settings.smartAi.why.pasteKey');

    await typeKey('fake-key-for-the-test');
    expect(steps()[0]).toBe('done');
    expect(document.body.textContent).toContain('settings.smartAi.why.chooseModel');
  });

  it('says keys cannot be saved on this server, before anything else', async () => {
    state.canSave = false;
    await mount();
    expect(document.body.textContent).toContain('settings.smartAi.why.encryption');
  });

  it('shows a saved key as done and explains that replacing it needs the consent box', async () => {
    state.connection = { id: 'openai', configured: true, revision: 2, verified: true, verifiedAt: null, answerModel: 'gpt-6-luna' };
    await mount();
    expect(steps()).toEqual(['done', 'done', 'done', 'done']);
    await typeKey('another-fake-key-for-the-test');
    expect(document.body.textContent).toContain('settings.smartAi.why.replace');
    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    expect(document.body.textContent).not.toContain('settings.smartAi.why.replace');
  });

  it('saves the key with the chosen model and the connection revision, then closes', async () => {
    state.connection = { id: 'openai', configured: true, revision: 2, verified: true, verifiedAt: null, answerModel: 'gpt-6-luna' };
    state.save.mutate.mockImplementation((_body: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
    const onSaved = vi.fn();
    await mount(onSaved);
    await act(async () => saveButton()?.closest('form')?.requestSubmit());
    expect(state.save.mutate).toHaveBeenCalledWith({ providerId: 'openai', answerModel: 'gpt-6-luna', expectedRevision: 2 }, expect.any(Object));
    expect(onSaved).toHaveBeenCalled();
  });
});
