import type { WorkspaceAiProvider } from '@nibleaf/validators';
import { saveWorkspaceAiConnectionBody, workspaceAiModelsBody } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import {
  checkRequest,
  modelOptions,
  type ProviderKeyFormInput,
  providerForForm,
  providerFormKey,
  providerKeyFormState,
  saveRequest,
} from './provider-key-form';

const KEY = 'fake-key-for-the-test';
const fresh = providerForForm('openai', null);
const stored: WorkspaceAiProvider = {
  id: 'openai',
  configured: true,
  revision: 2,
  verified: true,
  verifiedAt: '2026-11-01T10:00:00.000Z',
  answerModel: 'gpt-6-luna',
};
const input = (over: Partial<ProviderKeyFormInput> = {}): ProviderKeyFormInput => ({
  provider: fresh,
  canSave: true,
  apiKey: '',
  answerModel: '',
  replace: false,
  checked: false,
  busy: false,
  modelCount: 0,
  ...over,
});
const state = (over: Partial<ProviderKeyFormInput> = {}) => providerKeyFormState(input(over));
const done = (over: Partial<ProviderKeyFormInput> = {}) => Object.fromEntries(state(over).steps.map(({ step, done }) => [step, done]));

describe('providerForForm and providerFormKey', () => {
  it('starts an unsaved provider at revision 0 with nothing configured', () => {
    expect(fresh).toEqual({ id: 'openai', configured: false, revision: 0, verified: false, verifiedAt: null, answerModel: null });
    expect(providerForForm('openrouter', null).id).toBe('openrouter');
  });

  it('edits the saved connection as it is', () => {
    expect(providerForForm('openai', stored)).toBe(stored);
  });

  it('keys the form by provider and revision, so a new saved revision starts a fresh form', () => {
    expect(providerFormKey(fresh)).toBe('openai:0');
    expect(providerFormKey(stored)).toBe('openai:2');
    expect(providerFormKey({ ...stored, revision: 3 })).not.toBe(providerFormKey(stored));
  });
});

describe('providerKeyFormState: steps', () => {
  it('ticks nothing on a first setup', () => {
    expect(state().steps.map(({ step }) => step)).toEqual(['key', 'check', 'model', 'save']);
    expect(done()).toEqual({ key: false, check: false, model: false, save: false });
  });

  it('ticks the key once one is typed, but not for whitespace', () => {
    expect(done({ apiKey: KEY }).key).toBe(true);
    expect(done({ apiKey: '   ' }).key).toBe(false);
  });

  it('ticks the check after a successful check, or when the stored key was verified', () => {
    expect(done({ checked: true }).check).toBe(true);
    expect(done({ provider: { ...stored, verified: false } }).check).toBe(false);
    expect(done({ provider: stored, answerModel: 'gpt-6-luna' }).check).toBe(true);
  });

  it('ticks the model once one is chosen', () => {
    expect(done({ answerModel: 'gpt-6-luna' }).model).toBe(true);
  });

  it('ticks every step on a saved, untouched connection', () => {
    expect(done({ provider: stored, answerModel: 'gpt-6-luna' })).toEqual({ key: true, check: true, model: true, save: true });
  });
});

describe('providerKeyFormState: saved', () => {
  it('is saved only when configured, with no new key and the stored model', () => {
    expect(state({ provider: stored, answerModel: 'gpt-6-luna' }).saved).toBe(true);
    expect(state({ provider: stored, answerModel: 'gpt-6-sol' }).saved).toBe(false);
    expect(state({ provider: stored, answerModel: 'gpt-6-luna', apiKey: KEY }).saved).toBe(false);
    expect(state({ answerModel: '' }).saved).toBe(false);
  });

  it('treats a whitespace key as no key', () => {
    expect(state({ provider: stored, answerModel: 'gpt-6-luna', apiKey: '  ' }).saved).toBe(true);
  });

  it('compares a configured provider with no stored model against an empty choice', () => {
    expect(state({ provider: { ...stored, answerModel: null }, answerModel: '' }).saved).toBe(true);
  });
});

describe('providerKeyFormState: why Save is blocked', () => {
  it('says the server cannot store keys before anything else', () => {
    expect(state({ canSave: false, provider: stored, apiKey: KEY, answerModel: '' }).saveBlock).toBe('encryption');
  });

  it('asks for a key on a first setup', () => {
    expect(state().saveBlock).toBe('pasteKey');
    expect(state({ apiKey: '   ', answerModel: 'gpt-6-luna' }).saveBlock).toBe('pasteKey');
  });

  it('asks for a model once there is a key', () => {
    expect(state({ apiKey: KEY }).saveBlock).toBe('chooseModel');
    expect(state({ provider: { ...stored, answerModel: null } }).saveBlock).toBe('chooseModel');
  });

  it('asks for consent before a new key replaces the stored one', () => {
    expect(state({ provider: stored, apiKey: KEY, answerModel: 'gpt-6-luna' }).saveBlock).toBe('replace');
    expect(state({ provider: stored, apiKey: KEY, answerModel: 'gpt-6-luna', replace: true }).saveBlock).toBeNull();
  });

  it('needs no consent for a first key, or for a new model on the stored key', () => {
    expect(state({ apiKey: KEY, answerModel: 'gpt-6-luna' }).saveBlock).toBeNull();
    expect(state({ provider: stored, answerModel: 'gpt-6-sol' }).saveBlock).toBeNull();
  });

  it('shows the reason only when there is something unsaved to explain', () => {
    expect(state().shownSaveBlock).toBe('pasteKey');
    expect(state({ apiKey: KEY, answerModel: 'gpt-6-luna' }).shownSaveBlock).toBeNull();
    // A saved form with a server that has since lost its encryption key: Save is blocked, but there is nothing to save.
    const savedButLocked = state({ canSave: false, provider: stored, answerModel: 'gpt-6-luna' });
    expect(savedButLocked.saveBlock).toBe('encryption');
    expect(savedButLocked.shownSaveBlock).toBeNull();
  });
});

describe('providerKeyFormState: controls', () => {
  it('lets Save be pressed only when nothing blocks it and nothing is running', () => {
    const ready = { apiKey: KEY, answerModel: 'gpt-6-luna' };
    expect(state(ready).canSubmit).toBe(true);
    expect(state({ ...ready, busy: true }).canSubmit).toBe(false);
    expect(state({ apiKey: KEY }).canSubmit).toBe(false);
  });

  it('enables the key field unless a request is running or keys cannot be stored', () => {
    expect(state().keyEnabled).toBe(true);
    expect(state({ busy: true }).keyEnabled).toBe(false);
    expect(state({ canSave: false }).keyEnabled).toBe(false);
  });

  it('enables the model picker when there is a model and nothing is running', () => {
    expect(state({ modelCount: 0 }).modelEnabled).toBe(false);
    expect(state({ modelCount: 2 }).modelEnabled).toBe(true);
    expect(state({ modelCount: 2, busy: true }).modelEnabled).toBe(false);
  });

  it('allows a check with a typed key or a stored one, never while running', () => {
    expect(state().canCheck).toBe(false);
    expect(state({ apiKey: '  ' }).canCheck).toBe(false);
    expect(state({ apiKey: KEY }).canCheck).toBe(true);
    expect(state({ provider: stored }).canCheck).toBe(true);
    expect(state({ provider: stored, busy: true }).canCheck).toBe(false);
  });

  it('asks for replace consent only once something is typed over a stored key', () => {
    expect(state({ provider: stored }).showReplaceConsent).toBe(false);
    expect(state({ provider: stored, apiKey: KEY }).showReplaceConsent).toBe(true);
    // Any typing counts, as before: the box shows as soon as the field is not empty.
    expect(state({ provider: stored, apiKey: ' ' }).showReplaceConsent).toBe(true);
    expect(state({ apiKey: KEY }).showReplaceConsent).toBe(false);
  });
});

describe('modelOptions', () => {
  it('uses the checked list when there is one, even an empty one', () => {
    expect(modelOptions([{ id: 'a' }, { id: 'b' }], stored)).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(modelOptions([], stored)).toEqual([]);
  });

  it('falls back to the stored model, or nothing', () => {
    expect(modelOptions(undefined, stored)).toEqual([{ id: 'gpt-6-luna' }]);
    expect(modelOptions(undefined, fresh)).toEqual([]);
  });
});

describe('checkRequest', () => {
  it('checks the typed key, trimmed', () => {
    const body = checkRequest(stored, `  ${KEY}  `);
    expect(body).toEqual({ providerId: 'openai', apiKey: KEY });
    expect(workspaceAiModelsBody.safeParse(body).success).toBe(true);
  });

  it('checks the stored key when nothing is typed', () => {
    const body = checkRequest(stored, '   ');
    expect(body).toEqual({ providerId: 'openai' });
    expect(workspaceAiModelsBody.safeParse(body).success).toBe(true);
  });
});

describe('saveRequest', () => {
  it('sends a first key with revision 0', () => {
    const body = saveRequest({ provider: fresh, apiKey: ` ${KEY} `, answerModel: 'gpt-6-luna', replace: false });
    expect(body).toEqual({ providerId: 'openai', answerModel: 'gpt-6-luna', expectedRevision: 0, apiKey: KEY });
    expect(saveWorkspaceAiConnectionBody.safeParse(body).success).toBe(true);
  });

  it('sends only the model and the revision the form opened at when the stored key stays', () => {
    const body = saveRequest({ provider: stored, apiKey: '', answerModel: 'gpt-6-sol', replace: false });
    expect(body).toEqual({ providerId: 'openai', answerModel: 'gpt-6-sol', expectedRevision: 2 });
    expect(saveWorkspaceAiConnectionBody.safeParse(body).success).toBe(true);
  });

  it('replaces the stored key only with consent', () => {
    const body = saveRequest({ provider: stored, apiKey: KEY, answerModel: 'gpt-6-luna', replace: true });
    expect(body).toEqual({ providerId: 'openai', answerModel: 'gpt-6-luna', expectedRevision: 2, apiKey: KEY, replaceCredential: true });
    expect(saveWorkspaceAiConnectionBody.safeParse(body).success).toBe(true);
    // Without consent the server refuses it, which is why the form blocks Save first.
    expect(
      saveWorkspaceAiConnectionBody.safeParse(saveRequest({ provider: stored, apiKey: KEY, answerModel: 'gpt-6-luna', replace: false })).success,
    ).toBe(false);
  });
});
