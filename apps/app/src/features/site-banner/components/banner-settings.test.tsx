// @vitest-environment jsdom
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { Language, Project } from '@/hooks/api';
import type { BannerConfig } from '../model/banner';
import { BannerSettings } from './banner-settings';

const mocks = vi.hoisted(() => ({
  languages: [] as unknown[],
  updateProject: vi.fn(),
  updateLanguage: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  reportDirty: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({ data: mocks.languages, isPending: false }),
  useUpdateProjectConfig: () => ({ mutateAsync: mocks.updateProject, isPending: false }),
  useUpdateLanguage: () => ({ mutateAsync: mocks.updateLanguage, isPending: false }),
}));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: () => 'Could not save' }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const PROJECT_BANNER = { enabled: true, dismissible: true, message: 'Spring sale', linkLabel: 'Shop', linkUrl: 'https://acme.test/sale' };

const projectWith = (banner: BannerConfig | undefined) => ({ id: 'site-1', config: banner ? { banner } : {} }) as unknown as Project;
const language = (overrides: Partial<Language>) =>
  ({ code: 'en', direction: 'LTR', enabled: true, isDefault: false, position: 0, config: null, ...overrides }) as Language;
const ENGLISH = language({ id: 'en', label: 'English', isDefault: true });
const french = (banner: BannerConfig | null = null) => language({ id: 'fr', code: 'fr', label: 'Français', position: 1, config: { banner } });
const ARABIC = language({ id: 'ar', code: 'ar', label: 'العربية', direction: 'RTL', position: 2 });

/** A promise the test settles by hand, to hold a save in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

const render = (project: Project) =>
  act(async () =>
    root.render(
      <ConfirmProvider>
        <ConfigDirtyProvider report={mocks.reportDirty}>
          <BannerSettings project={project} />
        </ConfigDirtyProvider>
      </ConfirmProvider>,
    ),
  );

const buttonNamed = (name: string, scope: ParentNode = document) => {
  // A button that can show "Saving…" renders both labels, the idle one first.
  const found = [...scope.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith(name));
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
const findField = (labelKey: string) => {
  const label = [...container.querySelectorAll('label')].find((item) => item.textContent === labelKey);
  const input = label && document.getElementById(label.htmlFor);
  return input instanceof HTMLInputElement ? input : null;
};
const field = (labelKey: string) => {
  const input = findField(labelKey);
  if (!input) throw new Error(`No field labelled ${labelKey}`);
  return input;
};
const message = () => field('settings.banner.message.label');
const linkLabel = () => field('settings.banner.linkLabel.label');
const linkUrl = () => field('settings.banner.linkUrl.label');
const toggle = (titleKey: string) => {
  const title = [...container.querySelectorAll('div')].find((item) => item.textContent === titleKey && item.id);
  const control = title && container.querySelector<HTMLElement>(`[role="switch"][aria-labelledby="${title.id}"]`);
  if (!control) throw new Error(`No switch titled ${titleKey}`);
  return control;
};
const enabledSwitch = () => toggle('settings.banner.enable.title');
const dismissibleSwitch = () => toggle('settings.banner.dismissible.title');
const isOn = (control: HTMLElement) => control.getAttribute('aria-checked') === 'true';
const saveRegion = () => document.querySelector<HTMLElement>('[data-slot="save-region"]');

const type = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const click = (element: HTMLElement) => act(async () => element.click());
const save = () => click(buttonNamed('common.save', saveRegion() ?? undefined));
const discard = () => click(buttonNamed('forms.discard', saveRegion() ?? undefined));
const chooseScope = (label: string) => click(buttonNamed(label, container));
const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]');
const answerDialog = (confirm: boolean) => {
  const open = dialog();
  if (!open) throw new Error('No confirmation open');
  const confirmButton = buttonNamed('settings.chrome.scope.discardConfirm', open);
  const cancelButton = [...open.querySelectorAll('button')].find((button) => button !== confirmButton);
  if (!cancelButton) throw new Error('No cancel button');
  return click(confirm ? confirmButton : cancelButton);
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.languages = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('BannerSettings — project scope', () => {
  it('starts off and dismissible with empty text when the project has no banner', async () => {
    await render(projectWith(undefined));
    expect(isOn(enabledSwitch())).toBe(false);
    expect(findField('settings.banner.message.label')).toBeNull();
    expect(saveRegion()).toBeNull();
    await click(enabledSwitch());
    expect(isOn(dismissibleSwitch())).toBe(true);
    expect(message().value).toBe('');
  });

  it('a toggle-only change is dirty, saves the whole patch, and settles once the server confirms', async () => {
    mocks.updateProject.mockImplementation(async ({ config }) => ({ id: 'site-1', config }));
    await render(projectWith(PROJECT_BANNER));
    await click(dismissibleSwitch());
    expect(saveRegion()).not.toBeNull();
    expect(mocks.reportDirty).toHaveBeenLastCalledWith(expect.any(String), true);

    await save();
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    expect(mocks.updateProject).toHaveBeenCalledWith({ config: { banner: { ...PROJECT_BANNER, dismissible: false } } });
    expect(saveRegion()).toBeNull();
    expect(isOn(dismissibleSwitch())).toBe(false);
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('common.saved');
    expect(mocks.reportDirty).toHaveBeenLastCalledWith(expect.any(String), false);
  });

  it('trims text and leaves cleared text out of the patch', async () => {
    mocks.updateProject.mockImplementation(async ({ config }) => ({ id: 'site-1', config }));
    await render(projectWith(PROJECT_BANNER));
    await type(message(), '  Summer sale  ');
    await type(linkLabel(), '   ');
    await save();
    expect(mocks.updateProject).toHaveBeenCalledWith({
      config: { banner: { enabled: true, dismissible: true, message: 'Summer sale', linkLabel: undefined, linkUrl: 'https://acme.test/sale' } },
    });
  });

  it('shows what the server stored after a save', async () => {
    // The server merges the banner one level deep: an omitted field keeps its stored value.
    mocks.updateProject.mockResolvedValue({ id: 'site-1', config: { banner: { ...PROJECT_BANNER, message: 'Stored by the server' } } });
    await render(projectWith(PROJECT_BANNER));
    await type(message(), 'Summer sale');
    await save();
    expect(message().value).toBe('Stored by the server');
    expect(saveRegion()).toBeNull();
  });

  it('Discard puts the toggles and the text back together', async () => {
    await render(projectWith(PROJECT_BANNER));
    await type(message(), 'Summer sale');
    await click(dismissibleSwitch());
    await discard();
    expect(message().value).toBe('Spring sale');
    expect(isOn(dismissibleSwitch())).toBe(true);
    expect(saveRegion()).toBeNull();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it('a failed save keeps the draft, says so once, and can be retried', async () => {
    mocks.updateProject.mockRejectedValueOnce(new Error('offline'));
    await render(projectWith(PROJECT_BANNER));
    await type(message(), 'Summer sale');
    await click(dismissibleSwitch());
    await save();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('Could not save');
    expect(message().value).toBe('Summer sale');
    expect(isOn(dismissibleSwitch())).toBe(false);
    expect(saveRegion()).not.toBeNull();
    expect(document.body.textContent).not.toContain('common.saved');

    mocks.updateProject.mockImplementation(async ({ config }) => ({ id: 'site-1', config }));
    await save();
    expect(mocks.updateProject).toHaveBeenCalledTimes(2);
    expect(saveRegion()).toBeNull();
  });

  // Regression: the toggles used to live in useState seeded once, so a refetch
  // moved the text fields but left a stale toggle that the next save wrote back.
  it('a refetch while clean takes the server toggles and text', async () => {
    await render(projectWith(PROJECT_BANNER));
    await render(projectWith({ ...PROJECT_BANNER, dismissible: false, message: 'Summer sale' }));
    expect(isOn(dismissibleSwitch())).toBe(false);
    expect(message().value).toBe('Summer sale');
    expect(saveRegion()).toBeNull();
  });

  it('a refetch while dirty keeps the edit, takes untouched fields and flags a field both sides changed', async () => {
    await render(projectWith(PROJECT_BANNER));
    await type(message(), 'Summer sale');
    await render(projectWith({ ...PROJECT_BANNER, linkLabel: 'Browse', dismissible: false }));
    expect(message().value).toBe('Summer sale');
    expect(linkLabel().value).toBe('Browse');
    expect(isOn(dismissibleSwitch())).toBe(false);
    expect(container.textContent).not.toContain('forms.changedElsewhere');

    await render(projectWith({ ...PROJECT_BANNER, linkLabel: 'Browse', dismissible: false, message: 'Winter sale' }));
    expect(message().value).toBe('Summer sale');
    expect(container.textContent).toContain('forms.changedElsewhere');
    await click(buttonNamed('forms.useTheirs', container));
    expect(message().value).toBe('Winter sale');
    expect(container.textContent).not.toContain('forms.changedElsewhere');
    expect(saveRegion()).toBeNull();
  });

  it('keeps edits made while a save is in flight, and they stay dirty', async () => {
    const pending = deferred<unknown>();
    mocks.updateProject.mockReturnValue(pending.promise);
    await render(projectWith(PROJECT_BANNER));
    await type(message(), 'Summer sale');
    await save();
    expect(buttonNamed('forms.discard', saveRegion() ?? undefined).disabled).toBe(true);
    await type(message(), 'Summer sale, 20% off');
    await act(async () => pending.resolve({ id: 'site-1', config: { banner: { ...PROJECT_BANNER, message: 'Summer sale' } } }));
    expect(message().value).toBe('Summer sale, 20% off');
    expect(saveRegion()).not.toBeNull();
    await discard();
    expect(message().value).toBe('Summer sale');
  });

  it('gives the content its language direction and keeps the link address left to right', async () => {
    mocks.languages = [language({ id: 'ar', code: 'ar', label: 'العربية', direction: 'RTL', isDefault: true })];
    await render(projectWith(PROJECT_BANNER));
    expect(message().dir).toBe('rtl');
    expect(message().lang).toBe('ar');
    expect(linkLabel().dir).toBe('rtl');
    expect(linkUrl().dir).toBe('ltr');
  });
});

describe('BannerSettings — language scope', () => {
  beforeEach(() => {
    mocks.languages = [ENGLISH, french({ message: 'Soldes' }), ARABIC];
  });

  it("seeds text from the override only, shows the project's as placeholders, and inherits the toggles", async () => {
    await render(projectWith({ ...PROJECT_BANNER, dismissible: false }));
    await chooseScope('Français');
    expect(message().value).toBe('Soldes');
    expect(linkLabel().value).toBe('');
    expect(linkLabel().placeholder).toBe('Shop');
    expect(linkUrl().placeholder).toBe('https://acme.test/sale');
    expect(isOn(enabledSwitch())).toBe(true);
    expect(isOn(dismissibleSwitch())).toBe(false);
    expect(message().lang).toBe('fr');
  });

  it('writes Arabic content right to left and the link address left to right', async () => {
    await render(projectWith(PROJECT_BANNER));
    await chooseScope('العربية');
    expect(message().dir).toBe('rtl');
    expect(linkLabel().dir).toBe('rtl');
    expect(linkUrl().dir).toBe('ltr');
  });

  it('sends only nonempty trimmed text and the toggles that differ, keeping an explicit false', async () => {
    mocks.updateLanguage.mockImplementation(async ({ id, body }) => ({ id, config: body.config }));
    await render(projectWith(PROJECT_BANNER));
    await chooseScope('Français');
    await type(linkLabel(), '  Voir  ');
    await click(dismissibleSwitch());
    await save();
    expect(mocks.updateLanguage).toHaveBeenCalledWith({
      id: 'fr',
      body: { config: { banner: { message: 'Soldes', linkLabel: 'Voir', dismissible: false } } },
    });
    expect(saveRegion()).toBeNull();

    await click(enabledSwitch());
    await save();
    expect(mocks.updateLanguage).toHaveBeenLastCalledWith({
      id: 'fr',
      body: { config: { banner: { message: 'Soldes', linkLabel: 'Voir', enabled: false, dismissible: false } } },
    });
  });

  it('clears the override to null when nothing differs from the project', async () => {
    mocks.updateLanguage.mockImplementation(async ({ id, body }) => ({ id, config: body.config }));
    await render(projectWith(PROJECT_BANNER));
    await chooseScope('Français');
    await type(message(), '   ');
    await save();
    expect(mocks.updateLanguage).toHaveBeenCalledWith({ id: 'fr', body: { config: { banner: null } } });
    expect(message().value).toBe('');
    expect(message().placeholder).toBe('Spring sale');
    expect(saveRegion()).toBeNull();
  });

  it('a failed save keeps the draft and says so once', async () => {
    mocks.updateLanguage.mockRejectedValueOnce(new Error('offline'));
    await render(projectWith(PROJECT_BANNER));
    await chooseScope('Français');
    await type(message(), 'Soldes d’été');
    await click(dismissibleSwitch());
    await save();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(message().value).toBe('Soldes d’été');
    expect(isOn(dismissibleSwitch())).toBe(false);
    expect(saveRegion()).not.toBeNull();
    expect(document.body.textContent).not.toContain('common.saved');
  });

  it("follows a project toggle change it inherits, and the language's own refetch", async () => {
    await render(projectWith(PROJECT_BANNER));
    await chooseScope('Français');
    await render(projectWith({ ...PROJECT_BANNER, dismissible: false }));
    expect(isOn(dismissibleSwitch())).toBe(false);
    mocks.languages = [ENGLISH, french({ message: 'Promotions' }), ARABIC];
    await render(projectWith({ ...PROJECT_BANNER, dismissible: false }));
    expect(message().value).toBe('Promotions');
    expect(saveRegion()).toBeNull();
  });
});

describe('BannerSettings — switching scope', () => {
  beforeEach(() => {
    mocks.languages = [ENGLISH, french({ message: 'Soldes' })];
  });

  it('switches without asking while clean', async () => {
    await render(projectWith(PROJECT_BANNER));
    await chooseScope('Français');
    expect(dialog()).toBeNull();
    expect(message().value).toBe('Soldes');
  });

  it('asks before dropping edits: Keep editing stays, Discard switches to the other scope clean', async () => {
    await render(projectWith(PROJECT_BANNER));
    await click(dismissibleSwitch());
    await chooseScope('Français');
    expect(dialog()).not.toBeNull();
    await answerDialog(false);
    expect(message().value).toBe('Spring sale');
    expect(isOn(dismissibleSwitch())).toBe(false);

    await chooseScope('Français');
    await answerDialog(true);
    expect(message().value).toBe('Soldes');
    expect(isOn(dismissibleSwitch())).toBe(true);
    expect(saveRegion()).toBeNull();
  });

  it("a late success from the previous scope can't reset the new scope's draft", async () => {
    const pending = deferred<unknown>();
    mocks.updateProject.mockReturnValue(pending.promise);
    await render(projectWith(PROJECT_BANNER));
    await type(message(), 'Summer sale');
    await save();
    // A save in flight still counts as unsaved: the switch asks.
    await chooseScope('Français');
    await answerDialog(true);
    await type(message(), 'Soldes d’été');

    await act(async () => pending.resolve({ id: 'site-1', config: { banner: { ...PROJECT_BANNER, message: 'Summer sale' } } }));
    expect(message().value).toBe('Soldes d’été');
    expect(saveRegion()).not.toBeNull();
  });

  it("a late failure from the previous scope says nothing and leaves the new scope's draft", async () => {
    const pending = deferred<unknown>();
    mocks.updateProject.mockReturnValue(pending.promise);
    await render(projectWith(PROJECT_BANNER));
    await type(message(), 'Summer sale');
    await save();
    await chooseScope('Français');
    await answerDialog(true);
    await type(message(), 'Soldes d’été');

    await act(async () => pending.reject(new Error('offline')));
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(message().value).toBe('Soldes d’été');
    expect(saveRegion()).not.toBeNull();
  });
});
