// @vitest-environment jsdom
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { computeAccessibleName } from 'dom-accessibility-api';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Language, Project } from '@/hooks/api';
import type { NavbarConfig } from '../model/navbar';
import { NavbarSettings } from './navbar-settings';

const mocks = vi.hoisted(() => ({
  languages: [] as unknown[],
  updateProject: vi.fn(),
  updateLanguage: vi.fn(),
  /** Every Undo offered through the real toast, so a test can click one late, after its toast left the screen. */
  undoActions: [] as Array<() => void>,
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
// The real Sonner: toasts render in its Toaster. Only the call is recorded.
vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>();
  const toast = Object.assign((message: string, options?: { action?: { onClick: (event: unknown) => void } }) => {
    const action = options?.action;
    if (action) mocks.undoActions.push(() => action.onClick({}));
    return actual.toast(message, options as never);
  }, actual.toast);
  return { ...actual, toast };
});
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({ data: mocks.languages, isPending: false }),
  useUpdateProjectConfig: () => ({
    mutateAsync: mocks.updateProject,
    // main's form saved through `mutate` (saveConfigSection); kept so this suite also runs against it.
    mutate: (variables: unknown, options: { onSuccess: () => void; onError: (error: unknown) => void }) =>
      Promise.resolve(mocks.updateProject(variables)).then(options.onSuccess, options.onError),
    isPending: false,
  }),
  useUpdateLanguage: () => ({ mutateAsync: mocks.updateLanguage, isPending: false }),
}));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: (_t: unknown, _error: unknown, fallback: string) => `friendly:${fallback}` }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SAVED: NavbarConfig = {
  ctaLabel: 'Book a demo',
  ctaUrl: 'https://example.com/demo',
  links: [
    { label: 'Docs', href: '/docs' },
    { label: 'Blog', href: 'https://blog.example.com', external: true },
  ],
  tabs: [{ label: 'Guides', href: '/guides', external: false }],
  anchors: [{ label: 'Community', href: 'https://community.example.com', icon: 'users' }],
  showSearch: true,
  changelog: false,
};
/** A site as the project query returns it, other sections riding along. */
const site = (navbar: NavbarConfig | undefined = SAVED, id = 'site-a') =>
  ({ id, name: 'Acme', config: { theme: { preset: 'nib' }, footer: { copyright: '© Acme' }, ...(navbar ? { navbar } : {}) } }) as unknown as Project;
/**
 * A server that keeps what it stores: each navbar patch merges into it one
 * level deep (a key the patch leaves out is kept), as the API does, and the
 * answer is the whole project. A test can change `server.navbar` itself, as
 * another writer would.
 */
const storeWhatWasSent = (stored: NavbarConfig | undefined = SAVED, id = 'site-a') => {
  const server = { navbar: structuredClone(stored ?? {}) };
  mocks.updateProject.mockImplementation(async ({ config }: { config: { navbar: NavbarConfig } }) => {
    server.navbar = { ...server.navbar, ...JSON.parse(JSON.stringify(config.navbar)) };
    return site(structuredClone(server.navbar), id);
  });
  return server;
};

const language = (overrides: Partial<Language>) =>
  ({ code: 'en', direction: 'LTR', enabled: true, isDefault: false, position: 0, config: null, ...overrides }) as Language;
const ENGLISH = language({ id: 'en', label: 'English', isDefault: true });
/** Arabic, with SEO, a footer and a banner of its own that belong to other forms. */
const arabic = (navbar?: NavbarConfig) =>
  language({
    id: 'ar',
    code: 'ar',
    label: 'العربية',
    direction: 'RTL',
    position: 1,
    config: { seo: { metaTitle: 'توثيق' }, footer: { copyright: '© أكمي' }, ...(navbar ? { navbar } : {}) },
  });
const french = () => language({ id: 'fr', code: 'fr', label: 'Français', position: 2 });

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

const render = (project: Project) =>
  act(async () =>
    root.render(
      <ConfirmProvider>
        <NavbarSettings project={project} />
        <Toaster />
      </ConfirmProvider>,
    ),
  );

beforeEach(() => {
  mocks.languages = [];
  mocks.undoActions.length = 0;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

type List = 'links' | 'tabs' | 'anchors';
/** The control a visible label names: found through the label, as a person and a screen reader find it. */
const labelled = (text: string, scope: ParentNode = container) =>
  [...scope.querySelectorAll('label')]
    .filter((label) => label.textContent === text)
    .map((label) => document.getElementById(label.htmlFor))
    .filter((control): control is HTMLInputElement => control instanceof HTMLInputElement);
const ctaLabel = () => labelled('settings.navbar.ctaLabel.label')[0] as HTMLInputElement;
const ctaUrl = () => labelled('settings.navbar.ctaUrl.label')[0] as HTMLInputElement;
const listOf = (list: List) => {
  const heading = [...container.querySelectorAll('span')].find((span) => span.textContent === `settings.navbar.${list}.label`);
  return heading ? container.querySelector<HTMLElement>(`[aria-labelledby="${heading.id}"]`) : null;
};
const rowsOf = (list: List) => [...(listOf(list)?.querySelectorAll('li') ?? [])];
const labelInput = (list: List, row: number) =>
  labelled('settings.banner.linkLabel.label', rowsOf(list)[row] ?? document.createElement('i'))[0] ?? null;
const hrefInput = (list: List, row: number) => labelled('editor.format.linkPrompt', rowsOf(list)[row] ?? document.createElement('i'))[0] ?? null;
const iconInput = (row: number) => labelled('settings.general.icon.label', rowsOf('anchors')[row] ?? document.createElement('i'))[0] ?? null;
// Found by their own label, so the regression tests also run against main's component.
const removeButtons = (list: List) => [...container.querySelectorAll<HTMLButtonElement>(`button[aria-label="settings.navbar.${list}.remove"]`)];
const removeButton = (list: List, row: number) => removeButtons(list)[row] ?? null;
const addButton = (list: List) => buttonNamed(`settings.navbar.${list}.add`);
const shown = (list: List) => rowsOf(list).map((_, row) => [labelInput(list, row)?.value, hrefInput(list, row)?.value]);
const toggle = (title: string) => {
  const titleEl = [...container.querySelectorAll('div')].find((el) => el.textContent === title);
  const control = titleEl && container.querySelector<HTMLElement>(`[role="switch"][aria-labelledby="${titleEl.id}"]`);
  if (!control) throw new Error(`No switch ${title}`);
  return control;
};
const searchSwitch = () => toggle('settings.navbar.showSearch.title');
const changelogSwitch = () => toggle('settings.navbar.changelog.title');
const checked = (control: HTMLElement) => control.getAttribute('aria-checked') === 'true';

const type = (el: HTMLInputElement | null, text: string) =>
  act(async () => {
    if (!el) throw new Error('No such field');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const click = (el: HTMLElement | null) =>
  act(async () => {
    if (!el) throw new Error('Nothing to click');
    el.click();
  });
const buttonNamed = (name: string, scope: ParentNode = container) => {
  // A button that can show "Saving…" renders both labels, the idle one first; the form's own Enter target is hidden.
  const found = [...scope.querySelectorAll('button')].find((button) => !button.hidden && button.textContent?.trim().startsWith(name));
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
const region = () => container.querySelector<HTMLElement>('[data-slot="save-region"]');
const save = () => click(buttonNamed('common.save', region() ?? container));
const discard = () => click(buttonNamed('forms.discard', region() ?? undefined));
const status = () => container.querySelector('[role="status"][aria-live="polite"]')?.textContent?.trim() ?? '';
const conflict = () => container.textContent?.includes('forms.changedElsewhere');
const chooseScope = (label: string) => click(buttonNamed(label));
const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]');
const answerDialog = (confirm: boolean) => {
  const open = dialog();
  if (!open) throw new Error('No confirmation open');
  const confirmButton = buttonNamed('settings.chrome.scope.discardConfirm', open);
  const cancelButton = [...open.querySelectorAll('button')].find((button) => button !== confirmButton);
  return click(confirm ? confirmButton : (cancelButton ?? null));
};
/** The last request body as it goes over the wire: JSON drops `undefined`. */
const lastSent = (mock: typeof mocks.updateProject) => JSON.parse(JSON.stringify(mock.mock.calls.at(-1)?.[0]));
const sentNavbar = () => lastSent(mocks.updateProject).config.navbar;
/** The Undo button of the newest toast on screen (the real Sonner toast). */
const undoOnScreen = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-sonner-toast]:not([data-removed="true"]) button')].find(
    (button) => button.textContent === 'settings.theme.undo',
  ) ?? null;
/** Undo as a person takes it: focus moves into the toast (a click or its hotkey), then the button is pressed. */
const pressUndo = () =>
  act(async () => {
    const undo = undoOnScreen();
    if (!undo) throw new Error('No Undo on screen');
    undo.focus();
    undo.click();
  });
/** Lets Sonner apply what it queued: it adds a toast on a timer and dismisses one on an animation frame. */
const toastsSettled = async () => {
  for (let tick = 0; tick < 10; tick += 1) await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
};
/** Clicks the newest offered Undo, even after its toast left the screen (a click during its exit). */
const clickLateUndo = () =>
  act(async () => {
    const undo = mocks.undoActions.at(-1);
    if (!undo) throw new Error('No Undo offered');
    undo();
  });
const pressEnter = async (input: HTMLInputElement | null, init: KeyboardEventInit = {}) => {
  await act(async () => {
    if (!input) throw new Error('No such field');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
    // The browser's implicit submission: a click on the form's default button.
    input.form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
};
const pressSaveShortcut = (init: KeyboardEventInit = { ctrlKey: true }) =>
  act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true, ...init }));
  });

describe('NavbarSettings — fields and names', () => {
  it('shows the stored navbar with every row field labelled, addresses and icons left to right, and no save bar', async () => {
    await render(site());
    expect(ctaLabel().value).toBe('Book a demo');
    expect(ctaUrl().value).toBe('https://example.com/demo');
    expect(shown('links')).toEqual([
      ['Docs', '/docs'],
      ['Blog', 'https://blog.example.com'],
    ]);
    expect(shown('tabs')).toEqual([['Guides', '/guides']]);
    expect(iconInput(0)?.value).toBe('users');
    expect([hrefInput('links', 0), hrefInput('anchors', 0), iconInput(0), ctaUrl()].every((input) => input?.dir === 'ltr')).toBe(true);
    expect(labelInput('links', 0)?.dir).toBe('auto');
    expect(checked(searchSwitch())).toBe(true);
    expect(checked(changelogSwitch())).toBe(false);
    expect(region()).toBeNull();
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
  });

  it('computes each field name from its label and each Remove name from its row', async () => {
    await render(site());
    expect(computeAccessibleName(labelInput('links', 1) as HTMLInputElement)).toBe('settings.banner.linkLabel.label');
    expect(computeAccessibleName(hrefInput('tabs', 0) as HTMLInputElement)).toBe('editor.format.linkPrompt');
    expect(computeAccessibleName(iconInput(0) as HTMLInputElement)).toBe('settings.general.icon.label');
    expect(computeAccessibleName(removeButton('links', 1) as HTMLButtonElement)).toBe('settings.navbar.links.remove Blog');
    expect(computeAccessibleName(removeButton('tabs', 0) as HTMLButtonElement)).toBe('settings.navbar.tabs.remove Guides');
    expect(computeAccessibleName(removeButton('anchors', 0) as HTMLButtonElement)).toBe('settings.navbar.anchors.remove Community');
    // No input borrows its name through aria-labelledby (#751).
    expect(container.querySelector('input[aria-labelledby]')).toBeNull();
    // A row without a label is named by its address, then by its position.
    await type(labelInput('links', 1), '');
    expect(computeAccessibleName(removeButton('links', 1) as HTMLButtonElement)).toBe('settings.navbar.links.remove https://blog.example.com');
    await click(addButton('tabs'));
    expect(computeAccessibleName(removeButton('tabs', 1) as HTMLButtonElement)).toBe('settings.navbar.tabs.remove 2');
  });
});

describe('NavbarSettings — the project scope saves', () => {
  it('sends only what changed: a cleared CTA text as "", an untouched field not at all', async () => {
    const server = storeWhatWasSent();
    await render(site());
    await type(ctaLabel(), '');
    await save();
    expect(sentNavbar()).toStrictEqual({ ctaLabel: '' });
    expect(server.navbar).toStrictEqual({ ...SAVED, ctaLabel: '' });
    await type(ctaUrl(), '   ');
    await save();
    expect(sentNavbar()).toStrictEqual({ ctaUrl: '' });
  });

  it("another writer's CTA, set during this save whose refetch then fails, survives a later link-only save", async () => {
    const server = storeWhatWasSent({ links: [] });
    await render(site({ links: [] }));
    await click(addButton('links'));
    await type(labelInput('links', 0), 'Docs');
    await type(hrefInput('links', 0), '/docs');
    const pending = deferred<void>();
    mocks.updateProject.mockImplementationOnce(async ({ config }: { config: { navbar: NavbarConfig } }) => {
      await pending.promise;
      server.navbar = { ...server.navbar, ...JSON.parse(JSON.stringify(config.navbar)) };
      const answer = site(structuredClone(server.navbar));
      // Someone else sets the CTA right after this save; the refetch that would show it fails.
      server.navbar = { ...server.navbar, ctaLabel: 'Talk to sales', ctaUrl: '/sales' };
      return answer;
    });
    await save();
    await act(async () => pending.resolve());
    expect(sentNavbar()).toStrictEqual({ links: [{ label: 'Docs', href: '/docs' }] });
    // The form never saw their CTA. Editing only a link sends only the links.
    await type(labelInput('links', 0), 'Documentation');
    await save();
    expect(sentNavbar()).toStrictEqual({ links: [{ label: 'Documentation', href: '/docs' }] });
    expect(server.navbar).toMatchObject({ ctaLabel: 'Talk to sales', ctaUrl: '/sales' });
  });

  it('CTA saved and its refetch fails: clearing it in the same scope sends "", judged against the confirmed save', async () => {
    const server = storeWhatWasSent({ links: [] });
    await render(site({ links: [] }));
    await type(ctaLabel(), 'Start');
    await save();
    // The project query still shows no CTA; the form's baseline is what the PATCH confirmed.
    await type(ctaLabel(), '');
    await save();
    expect(sentNavbar()).toStrictEqual({ ctaLabel: '' });
    expect(server.navbar).toStrictEqual({ links: [], ctaLabel: '' });
  });

  it('CTA saved, its refetch fails, a scope round trip: an edit elsewhere leaves the stored CTA alone', async () => {
    mocks.languages = [ENGLISH, arabic()];
    // The PATCH stores the CTA; the project query keeps the old navbar because its refetch failed.
    const server = storeWhatWasSent({ links: [] });
    await render(site({ links: [] }));
    await type(ctaLabel(), 'Start');
    await type(ctaUrl(), '/start');
    await save();
    expect(sentNavbar()).toStrictEqual({ ctaLabel: 'Start', ctaUrl: '/start' });
    await chooseScope('العربية');
    await chooseScope('settings.chrome.scope.default');
    // Back on the stale query, the form shows no CTA: typing and clearing it is no change from that read...
    await type(ctaLabel(), 'x');
    await type(ctaLabel(), '');
    expect(region()).toBeNull();
    // ...so another edit leaves the CTA out, and the server keeps the stored one rather than losing it.
    await click(changelogSwitch());
    await save();
    expect(sentNavbar()).toStrictEqual({ changelog: true });
    expect(server.navbar).toMatchObject({ ctaLabel: 'Start', ctaUrl: '/start' });
  });

  it('a newer read without the CTA wins over an earlier save: editing another field sends only that field', async () => {
    const server = storeWhatWasSent({ links: [] });
    await render(site({ links: [] }));
    await type(ctaLabel(), 'Start');
    await save();
    // Someone else cleared the CTA afterwards; the form is clean, so it shows their read.
    server.navbar = { links: [], ctaLabel: '' };
    await render(site({ links: [], ctaLabel: '' }));
    expect(ctaLabel().value).toBe('');
    await click(searchSwitch());
    await save();
    expect(sentNavbar()).toStrictEqual({ showSearch: false });
    expect(server.navbar).toStrictEqual({ links: [], ctaLabel: '', showSearch: false });
  });

  it("a late save for one site never reaches another site's form or payload (A → B → A)", async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(site({ links: [] }, 'site-a'));
    await type(ctaLabel(), 'Start');
    await save();
    // The host shows another site before the save answers.
    await render(site({ ctaLabel: 'B', links: [] }, 'site-b'));
    await act(async () => pending.resolve(site({ ctaLabel: 'Start', links: [] }, 'site-a')));
    expect(ctaLabel().value).toBe('B');
    expect(region()).toBeNull();
    expect(status()).not.toBe('common.saved');
    storeWhatWasSent({ ctaLabel: 'B', links: [] }, 'site-b');
    await click(changelogSwitch());
    await save();
    expect(sentNavbar()).toStrictEqual({ changelog: true });
    // Back on site A: its own read, clean.
    await render(site({ ctaLabel: 'Start', links: [] }, 'site-a'));
    expect([ctaLabel().value, region()]).toEqual(['Start', null]);
  });

  it('removing the last row of every list sends [] for each; kept rows keep their metadata', async () => {
    const server = storeWhatWasSent();
    await render(site());
    await click(removeButton('tabs', 0));
    await click(removeButton('anchors', 0));
    await click(removeButton('links', 0));
    await save();
    expect(sentNavbar()).toStrictEqual({ links: [{ label: 'Blog', href: 'https://blog.example.com', external: true }], tabs: [], anchors: [] });
    await click(removeButton('links', 0));
    await save();
    expect(sentNavbar()).toStrictEqual({ links: [] });
    expect(server.navbar).toStrictEqual({ ...SAVED, links: [], tabs: [], anchors: [] });
  });

  it('sends row text as typed, drops only fully blank rows, sends half-filled ones and trims the icon', async () => {
    storeWhatWasSent();
    await render(site());
    await type(labelInput('links', 0), '  Docs  ');
    await click(addButton('links'));
    await click(addButton('links'));
    await type(labelInput('links', 3), 'Half');
    await type(iconInput(0), '  users  ');
    await click(addButton('anchors'));
    await type(iconInput(1), 'ghost');
    await save();
    expect(sentNavbar()).toStrictEqual({
      links: [
        { label: '  Docs  ', href: '/docs' },
        { label: 'Blog', href: 'https://blog.example.com', external: true },
        { label: 'Half', href: '' },
      ],
      anchors: [{ label: 'Community', href: 'https://community.example.com', icon: 'users' }],
    });
    // Its own echo: the trimmed icon and the filtered rows are not "changed elsewhere", and nothing is left to save.
    expect(conflict()).toBe(false);
    expect(region()).toBeNull();
    expect(iconInput(0)?.value).toBe('users');
    expect(rowsOf('anchors')).toHaveLength(1);
  });

  it('a switch-only edit dirties, saves the explicit value and discards back', async () => {
    storeWhatWasSent();
    await render(site());
    await click(searchSwitch());
    expect(region()).not.toBeNull();
    await discard();
    expect(checked(searchSwitch())).toBe(true);
    expect(region()).toBeNull();
    await click(searchSwitch());
    await save();
    expect(sentNavbar()).toStrictEqual({ showSearch: false });
    expect(region()).toBeNull();
    expect(checked(searchSwitch())).toBe(false);
  });

  it('a refetched switch updates a clean form, and a dirty one keeps its edit', async () => {
    await render(site());
    await render(site({ ...SAVED, showSearch: false, changelog: true }));
    expect([checked(searchSwitch()), checked(changelogSwitch())]).toEqual([false, true]);
    await type(ctaLabel(), 'Talk to us');
    await render(site({ ...SAVED, showSearch: true, changelog: true }));
    expect(checked(searchSwitch())).toBe(true);
    expect(ctaLabel().value).toBe('Talk to us');
    expect(conflict()).toBe(false);
  });

  it('a failed save keeps the draft and its Undo, says why once, and claims nothing', async () => {
    mocks.updateProject.mockRejectedValueOnce(new Error('nope'));
    await render(site());
    await click(removeButton('links', 0));
    await save();
    expect(shown('links')).toEqual([['Blog', 'https://blog.example.com']]);
    expect(document.body.textContent).toContain('friendly:settings.saveError');
    expect(status()).not.toBe('common.saved');
    await pressUndo();
    expect(shown('links')[0]).toEqual(['Docs', '/docs']);
  });

  it('edits and a new blank row made during a save survive it and stay unsaved', async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(site());
    await type(ctaLabel(), 'Start');
    await save();
    await type(labelInput('links', 0), 'Documentation');
    await click(addButton('tabs'));
    await act(async () => pending.resolve(site({ ...SAVED, ctaLabel: 'Start' })));
    expect(ctaLabel().value).toBe('Start');
    expect(labelInput('links', 0)?.value).toBe('Documentation');
    expect(rowsOf('tabs')).toHaveLength(2);
    expect(region()).not.toBeNull();
  });

  it('a save that leaves the draft unsettled keeps it and its conflict on screen', async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(site());
    await type(ctaLabel(), 'Sent');
    await save();
    await type(ctaLabel(), 'Newer');
    // Someone else's save renders before ours answers.
    await render(site({ ...SAVED, ctaLabel: 'Theirs' }));
    expect(conflict()).toBe(true);
    await act(async () => pending.resolve(site({ ...SAVED, ctaLabel: 'Sent' })));
    expect(ctaLabel().value).toBe('Newer');
    expect(conflict()).toBe(true);
    expect(region()).not.toBeNull();
    await click(buttonNamed('forms.useTheirs'));
    expect(ctaLabel().value).toBe('Theirs');
  });

  it('another site starts clean, and coming back shows that site as stored (A → B → A)', async () => {
    await render(site(SAVED, 'site-a'));
    await type(ctaLabel(), 'Draft for A');
    await click(removeButton('links', 0));
    await render(site({ ctaLabel: 'B', links: [] }, 'site-b'));
    expect([ctaLabel().value, rowsOf('links').length, region()]).toEqual(['B', 0, null]);
    await render(site(SAVED, 'site-a'));
    expect([ctaLabel().value, rowsOf('links').length, region()]).toEqual(['Book a demo', 2, null]);
    await clickLateUndo();
    expect(rowsOf('links')).toHaveLength(2);
  });

  it('a real change elsewhere offers Use theirs and Keep mine', async () => {
    await render(site());
    await type(ctaLabel(), 'Mine');
    await render(site({ ...SAVED, ctaLabel: 'Theirs' }));
    expect(conflict()).toBe(true);
    await click(buttonNamed('forms.keepMine'));
    expect(ctaLabel().value).toBe('Mine');
    expect(conflict()).toBe(false);
    await render(site({ ...SAVED, ctaLabel: 'Theirs again' }));
    await click(buttonNamed('forms.useTheirs'));
    expect(ctaLabel().value).toBe('Theirs again');
    expect(region()).toBeNull();
  });
});

describe('NavbarSettings — a language scope', () => {
  beforeEach(() => {
    mocks.languages = [ENGLISH, arabic({ ctaLabel: 'احجز', links: [{ label: 'التوثيق', href: '/docs' }] }), french()];
  });

  it("shows the project's CTA URL and switches read-only, and writes labels in the language's direction", async () => {
    await render(site());
    await chooseScope('العربية');
    expect(ctaLabel().value).toBe('احجز');
    expect(ctaLabel().dir).toBe('rtl');
    expect(labelInput('links', 0)?.dir).toBe('rtl');
    expect(hrefInput('links', 0)?.dir).toBe('ltr');
    expect(ctaUrl().disabled).toBe(true);
    expect(ctaUrl().value).toBe('https://example.com/demo');
    expect(searchSwitch().hasAttribute('data-disabled') || searchSwitch().getAttribute('aria-disabled') === 'true').toBe(true);
    expect(container.textContent).toContain('settings.chrome.scope.globalField');
    expect(rowsOf('tabs')).toHaveLength(0);
  });

  it('saves the full override with its non-empty pieces only, never a global field', async () => {
    mocks.updateLanguage.mockImplementation(async ({ body }) => arabic(body.config.navbar ?? undefined));
    await render(site());
    await chooseScope('العربية');
    await type(ctaLabel(), ' ابدأ ');
    await click(addButton('tabs'));
    await save();
    expect(lastSent(mocks.updateLanguage)).toStrictEqual({
      id: 'ar',
      body: { config: { navbar: { ctaLabel: 'ابدأ', links: [{ label: 'التوثيق', href: '/docs' }] } } },
    });
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(region()).toBeNull();
  });

  it('every piece emptied sends navbar: null, so the language falls back to the project navbar', async () => {
    mocks.updateLanguage.mockImplementation(async () => arabic());
    await render(site());
    await chooseScope('العربية');
    await type(ctaLabel(), '');
    await click(removeButton('links', 0));
    await save();
    expect(lastSent(mocks.updateLanguage)).toStrictEqual({ id: 'ar', body: { config: { navbar: null } } });
    expect(region()).toBeNull();
    expect(ctaLabel().placeholder).toBe('Book a demo');
  });

  it('asks before leaving a dirty scope; staying keeps the draft, leaving starts the other scope clean', async () => {
    await render(site());
    await chooseScope('العربية');
    await type(ctaLabel(), 'مسودة');
    await chooseScope('Français');
    await answerDialog(false);
    expect(ctaLabel().value).toBe('مسودة');
    await chooseScope('Français');
    await answerDialog(true);
    expect(ctaLabel().value).toBe('');
    expect(region()).toBeNull();
    await chooseScope('settings.chrome.scope.default');
    expect(ctaLabel().value).toBe('Book a demo');
  });
});

describe('NavbarSettings — Undo', () => {
  it('Add, Remove and Undo keep focus in the list, and Undo restores the row as it was beside newer edits', async () => {
    await render(site());
    await click(addButton('links'));
    expect(document.activeElement).toBe(labelInput('links', 2));
    await type(labelInput('links', 2), 'Pricing');
    await click(removeButton('links', 1));
    expect(document.activeElement).toBe(removeButton('links', 1));
    await type(labelInput('links', 0), 'Documentation');
    await pressUndo();
    expect(shown('links')).toEqual([
      ['Documentation', '/docs'],
      ['Blog', 'https://blog.example.com'],
      ['Pricing', ''],
    ]);
    expect(document.activeElement).toBe(labelInput('links', 1));
    // Restored with its `external`.
    storeWhatWasSent();
    await save();
    expect(sentNavbar().links[1]).toStrictEqual({ label: 'Blog', href: 'https://blog.example.com', external: true });
  });

  it('removing the only row moves focus to Add; Undo puts an anchor back with its icon', async () => {
    await render(site());
    await click(removeButton('anchors', 0));
    expect(rowsOf('anchors')).toHaveLength(0);
    expect(document.activeElement).toBe(addButton('anchors'));
    await pressUndo();
    expect(iconInput(0)?.value).toBe('users');
    expect(document.activeElement).toBe(labelInput('anchors', 0));
  });

  it('a late Undo after a successful save restores nothing', async () => {
    storeWhatWasSent();
    await render(site());
    await click(removeButton('links', 0));
    await pressEnter(ctaLabel());
    expect(sentNavbar().links).toHaveLength(1);
    await clickLateUndo();
    expect(removeButtons('links')).toHaveLength(1);
    await toastsSettled();
    expect(undoOnScreen()).toBeNull();
    expect(region()).toBeNull();
  });

  it('a late Undo after a refetch, a discard, Use theirs, a scope change or a site change restores nothing', async () => {
    mocks.languages = [ENGLISH, arabic({ links: [{ label: 'التوثيق', href: '/docs' }] })];
    await render(site());
    // Refetch: the server's values replace the baseline.
    await click(removeButton('links', 0));
    await render(site({ ...SAVED, changelog: true }));
    await clickLateUndo();
    expect(rowsOf('links')).toHaveLength(1);
    // Discard.
    await discard();
    await click(removeButton('links', 0));
    await discard();
    await clickLateUndo();
    expect(rowsOf('links')).toHaveLength(2);
    expect(region()).toBeNull();
    // Scope change: a project row never lands in the Arabic override.
    await click(removeButton('links', 0));
    await chooseScope('العربية');
    await answerDialog(true);
    await clickLateUndo();
    expect(shown('links')).toEqual([['التوثيق', '/docs']]);
    // ...nor back in the project scope it came from.
    await chooseScope('settings.chrome.scope.default');
    await clickLateUndo();
    expect(rowsOf('links')).toHaveLength(2);
    // Site change.
    await click(removeButton('tabs', 0));
    await render(site({ ...SAVED, tabs: [{ label: 'B tab', href: '/b' }] }, 'site-b'));
    await clickLateUndo();
    expect(shown('tabs')).toEqual([['B tab', '/b']]);
  });

  it('Use theirs retires Undo for the list it replaces', async () => {
    await render(site());
    await click(removeButton('links', 0));
    await render(site({ ...SAVED, links: [{ label: 'Theirs', href: '/theirs' }] }));
    await click(buttonNamed('forms.useTheirs'));
    await clickLateUndo();
    expect(shown('links')).toEqual([['Theirs', '/theirs']]);
  });

  it('Undo is gone once the section unmounts', async () => {
    await render(site());
    await click(removeButton('links', 0));
    expect(undoOnScreen()).not.toBeNull();
    await act(async () => root.render(<Toaster />));
    await clickLateUndo();
    expect(container.querySelector('input')).toBeNull();
  });
});

describe('NavbarSettings — saving keys, lock and refusal', () => {
  it('Enter in a field and Ctrl+S save once; IME, Shift+Enter and Alt+Ctrl+S do not', async () => {
    storeWhatWasSent();
    await render(site());
    await type(ctaLabel(), 'Start');
    await pressEnter(ctaLabel(), { isComposing: true });
    await pressEnter(ctaLabel(), { shiftKey: true });
    await pressSaveShortcut({ ctrlKey: true, altKey: true });
    expect(mocks.updateProject).not.toHaveBeenCalled();
    await pressEnter(labelInput('links', 0));
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    expect(status()).toBe('common.saved');
    await type(ctaLabel(), 'Begin');
    await pressSaveShortcut();
    expect(mocks.updateProject).toHaveBeenCalledTimes(2);
  });

  it('one save at a time: Ctrl+S during a save sends nothing more', async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(site());
    await type(ctaLabel(), 'Start');
    await pressSaveShortcut();
    await pressSaveShortcut();
    await pressEnter(ctaLabel());
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(site({ ...SAVED, ctaLabel: 'Start' })));
    expect(status()).toBe('common.saved');
  });

  it('a refused address is never sent: the field is marked and focused, with the validator saying why', async () => {
    await render(site());
    await type(hrefInput('links', 1), 'javascript:alert(1)');
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    await pressSaveShortcut();
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(hrefInput('links', 1)?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(hrefInput('links', 1));
    expect(status()).toBe('forms.fixHighlighted');
    const described = document.getElementById(hrefInput('links', 1)?.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe('Unsupported URL scheme.');
    storeWhatWasSent();
    await type(hrefInput('links', 1), 'https://blog.example.com/news');
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    await pressSaveShortcut();
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
  });

  it('a problem shows once its field is left, not while typing in an untouched form', async () => {
    await render(site());
    await type(ctaUrl(), 'vbscript:x');
    expect(ctaUrl().getAttribute('aria-invalid')).toBeNull();
    await act(async () => {
      ctaUrl().focus();
      ctaUrl().blur();
    });
    expect(ctaUrl().getAttribute('aria-invalid')).toBe('true');
  });
});
