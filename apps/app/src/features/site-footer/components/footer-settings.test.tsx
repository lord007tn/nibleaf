// @vitest-environment jsdom
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { Language, Project } from '@/hooks/api';
import type { FooterConfig } from '../model/footer';
import { FooterSettings } from './footer-settings';

const mocks = vi.hoisted(() => ({
  languages: [] as unknown[],
  updateProject: vi.fn(),
  updateLanguage: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({ data: mocks.languages, isPending: false }),
  useUpdateProjectConfig: () => ({ mutateAsync: mocks.updateProject, isPending: false }),
  useUpdateLanguage: () => ({ mutateAsync: mocks.updateLanguage, isPending: false }),
}));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: (_t: unknown, _error: unknown, fallback: string) => `friendly:${fallback}` }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SAVED = { copyright: '© Acme', github: 'https://github.com/acme', x: 'https://x.com/acme', linkedin: '/company' } satisfies FooterConfig;
/** A site as the project query returns it, other sections riding along. Tests spell out what the server stored. */
const site = (footer: FooterConfig = SAVED, id = 'site-a') =>
  ({ id, name: 'Acme', config: { theme: { preset: 'nib' }, seo: { metaTitle: 'Docs' }, footer } }) as unknown as Project;

const language = (overrides: Partial<Language>) =>
  ({ code: 'en', direction: 'LTR', enabled: true, isDefault: false, position: 0, config: null, ...overrides }) as Language;
const ENGLISH = language({ id: 'en', label: 'English', isDefault: true });
const french = (copyright?: string) =>
  language({ id: 'fr', code: 'fr', label: 'Français', position: 1, config: copyright === undefined ? null : { footer: { copyright } } });
/** Arabic, with SEO and a banner of its own that belong to other forms. */
const arabic = (copyright?: string) =>
  language({
    id: 'ar',
    code: 'ar',
    label: 'العربية',
    direction: 'RTL',
    position: 2,
    config: { seo: { metaTitle: 'توثيق' }, banner: { message: 'إعلان' }, ...(copyright === undefined ? {} : { footer: { copyright } }) },
  });

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
let queryClient: QueryClient;

const render = (project: Project) =>
  act(async () =>
    root.render(
      // An empty query cache: these tests hand the form its project directly (see footer-settings.source.test.tsx).
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
          <ConfigDirtyProvider report={(id, changed) => (changed ? dirty.add(id) : dirty.delete(id))}>
            <FooterSettings project={project} />
          </ConfigDirtyProvider>
        </ConfirmProvider>
      </QueryClientProvider>,
    ),
  );

beforeEach(() => {
  mocks.languages = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  dirty = new Set();
  queryClient = new QueryClient();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

type Text = 'copyright' | 'github' | 'x' | 'linkedin';
const input = (name: Text) => {
  const label = [...container.querySelectorAll('label')].find((el) => el.textContent === `settings.footer.${name}.label`);
  const control = label && document.getElementById(label.htmlFor);
  if (!(control instanceof HTMLInputElement)) throw new Error(`No control for ${name}`);
  return control;
};
const badge = () => {
  const title = [...container.querySelectorAll('div')].find((el) => el.textContent === 'settings.footer.badge.title');
  const control = title && container.querySelector<HTMLElement>(`[role="switch"][aria-labelledby="${title.id}"]`);
  if (!control) throw new Error('No badge switch');
  return control;
};
const values = () => ({
  copyright: input('copyright').value,
  github: input('github').value,
  x: input('x').value,
  linkedin: input('linkedin').value,
  madeWithBadge: badge().getAttribute('aria-checked') === 'true',
});

const type = (el: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, text);
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
/** The page's save status, announced politely by the shared SaveRegion. */
const status = () => container.querySelector('[role="status"][aria-live="polite"]')?.textContent?.trim() ?? '';
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
/** The last request body as it goes over the wire: JSON drops `undefined`. */
const lastSent = (mock: typeof mocks.updateProject) => JSON.parse(JSON.stringify(mock.mock.calls.at(-1)?.[0]));
const ALL = { ...SAVED, madeWithBadge: true };

describe('FooterSettings: the project scope', () => {
  beforeEach(() => render(site()));

  it('opens pristine: saved values, the badge on when unset, the copyright in its own direction, links left to right', () => {
    expect(values()).toStrictEqual(ALL);
    expect(input('copyright').dir).toBe('auto');
    for (const name of ['github', 'x', 'linkedin'] as const) {
      expect(input(name).dir).toBe('ltr');
      expect(input(name).type).toBe('text');
      expect(container.textContent).toContain(`settings.footer.${name}.hint`);
    }
    expect(container.textContent).toContain('settings.footer.badge.hint');
    expect(container.textContent).not.toContain('settings.chrome.scope.globalField');
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('a toggle-only change is dirty, saves an explicit false, and the shared bar says Saved', async () => {
    await click(badge());
    expect(region()).not.toBeNull();
    expect(dirty.size).toBe(1);
    mocks.updateProject.mockResolvedValueOnce(site({ ...SAVED, madeWithBadge: false }));
    await save();
    // Only the switched badge is sent: untouched keys stay whatever the server holds.
    expect(lastSent(mocks.updateProject)).toStrictEqual({ config: { footer: { madeWithBadge: false } } });
    expect(values().madeWithBadge).toBe(false);
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
    expect(status()).toBe('common.saved');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  // The regression: the old form sent a blank as `undefined`, which JSON drops, so the server kept the old value.
  it.each(['copyright', 'github', 'x', 'linkedin'] as const)('clears a stored %s by sending "", and only what changed', async (name) => {
    await type(input(name), '   ');
    if (name !== 'copyright') await type(input('copyright'), '  © Acme  ');
    mocks.updateProject.mockResolvedValueOnce(site({ ...SAVED, [name]: '', madeWithBadge: true }));
    await save();
    // A whitespace-only change to the copyright is no change.
    expect(lastSent(mocks.updateProject)).toStrictEqual({ config: { footer: { [name]: '' } } });
    expect(input(name).value).toBe('');
    expect(region()).toBeNull();
  });

  it('keeps the copyright unset when the site never had one, so its automatic line stays', async () => {
    await render(site({ github: 'https://github.com/acme' }, 'site-b'));
    await type(input('x'), 'https://x.com/acme');
    mocks.updateProject.mockResolvedValueOnce(site({ github: 'https://github.com/acme', x: 'https://x.com/acme', madeWithBadge: true }, 'site-b'));
    await save();
    expect(lastSent(mocks.updateProject)).toStrictEqual({ config: { footer: { x: 'https://x.com/acme' } } });
  });

  it('keeps the edits and says why once when the save fails', async () => {
    await type(input('github'), 'https://github.com/acme-labs');
    mocks.updateProject.mockRejectedValueOnce(Object.assign(new Error('Bad request'), { status: 400 }));
    await save();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('friendly:settings.saveError');
    expect(input('github').value).toBe('https://github.com/acme-labs');
    expect(region()).not.toBeNull();
    expect(status()).toBe('');
    expect(dirty.size).toBe(1);
  });

  it('discards back to what the server holds', async () => {
    await type(input('copyright'), 'Other');
    await click(badge());
    await discard();
    expect(values()).toStrictEqual(ALL);
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('takes a refetch while clean; keeps an edit through one, and "Use theirs" takes theirs', async () => {
    await render(site({ ...SAVED, x: 'https://x.com/refetched' }));
    expect(input('x').value).toBe('https://x.com/refetched');
    expect(region()).toBeNull();
    await type(input('copyright'), 'Mine');
    await render(site({ ...SAVED, x: 'https://x.com/again', copyright: 'Theirs', madeWithBadge: false }));
    expect(values()).toStrictEqual({ ...ALL, copyright: 'Mine', x: 'https://x.com/again', madeWithBadge: false });
    expect(conflict()).toBe(true);
    await click(buttonNamed('forms.useTheirs'));
    expect(input('copyright').value).toBe('Theirs');
    expect(conflict()).toBe(false);
    expect(region()).toBeNull();
  });

  it('keeps an edit made during the save, and runs only one save at a time', async () => {
    const request = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(request.promise);
    await type(input('copyright'), 'Sent');
    await save();
    await type(input('linkedin'), 'https://linkedin.com/company/acme');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })));
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve(site({ ...SAVED, copyright: 'Sent', madeWithBadge: true })));
    expect(input('copyright').value).toBe('Sent');
    expect(input('linkedin').value).toBe('https://linkedin.com/company/acme');
    expect(region()).not.toBeNull();
  });

  it('starts over for another site', async () => {
    await type(input('copyright'), 'Unsaved');
    await render(site({ copyright: '© Beta' }, 'site-b'));
    expect(values()).toStrictEqual({ copyright: '© Beta', github: '', x: '', linkedin: '', madeWithBadge: true });
    expect(region()).toBeNull();
  });
});

describe("FooterSettings: a save's own refetch, which the mutation awaits before it resolves", () => {
  /**
   * Saves `typed` as the GitHub link, makes `newer` edits while it runs, then
   * lands the save's own refetch (reading `refetched`: by default what the
   * PATCH stored, the trimmed text) before the mutation resolves.
   */
  const saveThenRefetch = async (typed: string, newer: (() => Promise<unknown>) | null, refetched = typed.trim()) => {
    await render(site());
    const request = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(request.promise);
    await type(input('github'), typed);
    await save();
    await newer?.();
    await render(site({ ...SAVED, github: refetched, madeWithBadge: true }));
    const conflictBeforeResolve = conflict();
    await act(async () => request.resolve(site({ ...SAVED, github: typed.trim(), madeWithBadge: true })));
    return conflictBeforeResolve;
  };

  it('a trimmed link echoes with no false conflict and ends clean on the stored value', async () => {
    expect(await saveThenRefetch('  https://github.com/acme-labs  ', null)).toBe(false);
    expect(lastSent(mocks.updateProject).config.footer.github).toBe('https://github.com/acme-labs');
    expect(input('github').value).toBe('https://github.com/acme-labs');
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('a cleared link echoes as "" and the form settles clean', async () => {
    expect(await saveThenRefetch('   ', null)).toBe(false);
    expect(lastSent(mocks.updateProject).config.footer.github).toBe('');
    expect(input('github').value).toBe('');
    expect(region()).toBeNull();
  });

  it('a newer edit during the save stays, dirty, with no false conflict, and saves next', async () => {
    expect(await saveThenRefetch(' https://github.com/acme-labs ', () => type(input('github'), 'https://github.com/newer'))).toBe(false);
    expect(input('github').value).toBe('https://github.com/newer');
    expect(conflict()).toBe(false);
    expect(region()).not.toBeNull();
    mocks.updateProject.mockResolvedValueOnce(site({ ...SAVED, github: 'https://github.com/newer', madeWithBadge: true }));
    await save();
    expect(lastSent(mocks.updateProject).config.footer.github).toBe('https://github.com/newer');
    expect(region()).toBeNull();
  });

  it("someone else's link written during the save surfaces as a conflict before the save resolves", async () => {
    const theirs = 'https://github.com/theirs';
    expect(await saveThenRefetch(' https://github.com/acme-labs ', () => type(input('github'), 'https://github.com/newer'), theirs)).toBe(true);
    expect(input('github').value).toBe('https://github.com/newer');
    expect(conflict()).toBe(true);
    // The save settled unclean (`succeeded()` was false): the draft stays open, dirty and unresolved.
    expect(region()).not.toBeNull();
    expect(dirty.size).toBe(1);
    expect(buttonNamed('forms.useTheirs')).toBeTruthy();
  });

  // #743: the mutation resolves with its PATCH response after the refetch
  // already brought theirs; the response must not rewind the confirmed baseline.
  it('… and "Use theirs" then takes their link, not the save’s own PATCH response (#743)', async () => {
    const theirs = 'https://github.com/theirs';
    await saveThenRefetch(' https://github.com/acme-labs ', () => type(input('github'), 'https://github.com/newer'), theirs);
    await click(buttonNamed('forms.useTheirs'));
    expect(input('github').value).toBe(theirs);
  });
});

describe('FooterSettings: a language scope', () => {
  beforeEach(() => {
    mocks.languages = [ENGLISH, french('© Acme SAS'), arabic()];
  });

  it("edits the copyright in the language's direction; the global fields are read-only and say why", async () => {
    await render(site({ ...SAVED, madeWithBadge: false }));
    expect(container.textContent).toContain('settings.footer.scope.hint');
    await chooseScope('العربية');
    expect(input('copyright').value).toBe('');
    expect(input('copyright').dir).toBe('rtl');
    expect(input('copyright').lang).toBe('ar');
    expect(input('copyright').placeholder).toBe(SAVED.copyright);
    for (const name of ['github', 'x', 'linkedin'] as const) {
      expect(input(name).disabled).toBe(true);
      expect(input(name).value).toBe(SAVED[name]);
      expect(input(name).dir).toBe('ltr');
    }
    expect(badge().getAttribute('aria-checked')).toBe('false');
    expect(badge().hasAttribute('data-disabled') || badge().getAttribute('aria-disabled') === 'true').toBe(true);
    // Each social link and the badge explain that they are global.
    expect(container.textContent?.split('settings.chrome.scope.globalField').length).toBe(5);
    await chooseScope('Français');
    expect(input('copyright').value).toBe('© Acme SAS');
    expect(input('copyright').dir).toBe('ltr');
  });

  it('saves the trimmed copyright only, and clears to footer: null; never the global fields', async () => {
    mocks.updateLanguage.mockImplementation(async ({ id, body }) => ({ ...arabic(), id, config: { ...arabic().config, ...body.config } }));
    await render(site());
    await chooseScope('العربية');
    await type(input('copyright'), '  © أكمي  ');
    await save();
    expect(lastSent(mocks.updateLanguage)).toStrictEqual({ id: 'ar', body: { config: { footer: { copyright: '© أكمي' } } } });
    expect(input('copyright').value).toBe('© أكمي');
    expect(region()).toBeNull();
    expect(status()).toBe('common.saved');
    await type(input('copyright'), ' ');
    await save();
    expect(lastSent(mocks.updateLanguage)).toStrictEqual({ id: 'ar', body: { config: { footer: null } } });
    expect(input('copyright').value).toBe('');
    expect(region()).toBeNull();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it('says why once and keeps the edits when the language save fails', async () => {
    mocks.updateLanguage.mockRejectedValueOnce(new Error('offline'));
    await render(site());
    await chooseScope('Français');
    await type(input('copyright'), '© Acme France');
    await save();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('friendly:settings.saveError');
    expect(input('copyright').value).toBe('© Acme France');
    expect(region()).not.toBeNull();
    expect(status()).toBe('');
  });

  it("a project refetch updates the read-only fields without dirtying the language's draft", async () => {
    await render(site());
    await chooseScope('العربية');
    await render(site({ ...SAVED, github: 'https://github.com/moved' }));
    expect(input('github').value).toBe('https://github.com/moved');
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('asks before dropping edits: Keep editing stays, Discard switches clean', async () => {
    await render(site());
    await click(badge());
    await chooseScope('Français');
    expect(dialog()).not.toBeNull();
    await answerDialog(false);
    expect(values().madeWithBadge).toBe(false);
    await chooseScope('Français');
    await answerDialog(true);
    expect(input('copyright').value).toBe('© Acme SAS');
    expect(region()).toBeNull();
  });

  it("A → B → A: a late save from A neither resets B's draft nor speaks, and A reopens on the server's values", async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(site());
    await type(input('copyright'), 'Project line');
    await save();
    await chooseScope('Français');
    await answerDialog(true);
    await type(input('copyright'), 'Ligne');
    await act(async () => pending.reject(new Error('late failure')));
    expect(input('copyright').value).toBe('Ligne');
    expect(region()).not.toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
    await chooseScope('settings.chrome.scope.default');
    await answerDialog(true);
    expect(values()).toStrictEqual(ALL);
    expect(region()).toBeNull();
  });
});
