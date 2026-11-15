// @vitest-environment jsdom
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { Language, Project } from '@/hooks/api';
import type { SeoConfig } from '../model/seo';
import { SeoSettings } from './seo-settings';

const mocks = vi.hoisted(() => ({
  languages: [] as unknown[],
  updateProject: vi.fn(),
  updateLanguage: vi.fn(),
  upload: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({ data: mocks.languages, isPending: false }),
  useUpdateProjectConfig: () => ({ mutateAsync: mocks.updateProject, isPending: false }),
  useUpdateLanguage: () => ({ mutateAsync: mocks.updateLanguage, isPending: false }),
  useUploadAsset: () => ({ mutateAsync: mocks.upload, isPending: false }),
}));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: (_t: unknown, _error: unknown, fallback: string) => `friendly:${fallback}` }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SAVED = { metaTitle: 'Acme Docs', metaDescription: 'Everything about Acme.', socialImage: '/og/cover.png' };
/** A site as the project query returns it; other config sections ride along untouched. */
const site = (seo: SeoConfig = SAVED, id = 'site-a') =>
  ({ id, name: 'Acme', description: 'Acme site', config: { theme: { preset: 'nib' }, seo } }) as unknown as Project;
/** The project the PATCH returns: the stored SEO merged with the patch, as the API's one-level merge does. */
const confirmed = ({ config }: { config: { seo: SeoConfig } }, stored: SeoConfig = SAVED) => site({ ...stored, ...config.seo });

const language = (overrides: Partial<Language>) =>
  ({ code: 'en', direction: 'LTR', enabled: true, isDefault: false, position: 0, config: null, ...overrides }) as Language;
const ENGLISH = language({ id: 'en', label: 'English', isDefault: true });
const french = (seo?: SeoConfig) => language({ id: 'fr', code: 'fr', label: 'Français', position: 1, config: seo ? { seo } : null });
const arabic = (seo?: SeoConfig) =>
  language({ id: 'ar', code: 'ar', label: 'العربية', direction: 'RTL', position: 2, config: seo ? { seo, banner: { message: 'إعلان' } } : null });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let dirty: Set<string>;

const render = (project: Project) =>
  act(async () =>
    root.render(
      <ConfirmProvider>
        <ConfigDirtyProvider report={(id, changed) => (changed ? dirty.add(id) : dirty.delete(id))}>
          <SeoSettings project={project} />
        </ConfigDirtyProvider>
      </ConfirmProvider>,
    ),
  );

beforeEach(() => {
  mocks.languages = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  dirty = new Set();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const LABEL = {
  metaTitle: 'settings.seo.metaTitle.label',
  metaDescription: 'settings.seo.metaDescription.label',
  socialImage: 'settings.seo.socialImage.label',
} as const;
type Text = keyof typeof LABEL;

const labelOf = (text: string) => {
  const label = [...container.querySelectorAll('label')].find((el) => el.textContent === text);
  if (!label) throw new Error(`No label ${text}`);
  return label;
};
const input = (name: Text) => {
  const control = document.getElementById(labelOf(LABEL[name]).htmlFor);
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) throw new Error(`No control for ${name}`);
  return control;
};
const indexSwitch = () => {
  const control = container.querySelector<HTMLElement>(`[role="switch"][aria-labelledby="${labelOf('settings.seo.allowIndex.title').id}"]`);
  if (!control) throw new Error('No index switch');
  return control;
};
const indexing = () => indexSwitch().getAttribute('aria-checked') === 'true';
const values = () => ({
  metaTitle: input('metaTitle').value,
  metaDescription: input('metaDescription').value,
  socialImage: input('socialImage').value,
  allowIndex: indexing(),
});
const uploadControl = () => input('socialImage').parentElement as HTMLElement;
const uploadButton = () => uploadControl().querySelector('button') as HTMLButtonElement;
const uploading = () => uploadButton().getAttribute('aria-busy') === 'true';

const type = (el: HTMLInputElement | HTMLTextAreaElement, text: string) =>
  act(async () => {
    const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const click = (el: HTMLElement) => act(async () => el.click());
const buttonNamed = (name: string, scope: ParentNode = container) => {
  // A button that can show "Saving…" renders both labels, the idle one first.
  const found = [...scope.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith(name));
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
const region = () => container.querySelector<HTMLElement>('[data-slot="save-region"]');
const save = () => click(buttonNamed('common.save', region() ?? undefined));
const discard = () => click(buttonNamed('forms.discard', region() ?? undefined));
const conflict = () => container.textContent?.includes('forms.changedElsewhere');
const chooseScope = (label: string) => click(buttonNamed(label));
const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]');
const answerDialog = (confirm: boolean) => {
  const open = dialog();
  if (!open) throw new Error('No confirmation open');
  const confirmButton = buttonNamed('settings.chrome.scope.discardConfirm', open);
  const cancelButton = [...open.querySelectorAll('button')].find((button) => button !== confirmButton);
  if (!cancelButton) throw new Error('No cancel button');
  return click(confirm ? confirmButton : cancelButton);
};
/** Picks `file` in the hidden file input, as the Upload button's file dialog would. */
const choose = (file = new File(['png'], 'cover.png', { type: 'image/png' })) =>
  act(async () => {
    const picker = uploadControl().querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  });
/** An upload the test finishes when it chooses; resolves the asset the shared hook returns. */
const pendingUpload = () => {
  const upload = deferred<{ url: string }>();
  mocks.upload.mockImplementationOnce(() => upload.promise);
  return {
    finish: (url: string) => act(async () => upload.resolve({ url })),
    fail: (error: unknown) => act(async () => upload.reject(error)),
  };
};

describe('SeoSettings: the project scope', () => {
  beforeEach(() => render(site()));

  it('opens pristine: saved values, indexing on when unset, text in its own direction, the image left to right', () => {
    expect(values()).toStrictEqual({ ...SAVED, allowIndex: true });
    expect(input('metaTitle').dir).toBe('auto');
    expect(input('metaDescription').dir).toBe('auto');
    expect(input('metaDescription')).toBeInstanceOf(HTMLTextAreaElement);
    expect(input('socialImage').dir).toBe('ltr');
    for (const hint of ['metaTitle', 'metaDescription', 'socialImage', 'allowIndex'])
      expect(container.textContent).toContain(`settings.seo.${hint}.hint`);
    const [own, label] = (uploadButton().getAttribute('aria-labelledby') ?? '').split(' ');
    expect(own).toBe(uploadButton().id);
    expect(document.getElementById(label ?? '')?.textContent).toBe(LABEL.socialImage);
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('shows the site name, description and a sample path when the fields are empty', async () => {
    await render(site({}, 'site-b'));
    expect(values()).toStrictEqual({ metaTitle: '', metaDescription: '', socialImage: '', allowIndex: true });
    expect([input('metaTitle').placeholder, input('metaDescription').placeholder, input('socialImage').placeholder]).toEqual([
      'Acme',
      'Acme site',
      '/og/cover.png',
    ]);
  });

  it('a toggle-only change is dirty, saves all four values, and is clean on the confirmed values', async () => {
    await click(indexSwitch());
    expect(region()).not.toBeNull();
    expect(dirty.size).toBe(1);
    mocks.updateProject.mockImplementationOnce(async (request) => confirmed(request));
    await save();
    expect(mocks.updateProject).toHaveBeenCalledWith({ config: { seo: { ...SAVED, allowIndex: false } } });
    expect(indexing()).toBe(false);
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    await click(indexSwitch());
    mocks.updateProject.mockImplementationOnce(async (request) => confirmed(request));
    await save();
    expect(mocks.updateProject).toHaveBeenLastCalledWith({ config: { seo: { ...SAVED, allowIndex: true } } });
  });

  it.each(['metaTitle', 'metaDescription', 'socialImage'] as const)('clears %s as an explicit "", trimmed with the rest', async (name) => {
    await type(input(name), '   ');
    await type(input('metaTitle'), name === 'metaTitle' ? '' : '  Acme Docs  ');
    mocks.updateProject.mockImplementationOnce(async (request) => confirmed(request));
    await save();
    const sent = JSON.parse(JSON.stringify(mocks.updateProject.mock.calls[0]?.[0]));
    expect(sent).toStrictEqual({ config: { seo: { ...SAVED, [name]: '', allowIndex: true } } });
    expect(input(name).value).toBe('');
    expect(region()).toBeNull();
  });

  it('keeps the edits and says why once when the save fails', async () => {
    await type(input('metaTitle'), 'New title');
    mocks.updateProject.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await save();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('friendly:settings.saveError');
    expect(input('metaTitle').value).toBe('New title');
    expect(region()).not.toBeNull();
    expect(dirty.size).toBe(1);
  });

  it('discards back to what the server holds', async () => {
    await type(input('metaDescription'), 'Other');
    await click(indexSwitch());
    await discard();
    expect(values()).toStrictEqual({ ...SAVED, allowIndex: true });
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('takes a refetch while clean; keeps an edit through one and offers the conflict', async () => {
    await render(site({ ...SAVED, metaDescription: 'Refetched' }));
    expect(input('metaDescription').value).toBe('Refetched');
    expect(region()).toBeNull();

    await type(input('metaTitle'), 'Mine');
    await render(site({ ...SAVED, metaDescription: 'Again', metaTitle: 'Theirs', allowIndex: false }));
    expect(values()).toStrictEqual({ metaTitle: 'Mine', metaDescription: 'Again', socialImage: SAVED.socialImage, allowIndex: false });
    expect(conflict()).toBe(true);
    await click(buttonNamed('forms.useTheirs'));
    expect(input('metaTitle').value).toBe('Theirs');
    expect(conflict()).toBe(false);
    expect(region()).toBeNull();
  });

  it('keeps an edit made during the save, and runs only one save at a time', async () => {
    const request = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(request.promise);
    await type(input('metaTitle'), 'Sent');
    await save();
    await type(input('metaDescription'), 'During');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })));
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve(site({ ...SAVED, metaTitle: 'Sent' })));
    expect(input('metaTitle').value).toBe('Sent');
    expect(input('metaDescription').value).toBe('During');
    expect(region()).not.toBeNull();
  });
});

describe("SeoSettings: a save's own refetch, which the mutation awaits before it resolves", () => {
  /**
   * Saves `typed` for the title, makes `newer` edits while the save runs, then
   * delivers the save's own refetch before the mutation resolves, as
   * `useUpdateProjectConfig` does. The server holds `stored`: by default the
   * trimmed value the save sent, or someone else's value written meanwhile.
   */
  const saveThenEditThenRefetch = async (typed: string, newer: (() => Promise<unknown>) | null, stored = typed.trim()) => {
    await render(site({ ...SAVED, metaTitle: 'Old' }));
    const request = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(request.promise);
    await type(input('metaTitle'), typed);
    await save();
    await newer?.();
    const refetched = site({ ...SAVED, metaTitle: stored });
    await render(refetched);
    const conflictBeforeResolve = conflict();
    await act(async () => request.resolve(refetched));
    return conflictBeforeResolve;
  };

  it('a value typed back to the old one during the save stays, dirty, and saves next', async () => {
    expect(await saveThenEditThenRefetch('Sent', () => type(input('metaTitle'), 'Old'))).toBe(false);
    expect(input('metaTitle').value).toBe('Old');
    expect(region()).not.toBeNull();
    expect(conflict()).toBe(false);
    mocks.updateProject.mockImplementationOnce(async (request) => confirmed(request));
    await save();
    expect(mocks.updateProject).toHaveBeenLastCalledWith({ config: { seo: { ...SAVED, metaTitle: 'Old', allowIndex: true } } });
    expect(region()).toBeNull();
  });

  it('a newer value typed during the save stays, dirty, with no false conflict', async () => {
    expect(await saveThenEditThenRefetch('Sent', () => type(input('metaTitle'), 'Newer'))).toBe(false);
    expect(input('metaTitle').value).toBe('Newer');
    expect(region()).not.toBeNull();
    expect(conflict()).toBe(false);
  });

  it('a cleared title echoes as "" and the form settles clean', async () => {
    expect(await saveThenEditThenRefetch('', null)).toBe(false);
    expect(input('metaTitle').value).toBe('');
    expect(region()).toBeNull();
  });

  it('a trimmed title with no newer edit echoes and ends clean on the stored value', async () => {
    expect(await saveThenEditThenRefetch('  Sent  ', null)).toBe(false);
    expect(mocks.updateProject).toHaveBeenCalledWith({ config: { seo: { ...SAVED, metaTitle: 'Sent', allowIndex: true } } });
    expect(input('metaTitle').value).toBe('Sent');
    expect(conflict()).toBe(false);
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('a trimmed title with a newer edit during the save: no false conflict, the edit survives and saves next', async () => {
    expect(await saveThenEditThenRefetch('  Sent  ', () => type(input('metaTitle'), 'Newer'))).toBe(false);
    expect(input('metaTitle').value).toBe('Newer');
    expect(conflict()).toBe(false);
    expect(region()).not.toBeNull();
    mocks.updateProject.mockImplementationOnce(async (request) => confirmed(request));
    await save();
    expect(mocks.updateProject).toHaveBeenLastCalledWith({ config: { seo: { ...SAVED, metaTitle: 'Newer', allowIndex: true } } });
    expect(region()).toBeNull();
  });

  it("someone else's title written during a trimmed save still conflicts; Use theirs takes it", async () => {
    expect(await saveThenEditThenRefetch('  Sent  ', () => type(input('metaTitle'), 'Newer'), 'Theirs')).toBe(true);
    expect(input('metaTitle').value).toBe('Newer');
    expect(conflict()).toBe(true);
    await click(buttonNamed('forms.useTheirs'));
    expect(input('metaTitle').value).toBe('Theirs');
    expect(conflict()).toBe(false);
    expect(region()).toBeNull();
  });

  it('a language scope judges its trimmed echo by what it sent too', async () => {
    mocks.languages = [ENGLISH, arabic()];
    await render(site());
    await chooseScope('العربية');
    const request = deferred<Language>();
    mocks.updateLanguage.mockReturnValueOnce(request.promise);
    await type(input('metaTitle'), '  توثيق  ');
    await save();
    await type(input('metaTitle'), 'توثيق أحدث');
    const stored = { metaTitle: 'توثيق', metaDescription: '', socialImage: '', allowIndex: true };
    mocks.languages = [ENGLISH, arabic(stored)];
    await render(site());
    expect(conflict()).toBe(false);
    await act(async () => request.resolve(arabic(stored)));
    expect(mocks.updateLanguage).toHaveBeenCalledWith({ id: 'ar', body: { config: { seo: stored } } });
    expect(input('metaTitle').value).toBe('توثيق أحدث');
    expect(conflict()).toBe(false);
    expect(region()).not.toBeNull();
  });
});

describe('SeoSettings: a language scope', () => {
  beforeEach(() => {
    mocks.languages = [ENGLISH, french({ metaTitle: 'Docs Acme' }), arabic()];
  });

  it('opens with the language values, its direction, and the project SEO as placeholders', async () => {
    await render(site());
    expect(container.textContent).toContain('settings.seo.scope.hint');
    await chooseScope('العربية');
    expect(values()).toStrictEqual({ metaTitle: '', metaDescription: '', socialImage: '', allowIndex: true });
    expect(input('metaTitle').dir).toBe('rtl');
    expect(input('metaDescription').dir).toBe('rtl');
    expect(input('socialImage').dir).toBe('ltr');
    expect([input('metaTitle').placeholder, input('metaDescription').placeholder, input('socialImage').placeholder]).toEqual([
      SAVED.metaTitle,
      SAVED.metaDescription,
      SAVED.socialImage,
    ]);
    await chooseScope('Français');
    expect(input('metaTitle').value).toBe('Docs Acme');
    expect(input('metaTitle').dir).toBe('ltr');
  });

  it('saves an override with all four values, and clears it to null with nothing left to override', async () => {
    mocks.updateLanguage.mockImplementation(async ({ id, body }) => ({ id, config: body.config }));
    await render(site());
    await chooseScope('العربية');
    await type(input('metaTitle'), ' توثيق ');
    await save();
    expect(mocks.updateLanguage).toHaveBeenCalledWith({
      id: 'ar',
      body: { config: { seo: { metaTitle: 'توثيق', metaDescription: '', socialImage: '', allowIndex: true } } },
    });
    expect(input('metaTitle').value).toBe('توثيق');
    expect(region()).toBeNull();

    await type(input('metaTitle'), '');
    await save();
    expect(mocks.updateLanguage).toHaveBeenLastCalledWith({ id: 'ar', body: { config: null } });
    expect(region()).toBeNull();
  });

  it('a language that turns indexing off overrides with allowIndex false; on again with no text clears it', async () => {
    mocks.updateLanguage.mockImplementation(async ({ id, body }) => ({ id, config: body.config }));
    await render(site());
    await chooseScope('العربية');
    await click(indexSwitch());
    await save();
    expect(mocks.updateLanguage).toHaveBeenCalledWith({
      id: 'ar',
      body: { config: { seo: { metaTitle: '', metaDescription: '', socialImage: '', allowIndex: false } } },
    });
    await click(indexSwitch());
    await save();
    expect(mocks.updateLanguage).toHaveBeenLastCalledWith({ id: 'ar', body: { config: null } });
  });

  it('says why once and keeps the edits when the language save fails', async () => {
    mocks.updateLanguage.mockRejectedValueOnce(new Error('offline'));
    await render(site());
    await chooseScope('Français');
    await type(input('metaDescription'), 'Tout sur Acme');
    await save();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('friendly:settings.saveError');
    expect(input('metaDescription').value).toBe('Tout sur Acme');
    expect(region()).not.toBeNull();
  });

  it('asks before dropping edits: Keep editing stays, Discard switches clean', async () => {
    await render(site());
    await click(indexSwitch());
    await chooseScope('Français');
    expect(dialog()).not.toBeNull();
    await answerDialog(false);
    expect(indexing()).toBe(false);
    await chooseScope('Français');
    await answerDialog(true);
    expect(input('metaTitle').value).toBe('Docs Acme');
    expect(indexing()).toBe(true);
    expect(region()).toBeNull();
  });

  it("a late success from the previous scope can't reset the new scope's draft", async () => {
    const pending = deferred<unknown>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(site());
    await type(input('metaTitle'), 'Project title');
    await save();
    await chooseScope('Français');
    await answerDialog(true);
    await type(input('metaTitle'), 'Titre');
    await act(async () => pending.resolve(site({ ...SAVED, metaTitle: 'Project title' })));
    expect(input('metaTitle').value).toBe('Titre');
    expect(region()).not.toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});

describe('SeoSettings: the social-image upload', () => {
  beforeEach(() => render(site()));

  it('fills the draft only; Save stores it', async () => {
    const upload = pendingUpload();
    await choose();
    expect(uploading()).toBe(true);
    await upload.finish('https://cdn.example/assets/og.png');
    expect(input('socialImage').value).toBe('https://cdn.example/assets/og.png');
    expect(uploading()).toBe(false);
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('settings.seo.uploaded');
    expect(region()).not.toBeNull();
    expect(dirty.size).toBe(1);
    mocks.updateProject.mockImplementationOnce(async (request) => confirmed(request));
    await save();
    expect(mocks.updateProject).toHaveBeenCalledWith({
      config: { seo: { ...SAVED, socialImage: 'https://cdn.example/assets/og.png', allowIndex: true } },
    });
    expect(region()).toBeNull();
  });

  it('keeps the value and says so once when the upload fails', async () => {
    const upload = pendingUpload();
    await choose();
    await upload.fail(Object.assign(new Error('Too large'), { status: 413 }));
    expect(input('socialImage').value).toBe(SAVED.socialImage);
    expect(uploading()).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('friendly:settings.seo.uploadError');
    expect(region()).toBeNull();
  });

  it('starts one upload at a time', async () => {
    const upload = pendingUpload();
    await choose();
    await choose();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    await upload.finish('https://cdn.example/assets/og.png');
  });

  it('does not overwrite a newer URL typed while it ran', async () => {
    const upload = pendingUpload();
    await choose();
    await type(input('socialImage'), '/og/typed.png');
    await upload.finish('https://cdn.example/assets/og.png');
    expect(input('socialImage').value).toBe('/og/typed.png');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('does not overwrite an edit typed back to the old value while it ran', async () => {
    const upload = pendingUpload();
    await choose();
    await type(input('socialImage'), '/og/other.png');
    await type(input('socialImage'), SAVED.socialImage);
    await upload.finish('https://cdn.example/assets/og.png');
    expect(input('socialImage').value).toBe(SAVED.socialImage);
    expect(region()).toBeNull();
  });

  it('does not refill a field cleared while it ran', async () => {
    const upload = pendingUpload();
    await choose();
    await type(input('socialImage'), '');
    await upload.finish('https://cdn.example/assets/og.png');
    expect(input('socialImage').value).toBe('');
  });

  it('does not re-dirty a draft discarded before it finished', async () => {
    const upload = pendingUpload();
    await type(input('metaTitle'), 'Edit');
    await choose();
    await discard();
    expect(uploading()).toBe(false);
    await upload.finish('https://cdn.example/assets/og.png');
    expect(values()).toStrictEqual({ ...SAVED, allowIndex: true });
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("never fills another site's form, nor reports there", async () => {
    const done = pendingUpload();
    await choose();
    await render(site({ ...SAVED, socialImage: '/og/b.png' }, 'site-b'));
    expect(uploading()).toBe(false);
    await done.finish('https://cdn.example/assets/a.png');
    expect(input('socialImage').value).toBe('/og/b.png');
    expect(region()).toBeNull();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('a save during the upload sends the draft as it is; the upload then fills a new draft', async () => {
    const upload = pendingUpload();
    await choose();
    await type(input('metaTitle'), 'During');
    mocks.updateProject.mockImplementationOnce(async (request) => confirmed(request));
    await save();
    expect(mocks.updateProject).toHaveBeenCalledWith({ config: { seo: { ...SAVED, metaTitle: 'During', allowIndex: true } } });
    await upload.finish('https://cdn.example/assets/og.png');
    expect(input('socialImage').value).toBe('https://cdn.example/assets/og.png');
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    expect(region()).not.toBeNull();
  });
});

describe('SeoSettings: an upload across scopes', () => {
  beforeEach(async () => {
    mocks.languages = [ENGLISH, french(), arabic({ socialImage: '/og/ar.png' })];
    await render(site());
  });

  it("never fills another language's draft, and a failure there says nothing", async () => {
    const done = pendingUpload();
    await chooseScope('Français');
    await choose();
    await chooseScope('العربية');
    await done.finish('https://cdn.example/assets/fr.png');
    expect(input('socialImage').value).toBe('/og/ar.png');
    expect(region()).toBeNull();

    const failed = pendingUpload();
    await choose();
    await chooseScope('Français');
    await failed.fail(new Error('late'));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('drops a result from an earlier visit after A → B → A', async () => {
    const upload = pendingUpload();
    await chooseScope('Français');
    await choose();
    await chooseScope('العربية');
    await chooseScope('Français');
    await upload.finish('https://cdn.example/assets/fr.png');
    expect(input('socialImage').value).toBe('');
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });
});

describe('SeoSettings: Enter', () => {
  beforeEach(() => render(site()));
  const defaultButton = () => container.querySelector('form button[type="submit"]') as HTMLButtonElement;
  /** A keydown, then the default-button click the browser's implicit submission makes in the same task. */
  const enterIn = (el: HTMLElement, init: KeyboardEventInit = {}) =>
    act(async () => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
      defaultButton().click();
    });

  it.each(['metaTitle', 'socialImage'] as const)('saves once on Enter in the %s field', async (name) => {
    await type(input(name), '/entered');
    mocks.updateProject.mockImplementationOnce(async (request) => confirmed(request));
    await enterIn(input(name));
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    expect(region()).toBeNull();
  });

  it('keeps Enter as a newline in the description: nothing is saved', async () => {
    await type(input('metaDescription'), 'Line one');
    await enterIn(input('metaDescription'));
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(region()).not.toBeNull();
  });
});
