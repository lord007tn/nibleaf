// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { Project } from '@/hooks/api';
import { BrandingSettings } from './branding-settings';

const mocks = vi.hoisted(() => ({ update: vi.fn(), upload: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('@/hooks/api', () => ({
  useUpdateProjectConfig: () => ({ mutateAsync: mocks.update, isPending: false }),
  useUploadAsset: () => ({ mutateAsync: mocks.upload, isPending: false }),
}));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: (_t: unknown, _error: unknown, fallback: string) => `friendly:${fallback}` }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type Branding = Record<'logoLight' | 'logoDark' | 'favicon' | 'logoHref', string | null>;
const SAVED: Branding = { logoLight: '/logo/light.svg', logoDark: '/logo/dark.svg', favicon: '/favicon.svg', logoHref: 'https://acme.example' };
/** A site as the project query returns it; other config sections ride along untouched. */
const site = (branding: Partial<Branding> = SAVED, id = 'site-a') => ({ id, config: { theme: { preset: 'nib' }, branding } }) as unknown as Project;
/** The project the PATCH returns: the stored branding merged one level deep with the patch, as the API does. */
const merged = (patch: Partial<Branding>, stored: Partial<Branding> = SAVED, id = 'site-a') => site({ ...stored, ...patch }, id);

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let dirty: Set<string>;

const render = (project: Project) =>
  act(async () =>
    root.render(
      <ConfigDirtyProvider report={(id, changed) => (changed ? dirty.add(id) : dirty.delete(id))}>
        <BrandingSettings project={project} />
      </ConfigDirtyProvider>,
    ),
  );

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  dirty = new Set();
  await render(site());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const LABEL = {
  logoLight: 'settings.branding.logoLight.label',
  logoDark: 'settings.branding.logoDark.label',
  favicon: 'settings.branding.favicon.label',
  logoHref: 'settings.branding.logoHref.label',
} as const;
type Name = keyof typeof LABEL;

const input = (name: Name) => {
  const label = [...container.querySelectorAll('label')].find((el) => el.textContent === LABEL[name]);
  const control = label ? document.getElementById(label.htmlFor) : null;
  if (!(control instanceof HTMLInputElement)) throw new Error(`No text control for ${name}`);
  return control;
};
/** The field's text input, its hidden file picker and its Upload button share one wrapper. */
const uploadControl = (name: Name) => input(name).parentElement as HTMLElement;
const uploadButton = (name: Name) => uploadControl(name).querySelector('button') as HTMLButtonElement;
const uploading = (name: Name) => uploadButton(name).getAttribute('aria-busy') === 'true';
const values = () => Object.fromEntries((Object.keys(LABEL) as Name[]).map((name) => [name, input(name).value]));

const type = (el: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const click = (el: HTMLElement) => act(async () => el.click());
/** Picks `file` in a field's hidden file input, as the Upload button's file dialog would. */
const choose = (name: Name, file = new File(['<svg/>'], `${name}.svg`, { type: 'image/svg+xml' })) =>
  act(async () => {
    const picker = uploadControl(name).querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  });
const region = () => container.querySelector('[data-slot="save-region"]');
const regionButton = (name: string) => {
  const button = [...(region()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes(name));
  if (!button) throw new Error(`No ${name} button in the save bar`);
  return button;
};
const save = () => click(regionButton('common.save'));
const discard = () => click(regionButton('forms.discard'));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
/** An upload the test finishes when it chooses; resolves the asset the shared hook returns. */
const pendingUpload = () => {
  const upload = deferred<{ url: string }>();
  mocks.upload.mockImplementationOnce(() => upload.promise);
  return {
    finish: (url: string) => act(async () => upload.resolve({ url })),
    fail: (error: unknown) => act(async () => upload.reject(error)),
  };
};

describe('BrandingSettings: the draft', () => {
  it('opens pristine: the saved values left to right, every control named, no save bar', () => {
    expect(container.querySelector('h2')?.textContent).toBe('settings.branding.title');
    expect(values()).toEqual(SAVED);
    for (const name of Object.keys(LABEL) as Name[]) expect(input(name).dir).toBe('ltr');
    for (const name of ['logoLight', 'logoDark', 'favicon'] as const) {
      const [own, label] = (uploadButton(name).getAttribute('aria-labelledby') ?? '').split(' ');
      expect(own).toBe(uploadButton(name).id);
      expect(document.getElementById(label ?? '')?.textContent).toBe(LABEL[name]);
      expect(uploadControl(name).querySelector('input[type="file"]')?.getAttribute('accept')).toBe('image/*');
    }
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('opens a site with no branding (or cleared branding) blank', async () => {
    await render(site({ logoLight: null, logoDark: null, favicon: null, logoHref: null }, 'site-b'));
    expect(values()).toEqual({ logoLight: '', logoDark: '', favicon: '', logoHref: '' });
    expect(region()).toBeNull();
  });

  it('saves only the changed field, trimmed, as a config.branding patch, then is clean on the server-confirmed values', async () => {
    await type(input('favicon'), '  /icons/new.png ');
    expect(region()).not.toBeNull();
    expect(dirty.size).toBe(1);
    mocks.update.mockResolvedValueOnce(merged({ favicon: '/icons/new.png' }));
    await save();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({ config: { branding: { favicon: '/icons/new.png' } } });
    expect(input('favicon').value).toBe('/icons/new.png');
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('clears all four saved values as explicit nulls that survive the merge and the refetch', async () => {
    for (const name of Object.keys(LABEL) as Name[]) await type(input(name), '');
    const cleared = { logoLight: null, logoDark: null, favicon: null, logoHref: null };
    mocks.update.mockResolvedValueOnce(merged(cleared));
    await save();
    expect(mocks.update).toHaveBeenCalledWith({ config: { branding: cleared } });
    // The refetch brings the merged config back.
    await render(merged(cleared));
    expect(values()).toEqual({ logoLight: '', logoDark: '', favicon: '', logoHref: '' });
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('keeps the edits and says why once when the save fails', async () => {
    await type(input('logoHref'), 'https://new.example');
    mocks.update.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await save();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('friendly:settings.saveError');
    expect(input('logoHref').value).toBe('https://new.example');
    expect(region()).not.toBeNull();
    expect(dirty.size).toBe(1);
  });

  it('takes a refetch while clean; keeps an edit through one and offers the conflict', async () => {
    await render(site({ ...SAVED, logoDark: '/brand/dark-2.svg' }));
    expect(input('logoDark').value).toBe('/brand/dark-2.svg');
    expect(region()).toBeNull();

    await type(input('favicon'), '/mine.svg');
    await render(site({ ...SAVED, logoDark: '/brand/dark-3.svg', favicon: '/theirs.svg' }));
    expect(input('logoDark').value).toBe('/brand/dark-3.svg');
    expect(input('favicon').value).toBe('/mine.svg');
    expect(container.textContent).toContain('forms.changedElsewhere');
    await click([...container.querySelectorAll('button')].find((b) => b.textContent === 'forms.useTheirs') as HTMLButtonElement);
    expect(input('favicon').value).toBe('/theirs.svg');
    expect(container.textContent).not.toContain('forms.changedElsewhere');
    expect(region()).toBeNull();
  });

  it('discards back to what the server holds', async () => {
    await type(input('logoLight'), '/other.svg');
    await discard();
    expect(values()).toEqual(SAVED);
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('keeps an edit made during the save, and runs only one save at a time', async () => {
    const request = deferred<Project>();
    mocks.update.mockReturnValueOnce(request.promise);
    await type(input('favicon'), '/sent.svg');
    await save();
    await type(input('logoHref'), 'https://during.example');
    // A second Save (Cmd/Ctrl+S) while the first is in flight sends nothing.
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve(merged({ favicon: '/sent.svg' })));
    expect(input('favicon').value).toBe('/sent.svg');
    expect(input('logoHref').value).toBe('https://during.example');
    expect(region()).not.toBeNull();
    mocks.update.mockResolvedValueOnce(merged({ favicon: '/sent.svg', logoHref: 'https://during.example' }));
    await save();
    expect(mocks.update).toHaveBeenLastCalledWith({ config: { branding: { logoHref: 'https://during.example' } } });
  });

  describe("a save's own refetch, which the config mutation awaits before it resolves", () => {
    /**
     * Saves `/sent.svg` over `/old.svg`, types `newer` while the save runs, then
     * delivers the save's own refetch (the stored `/sent.svg`) before the
     * mutation resolves, as `useUpdateProjectConfig` does.
     */
    const saveThenEditThenRefetch = async (newer: string) => {
      await render(site({ ...SAVED, favicon: '/old.svg' }));
      const request = deferred<Project>();
      mocks.update.mockReturnValueOnce(request.promise);
      await type(input('favicon'), '/sent.svg');
      await save();
      await type(input('favicon'), newer);
      await render(site({ ...SAVED, favicon: '/sent.svg' }));
      expect(input('favicon').value).toBe(newer);
      await act(async () => request.resolve(site({ ...SAVED, favicon: '/sent.svg' })));
    };

    it('keeps a value typed back to the old one during the save, dirty, and saves it next', async () => {
      await saveThenEditThenRefetch('/old.svg');
      expect(mocks.update).toHaveBeenCalledWith({ config: { branding: { favicon: '/sent.svg' } } });
      expect(input('favicon').value).toBe('/old.svg');
      expect(region()).not.toBeNull();
      expect(dirty.size).toBe(1);
      expect(container.textContent).not.toContain('forms.changedElsewhere');
      mocks.update.mockResolvedValueOnce(site({ ...SAVED, favicon: '/old.svg' }));
      await save();
      expect(mocks.update).toHaveBeenLastCalledWith({ config: { branding: { favicon: '/old.svg' } } });
      expect(region()).toBeNull();
    });

    it('keeps a newer different value typed during the save, dirty, with no false conflict', async () => {
      await saveThenEditThenRefetch('/newer.svg');
      expect(input('favicon').value).toBe('/newer.svg');
      expect(region()).not.toBeNull();
      expect(dirty.size).toBe(1);
      expect(container.textContent).not.toContain('forms.changedElsewhere');
      mocks.update.mockResolvedValueOnce(site({ ...SAVED, favicon: '/newer.svg' }));
      await save();
      expect(mocks.update).toHaveBeenLastCalledWith({ config: { branding: { favicon: '/newer.svg' } } });
      expect(region()).toBeNull();
    });
  });

  it("leaves another site alone when the first site's save settles after the switch", async () => {
    const request = deferred<Project>();
    mocks.update.mockReturnValueOnce(request.promise);
    await type(input('favicon'), '/a.svg');
    await save();
    await render(site({ ...SAVED, favicon: '/b.svg' }, 'site-b'));
    await act(async () => request.reject(new Error('late')));
    expect(input('favicon').value).toBe('/b.svg');
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(region()).toBeNull();
  });
});

describe('BrandingSettings: uploads', () => {
  it('fills only its own field, never saves, and the route guard sees the filled draft', async () => {
    const upload = pendingUpload();
    await choose('logoDark');
    expect(uploading('logoDark')).toBe(true);
    expect(uploading('logoLight')).toBe(false);
    await upload.finish('https://cdn.example/assets/dark.svg');
    expect(values()).toEqual({ ...SAVED, logoDark: 'https://cdn.example/assets/dark.svg' });
    expect(uploading('logoDark')).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('settings.branding.uploaded', { description: LABEL.logoDark });
    expect(region()).not.toBeNull();
    expect(dirty.size).toBe(1);

    mocks.update.mockResolvedValueOnce(merged({ logoDark: 'https://cdn.example/assets/dark.svg' }));
    await save();
    expect(mocks.update).toHaveBeenCalledWith({ config: { branding: { logoDark: 'https://cdn.example/assets/dark.svg' } } });
    expect(region()).toBeNull();
  });

  it('keeps the value and names the field once when an upload fails', async () => {
    const upload = pendingUpload();
    await choose('favicon');
    await upload.fail(Object.assign(new Error('Too large'), { status: 413 }));
    expect(input('favicon').value).toBe('/favicon.svg');
    expect(uploading('favicon')).toBe(false);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('friendly:settings.branding.uploadError', { description: LABEL.favicon });
    expect(region()).toBeNull();
  });

  it('does not overwrite a field typed in while its upload ran', async () => {
    const upload = pendingUpload();
    await choose('logoLight');
    await type(input('logoLight'), '/typed-meanwhile.svg');
    await upload.finish('https://cdn.example/assets/light.svg');
    expect(input('logoLight').value).toBe('/typed-meanwhile.svg');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('does not refill a field cleared while its upload ran', async () => {
    const upload = pendingUpload();
    await choose('favicon');
    await type(input('favicon'), '');
    await upload.finish('https://cdn.example/assets/favicon.png');
    expect(input('favicon').value).toBe('');
  });

  it('does not re-dirty a draft discarded before the upload finished', async () => {
    const upload = pendingUpload();
    await type(input('logoHref'), 'https://edit.example');
    await choose('logoDark');
    await discard();
    expect(uploading('logoDark')).toBe(false);
    await upload.finish('https://cdn.example/assets/dark.svg');
    expect(values()).toEqual(SAVED);
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("never fills another site's form, nor reports there, when the first site's upload settles", async () => {
    const done = pendingUpload();
    const failed = pendingUpload();
    await choose('logoLight');
    await choose('favicon');
    await render(site({ ...SAVED, logoLight: '/b-light.svg' }, 'site-b'));
    expect(uploading('logoLight')).toBe(false);
    await done.finish('https://cdn.example/assets/a-light.svg');
    await failed.fail(new Error('late'));
    expect(input('logoLight').value).toBe('/b-light.svg');
    expect(region()).toBeNull();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('drops a result from an earlier visit after A → B → A', async () => {
    const upload = pendingUpload();
    await choose('logoLight');
    await render(site({ ...SAVED, logoLight: '/b-light.svg' }, 'site-b'));
    await render(site());
    await upload.finish('https://cdn.example/assets/a-light.svg');
    expect(values()).toEqual(SAVED);
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('runs uploads for different fields side by side, each with its own progress and result', async () => {
    const light = pendingUpload();
    const icon = pendingUpload();
    await choose('logoLight');
    await choose('favicon');
    expect([uploading('logoLight'), uploading('logoDark'), uploading('favicon')]).toEqual([true, false, true]);
    await icon.finish('https://cdn.example/assets/icon.png');
    expect(input('favicon').value).toBe('https://cdn.example/assets/icon.png');
    expect(input('logoLight').value).toBe(SAVED.logoLight);
    expect(uploading('logoLight')).toBe(true);
    expect(uploading('favicon')).toBe(false);
    await light.finish('https://cdn.example/assets/light.svg');
    expect(values()).toEqual({ ...SAVED, logoLight: 'https://cdn.example/assets/light.svg', favicon: 'https://cdn.example/assets/icon.png' });
  });

  it('starts one upload per field at a time', async () => {
    const upload = pendingUpload();
    await choose('favicon');
    await choose('favicon');
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    await upload.finish('https://cdn.example/assets/icon.png');
    expect(input('favicon').value).toBe('https://cdn.example/assets/icon.png');
  });

  it('a save during an upload sends the draft as it is, and the upload then fills a new draft', async () => {
    const upload = pendingUpload();
    await choose('logoDark');
    await type(input('logoHref'), 'https://during.example');
    mocks.update.mockResolvedValueOnce(merged({ logoHref: 'https://during.example' }));
    await save();
    expect(mocks.update).toHaveBeenCalledWith({ config: { branding: { logoHref: 'https://during.example' } } });
    await upload.finish('https://cdn.example/assets/dark.svg');
    expect(input('logoDark').value).toBe('https://cdn.example/assets/dark.svg');
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(region()).not.toBeNull();
  });
});

describe('BrandingSettings: Enter', () => {
  const defaultButton = () => container.querySelector('form button[type="submit"]') as HTMLButtonElement;
  const status = () => container.querySelector('[role="status"]')?.textContent;
  /** A keydown in the field, then the default-button click the browser's implicit submission makes in the same task. */
  const enterIn = (el: HTMLInputElement) =>
    act(async () => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      defaultButton().click();
    });

  it('has one default button, hidden, so Enter can submit a form of several fields', () => {
    expect(container.querySelectorAll('form button[type="submit"]')).toHaveLength(1);
    expect(defaultButton().hidden).toBe(true);
  });

  it.each(['logoHref', 'favicon'] as const)('saves once on Enter in the %s field, and the bar says Saved', async (name) => {
    await type(input(name), '/entered.svg');
    mocks.update.mockResolvedValueOnce(merged({ [name]: '/entered.svg' }));
    await enterIn(input(name));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({ config: { branding: { [name]: '/entered.svg' } } });
    expect(status()).toBe('common.saved');
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('sends nothing on Enter while clean, also with an upload in flight, and the upload still only fills its field', async () => {
    const upload = pendingUpload();
    await choose('favicon');
    await enterIn(input('logoLight'));
    await enterIn(input('favicon'));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    await upload.finish('https://cdn.example/assets/icon.png');
    expect(input('favicon').value).toBe('https://cdn.example/assets/icon.png');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(region()).not.toBeNull();
  });

  it('on Enter while dirty with an upload in flight, saves the draft as it is once, and starts no other upload', async () => {
    const upload = pendingUpload();
    await choose('logoDark');
    await type(input('logoHref'), 'https://enter.example');
    mocks.update.mockResolvedValueOnce(merged({ logoHref: 'https://enter.example' }));
    await enterIn(input('logoHref'));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({ config: { branding: { logoHref: 'https://enter.example' } } });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    await upload.finish('https://cdn.example/assets/dark.svg');
    expect(input('logoDark').value).toBe('https://cdn.example/assets/dark.svg');
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
