/**
 * A site's own OpenAI or OpenRouter key form, as pure logic: whether what is
 * on screen is already saved, which setup steps are done, why Save can't be
 * pressed yet, and the exact bodies the form sends. It takes plain values (the
 * saved connection, what the person typed, and whether a request is running);
 * the component only renders what it returns. Reasons are codes, so the
 * component owns their words.
 */
import type { SaveWorkspaceAiConnectionBody, WorkspaceAiModelsBody, WorkspaceAiProvider } from '@nibleaf/validators';
import type { AiKeyProvider } from './ai';

/** The connection the form edits: the saved one, or an empty one before the first save. */
export const providerForForm = (providerId: AiKeyProvider, connection: WorkspaceAiProvider | null): WorkspaceAiProvider =>
  connection ?? { id: providerId, configured: false, revision: 0, verified: false, verifiedAt: null, answerModel: null };

/**
 * The form's identity. A new saved revision starts a fresh form, so a key typed
 * against an older revision (or a model list checked with it) never lingers.
 */
export const providerFormKey = (provider: WorkspaceAiProvider) => `${provider.id}:${provider.revision}`;

/** What the form shows and sends, from its inputs. */
export type ProviderKeyFormInput = {
  provider: WorkspaceAiProvider;
  /** Whether this server can store keys at all (its encryption key is set). */
  canSave: boolean;
  /** The key field, as typed. */
  apiKey: string;
  answerModel: string;
  /** The "replace this site's stored key" consent box. */
  replace: boolean;
  /** A key check (model list) has succeeded since the key last changed. */
  checked: boolean;
  /** A check or a save is running. */
  busy: boolean;
  /** How many models there are to choose from (see `modelOptions`). */
  modelCount: number;
};

export type ProviderKeyStep = 'key' | 'check' | 'model' | 'save';
export type ProviderKeySaveBlock = 'encryption' | 'pasteKey' | 'chooseModel' | 'replace';

type ProviderKeyFormState = {
  /** The setup in order, each ticked once done, so an empty model list or a disabled Save is never a mystery. */
  steps: ReadonlyArray<{ step: ProviderKeyStep; done: boolean }>;
  /** Nothing changed since the last save. */
  saved: boolean;
  /** Why Save can't be pressed, first reason only; null when it can. */
  saveBlock: ProviderKeySaveBlock | null;
  /** The reason to show under Save: none on a saved, untouched form, which has nothing to explain. */
  shownSaveBlock: ProviderKeySaveBlock | null;
  /** Save is pressable. */
  canSubmit: boolean;
  /** The key field can change: nothing is running and this server can store keys. */
  keyEnabled: boolean;
  /** The model picker can open: nothing is running and there is a model to choose. */
  modelEnabled: boolean;
  /** The "Verify key and load models" button is pressable: there is a typed or a stored key to check. */
  canCheck: boolean;
  /** Ask for consent to replace the stored key: only once something is typed over a saved key. */
  showReplaceConsent: boolean;
};

const trimmedKey = (apiKey: string) => apiKey.trim();

/** Why Save can't be pressed, in the order a person would fix it. */
const saveBlock = ({
  provider,
  canSave,
  apiKey,
  answerModel,
  replace,
}: Pick<ProviderKeyFormInput, 'provider' | 'canSave' | 'apiKey' | 'answerModel' | 'replace'>): ProviderKeySaveBlock | null => {
  const keyEntered = Boolean(trimmedKey(apiKey));
  if (!canSave) return 'encryption';
  if (!provider.configured && !keyEntered) return 'pasteKey';
  if (!answerModel) return 'chooseModel';
  if (provider.configured && keyEntered && !replace) return 'replace';
  return null;
};

export const providerKeyFormState = (input: ProviderKeyFormInput): ProviderKeyFormState => {
  const { provider, canSave, apiKey, answerModel, checked, busy, modelCount } = input;
  const keyEntered = Boolean(trimmedKey(apiKey));
  const saved = provider.configured && !keyEntered && answerModel === (provider.answerModel ?? '');
  const block = saveBlock(input);
  return {
    steps: [
      { step: 'key', done: provider.configured || keyEntered },
      { step: 'check', done: checked || provider.verified },
      { step: 'model', done: Boolean(answerModel) },
      { step: 'save', done: saved },
    ],
    saved,
    saveBlock: block,
    shownSaveBlock: saved ? null : block,
    canSubmit: !busy && block === null,
    keyEnabled: !busy && canSave,
    modelEnabled: !busy && modelCount > 0,
    canCheck: !busy && (keyEntered || provider.configured),
    showReplaceConsent: provider.configured && apiKey !== '',
  };
};

/** The models to choose from: the checked list, or else the saved model alone so it still shows. */
export const modelOptions = (listed: ReadonlyArray<{ id: string }> | undefined, provider: WorkspaceAiProvider): ReadonlyArray<{ id: string }> =>
  listed ?? (provider.answerModel ? [{ id: provider.answerModel }] : []);

/** The check request: the typed key when there is one, otherwise the stored key is checked on the server. */
export const checkRequest = (provider: WorkspaceAiProvider, apiKey: string): WorkspaceAiModelsBody => {
  const key = trimmedKey(apiKey);
  return { providerId: provider.id, ...(key ? { apiKey: key } : {}) };
};

/**
 * The save request. It carries the revision the form was opened at, so a save
 * over a newer change is refused, and asks to replace the stored key only
 * with the person's consent.
 */
export const saveRequest = ({
  provider,
  apiKey,
  answerModel,
  replace,
}: Pick<ProviderKeyFormInput, 'provider' | 'apiKey' | 'answerModel' | 'replace'>): SaveWorkspaceAiConnectionBody => {
  const key = trimmedKey(apiKey);
  return {
    providerId: provider.id,
    answerModel,
    expectedRevision: provider.revision,
    ...(key ? { apiKey: key } : {}),
    ...(replace ? { replaceCredential: true } : {}),
  };
};
