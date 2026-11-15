// @vitest-environment jsdom
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api';
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
  state.models.mutate.mockReset();
  state.save.mutate.mockReset();
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
  await rerender(onSaved);
  return container;
};
const rerender = (onSaved?: () => void) => act(async () => root?.render(<ProviderKeyForm onSaved={onSaved} projectId="site" providerId="openai" />));
const STORED = { id: 'openai', configured: true, revision: 2, verified: true, verifiedAt: null, answerModel: 'gpt-6-luna' };
const keyInput = () => document.querySelector<HTMLInputElement>('input[name="ai-provider-api-key"]');
const consentBox = () => document.querySelector<HTMLElement>('[role="checkbox"]');
const modelTrigger = () => document.querySelector<HTMLElement>('[data-testid="ai-key-form"] [id$="-model"]');
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
    state.connection = { ...STORED };
    await mount();
    expect(steps()).toEqual(['done', 'done', 'done', 'done']);
    await typeKey('another-fake-key-for-the-test');
    expect(document.body.textContent).toContain('settings.smartAi.why.replace');
    await act(async () => consentBox()?.click());
    expect(document.body.textContent).not.toContain('settings.smartAi.why.replace');
  });

  it('gates Save on the replace consent box, a design-system checkbox named by its label', async () => {
    state.connection = { ...STORED };
    await mount();
    // Nothing typed over the stored key: nothing to consent to.
    expect(consentBox()).toBeNull();
    await typeKey('another-fake-key-for-the-test');
    const box = consentBox();
    expect(box?.closest('[data-slot="checkbox-field"]')).not.toBeNull();
    expect(document.querySelector('input[type="checkbox"]:not([aria-hidden="true"]):not([hidden])')).toBeNull();
    expect(computeAccessibleName(box as HTMLElement)).toBe('settings.smartAi.replaceCredential');
    // The key hint already explains that a new key needs this consent; it describes the box.
    expect(computeAccessibleDescription(box as HTMLElement)).toBe('settings.smartAi.keepKey');
    expect(box?.getAttribute('aria-checked')).toBe('false');
    expect(saveButton()?.disabled).toBe(true);
    expect(document.getElementById(saveButton()?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('settings.smartAi.why.replace');

    await act(async () => box?.click());
    expect(box?.getAttribute('aria-checked')).toBe('true');
    expect(saveButton()?.disabled).toBe(false);
    expect(saveButton()?.hasAttribute('aria-describedby')).toBe(false);
    await act(async () => saveButton()?.closest('form')?.requestSubmit());
    expect(state.save.mutate).toHaveBeenCalledWith(
      { providerId: 'openai', answerModel: 'gpt-6-luna', expectedRevision: 2, apiKey: 'another-fake-key-for-the-test', replaceCredential: true },
      expect.any(Object),
    );

    // Unticking blocks Save again.
    await act(async () => box?.click());
    expect(box?.getAttribute('aria-checked')).toBe('false');
    expect(saveButton()?.disabled).toBe(true);
  });

  it('drops a checked model list and its chosen model when the key changes', async () => {
    state.connection = { ...STORED };
    Object.assign(state.models, { isSuccess: true, data: { models: [{ id: 'gpt-6-luna' }, { id: 'gpt-6-sol' }] } });
    await mount();
    expect(document.querySelector('[role="status"]')?.textContent).toBe('settings.smartAi.modelsVerified');
    expect(state.models.reset).not.toHaveBeenCalled();
    await act(async () => {
      const trigger = modelTrigger();
      trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      trigger?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      trigger?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      trigger?.click();
    });
    const anotherModel = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes('gpt-6-sol'));
    expect(anotherModel).toBeDefined();
    await act(async () => {
      anotherModel?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      anotherModel?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      anotherModel?.click();
    });
    expect(modelTrigger()?.textContent).toContain('gpt-6-sol');
    await typeKey('another-fake-key-for-the-test');
    // The list checked against the old key is reset, and the choice goes back to the stored model.
    expect(state.models.reset).toHaveBeenCalledTimes(1);
    expect(modelTrigger()?.textContent).toContain('gpt-6-luna');
  });

  it('clears the typed key after a save, and starts a fresh form when the saved revision changes', async () => {
    state.connection = { ...STORED };
    state.save.mutate.mockImplementation((_body: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
    await mount();
    await typeKey('another-fake-key-for-the-test');
    await act(async () => consentBox()?.click());
    state.models.reset.mockClear();
    await act(async () => saveButton()?.closest('form')?.requestSubmit());
    expect(state.save.mutate).toHaveBeenCalledTimes(1);
    // The secret is not kept in the form once saved, and the list checked with it is dropped.
    expect(keyInput()?.value).toBe('');
    expect(state.models.reset).toHaveBeenCalledTimes(1);
    expect(consentBox()).toBeNull();

    // A key typed against revision 2 does not survive into revision 3 (saved here or in another session).
    await typeKey('typed-against-revision-two');
    await act(async () => consentBox()?.click());
    state.connection = { ...STORED, revision: 3 };
    await rerender();
    expect(keyInput()?.value).toBe('');
    expect(consentBox()).toBeNull();
    // Consent is not carried over either: typing again asks for it afresh.
    await typeKey('typed-against-revision-three');
    expect(consentBox()?.getAttribute('aria-checked')).toBe('false');
  });

  it('leaves mutation errors to the mutations: no error handler of its own', async () => {
    state.connection = { ...STORED };
    await mount();
    const verify = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('settings.smartAi.verifyModels'));
    await act(async () => verify?.click());
    expect(state.models.mutate).toHaveBeenCalledWith({ providerId: 'openai' });
    expect(state.models.mutate.mock.calls[0]).toHaveLength(1);
    await act(async () => saveButton()?.closest('form')?.requestSubmit());
    const [, options] = state.save.mutate.mock.calls[0] ?? [];
    expect(Object.keys(options as object)).toEqual(['onSuccess']);
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
