// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { ProjectAddon } from '@/hooks/api/types';
import { AddonsSettings } from './addons-settings';

const translations: Record<string, string> = {
  'settings.addons.feedback.placement.afterContent': 'بعد محتوى الصفحة',
  'settings.addons.feedback.presentation.card': 'بطاقة',
  'settings.addons.consent.placement.end': 'أسفل النهاية',
  'settings.addons.consent.presentation.comfortable': 'مريحة',
  'settings.addons.consent.buttons.inline': 'جنبًا إلى جنب',
};

const availability = {
  state: 'available',
  plans: ['free'],
  available: true,
  schemaVersion: 1,
  projectId: 'site-1',
  availability: 'complete',
  decision: 'enabled',
  planKey: 'free',
  source: 'plan',
  limit: null,
  meterKey: null,
  behavior: 'observe',
  enforcement: 'advisory',
} as const;
const addons = [
  {
    id: 'feedback',
    group: 'engagement',
    enabled: true,
    config: { placement: 'after-content', presentation: 'card' },
    revision: 3,
    updatedAt: null,
    status: 'active',
    availability: { ...availability, entitlement: 'addons.feedback', capabilityKey: 'addons.feedback' },
  },
  {
    id: 'edit-suggestions',
    group: 'engagement',
    enabled: true,
    config: {},
    revision: 2,
    updatedAt: null,
    status: 'needs_configuration',
    availability: { ...availability, entitlement: 'addons.edit-suggestions', capabilityKey: 'addons.edit-suggestions' },
  },
  {
    id: 'consent-banner',
    group: 'privacy',
    enabled: true,
    config: { placement: 'bottom-end', presentation: 'comfortable', buttonLayout: 'inline' },
    revision: 1,
    updatedAt: null,
    status: 'active',
    availability: { ...availability, entitlement: 'addons.consent-banner', capabilityKey: 'addons.consent-banner' },
  },
  {
    id: 'grammar-linter',
    group: 'publishing',
    enabled: false,
    config: {},
    revision: 1,
    updatedAt: null,
    status: 'unavailable',
    availability: {
      ...availability,
      state: 'preview',
      available: false,
      decision: 'disabled',
      entitlement: 'addons.grammar-linter',
      capabilityKey: 'addons.grammar-linter',
    },
  },
] satisfies ProjectAddon[];

const mocks = vi.hoisted(() => ({
  /** What the add-ons query returns; a test changes it and re-renders to simulate a refetch. */
  addons: [] as ProjectAddon[],
  update: vi.fn(),
  activate: vi.fn(),
  deactivate: vi.fn(),
  toastError: vi.fn(),
  access: { status: 'admin', edit: 'edit' } as { status: string; edit: string },
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string) => translations[key] ?? key,
  translateFn: (key: string) => key,
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock('@/hooks/api', () => ({
  useProjectAddons: () => ({ data: mocks.addons, isPending: false, isError: false, isFetching: false, refetch: vi.fn() }),
  useUpdateProjectAddon: () => ({ mutateAsync: mocks.update, isPending: false }),
  useActivateProjectAddon: () => ({ mutateAsync: mocks.activate, isPending: false }),
  useDeactivateProjectAddon: () => ({ mutateAsync: mocks.deactivate, isPending: false }),
}));
vi.mock('@/hooks/use-project-admin-status', () => ({ useProjectAdminStatus: () => mocks.access }));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: () => 'Could not save' }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let dirty: Set<string>;
const report = (id: string, changed: boolean) => (changed ? dirty.add(id) : dirty.delete(id));
const page = () => (
  <ConfigDirtyProvider report={report}>
    <AddonsSettings projectId="site-1" />
  </ConfigDirtyProvider>
);

async function render() {
  container = document.createElement('div');
  container.dir = 'rtl';
  document.body.append(container);
  root = createRoot(container);
  dirty = new Set();
  await act(async () => root.render(page()));
}

/** The add-ons query returns `next` (a refetch, or someone else's change) and the page re-renders with it. */
const serverSends = async (next: ProjectAddon[]) => {
  mocks.addons = next;
  await act(async () => root.render(page()));
};
/** The add-ons as the server now holds them, with one add-on changed. */
const withAddon = (id: ProjectAddon['id'], patch: Partial<ProjectAddon>) =>
  mocks.addons.map((addon) => (addon.id === id ? { ...addon, ...patch } : addon));

beforeEach(async () => {
  mocks.access = { status: 'admin', edit: 'edit' };
  mocks.addons = addons;
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const controlFor = (label: string) => {
  const labelEl = [...container.querySelectorAll('label')].find((el) => el.textContent === label);
  const control = labelEl ? document.getElementById(labelEl.htmlFor) : null;
  if (!control) throw new Error(`No control for ${label}`);
  return control;
};
const inputFor = (label: string) => {
  const control = controlFor(label);
  if (!(control instanceof HTMLInputElement)) throw new Error(`${label} is not an input`);
  return control;
};
/** Base UI keeps the label's id on a hidden checkbox; the switch itself carries the role, state and description. */
const switchFor = (label: string) => {
  const control = controlFor(label).closest('[data-slot="settings-row"]')?.querySelector<HTMLElement>('[role="switch"]');
  if (!control) throw new Error(`No switch for ${label}`);
  return control;
};
const type = (el: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const blur = (el: HTMLElement) =>
  act(async () => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
  });
const region = () => container.querySelector('[data-slot="save-region"]');
const buttonNamed = (scope: ParentNode | null | undefined, name: string) =>
  [...(scope?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes(name));
const saveButton = () => buttonNamed(region(), 'common.save');
const save = () => act(async () => saveButton()?.click());
/** Enter in a field: the browser submits the field's form. */
const pressEnterIn = (el: HTMLElement) =>
  act(async () => {
    el.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
const pressCtrlS = () =>
  act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  });
const errorOf = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id))
    .find((node) => node?.dataset.slot === 'settings-row-error')?.textContent;
const describedText = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const addonById = (id: ProjectAddon['id']): ProjectAddon => {
  const addon = addons.find((item) => item.id === id);
  if (!addon) throw new Error(`No add-on ${id}`);
  return addon;
};
const consent = addonById('consent-banner');
const consentBody = (privacyPolicyUrl: string, expectedRevision: number) => ({
  addonId: 'consent-banner',
  body: { config: { ...consent.config, privacyPolicyUrl }, expectedRevision },
});
/** The consent banner as the server returns it after saving `privacyPolicyUrl`. */
const savedConsent = (privacyPolicyUrl: string, patch: Partial<ProjectAddon> = {}): ProjectAddon => ({
  ...consent,
  config: { ...consent.config, privacyPolicyUrl },
  ...patch,
});
const conflictNote = () => container.textContent?.includes('forms.changedElsewhere') ?? false;

describe('AddonsSettings', () => {
  it('lays the add-on groups out as sections under one page title, with no inner headings', () => {
    expect([...container.querySelectorAll('h1')].map((h) => h.textContent)).toEqual(['settings.addons.title']);
    expect([...container.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'settings.addons.group.engagement.title',
      'settings.addons.group.privacy.title',
      'settings.addons.group.publishing.title',
    ]);
    expect(container.querySelector('h3, h4, article')).toBeNull();
  });

  it('renders localized option labels instead of raw add-on enum tokens', () => {
    expect(container.textContent).toContain('بعد محتوى الصفحة');
    expect(container.textContent).toContain('بطاقة');
    expect(container.textContent).toContain('أسفل النهاية');
    expect(container.textContent).toContain('مريحة');
    expect(container.textContent).toContain('جنبًا إلى جنب');
    expect(container.textContent).not.toMatch(/after-content|bottom-end|comfortable|inline/);
  });

  it('labels every field, including the privacy policy address', () => {
    expect(inputFor('site.analyticsConsentPrivacy').type).toBe('url');
    expect(inputFor('settings.addons.editUrl.label').placeholder).toBe('settings.addons.editUrl.placeholder');
    expect(controlFor('settings.addons.feedback.placement')).toBeTruthy();
    expect(controlFor('settings.addons.consent.buttons')).toBeTruthy();
  });

  it('shows no save bar until a setting changes, then saves only that add-on', async () => {
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
    const template = inputFor('settings.addons.editUrl.label');
    await type(template, '  https://github.com/acme/docs/edit/main/{path}.mdx ');
    expect(region()).not.toBeNull();
    expect(dirty.size).toBeGreaterThan(0);

    mocks.update.mockResolvedValueOnce({ ...addons[1], config: { urlTemplate: 'https://github.com/acme/docs/edit/main/{path}.mdx' } });
    await save();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({
      addonId: 'edit-suggestions',
      body: { config: { urlTemplate: 'https://github.com/acme/docs/edit/main/{path}.mdx' }, expectedRevision: 2 },
    });
    expect(template.value).toBe('https://github.com/acme/docs/edit/main/{path}.mdx');
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('checks an address once the field is left, and clears the error as it is fixed', async () => {
    const template = inputFor('settings.addons.editUrl.label');
    await type(template, 'github.com/{path}');
    expect(template.getAttribute('aria-invalid')).toBeNull();
    await blur(template);
    expect(template.getAttribute('aria-invalid')).toBe('true');
    expect(errorOf(template)).toBe('settings.addons.url.invalid');
    await type(template, 'https://github.com/{branch}');
    expect(errorOf(template)).toBe('settings.addons.url.unsupportedPlaceholder');
    await type(template, 'https://github.com/{path}');
    expect(template.getAttribute('aria-invalid')).toBeNull();
  });

  it('sends nothing for an invalid privacy address and focuses it', async () => {
    const privacy = inputFor('site.analyticsConsentPrivacy');
    await type(privacy, 'acme.test/privacy');
    await save();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(privacy.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(privacy);
  });

  it('discards back to the saved settings', async () => {
    const privacy = inputFor('site.analyticsConsentPrivacy');
    await type(privacy, 'https://acme.test/privacy');
    await act(async () => [...(region()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('forms.discard'))?.click());
    expect(privacy.value).toBe('');
    expect(region()).toBeNull();
  });

  it('keeps the form dirty and explains when a save fails', async () => {
    mocks.update.mockRejectedValueOnce(new Error('nope'));
    await type(inputFor('site.analyticsConsentPrivacy'), 'https://acme.test/privacy');
    await save();
    expect(mocks.toastError).toHaveBeenCalledWith('Could not save');
    expect(region()).not.toBeNull();
  });

  it('switches an add-on off at once, with its revision, and says it saved', async () => {
    mocks.deactivate.mockResolvedValueOnce({ ...addons[0], enabled: false });
    const toggle = switchFor('settings.addons.feedback.title');
    await act(async () => toggle.click());
    expect(mocks.deactivate).toHaveBeenCalledWith({ addonId: 'feedback', expectedRevision: 3 });
    expect(region()).toBeNull();
    expect(toggle.closest('[data-slot="settings-row"]')?.querySelector('[role="status"]')?.textContent).toBe('common.saved');
  });

  it('explains a failed switch in a toast', async () => {
    mocks.deactivate.mockRejectedValueOnce(new Error('nope'));
    await act(async () => switchFor('settings.addons.feedback.title').click());
    expect(mocks.toastError).toHaveBeenCalledWith('Could not save');
  });

  it('disables an add-on the plan lacks and says why, with its badges in the description', () => {
    const toggle = switchFor('settings.addons.grammarLinter.title');
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    const described = describedText(toggle);
    expect(described).toContain('settings.addons.unavailableDescription');
    expect(described).toContain('settings.addons.availability.preview');
    expect(described).toContain('settings.addons.status.unavailable');
    expect(describedText(switchFor('settings.addons.editSuggestions.title'))).toContain('settings.addons.status.needsconfiguration');
  });

  it('shows the page read-only to non-Admins, with one note saying why', async () => {
    await act(async () => root.unmount());
    container.remove();
    mocks.access = { status: 'notAdmin', edit: 'edit' };
    await render();
    expect(container.querySelectorAll('[data-slot="callout"]')).toHaveLength(2); // the note, and the consent preview note
    expect(container.textContent).toContain('settings.permissions.title');
    expect(container.textContent).toContain('settings.permissions.body');
    expect(inputFor('site.analyticsConsentPrivacy').disabled).toBe(true);
    expect(inputFor('settings.addons.editUrl.label').disabled).toBe(true);
    const toggle = switchFor('settings.addons.feedback.title');
    await act(async () => toggle.click());
    expect(mocks.deactivate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('settings.addons.unavailableDescription');
  });

  describe('saving through the page bar', () => {
    it('keeps the bar and the leave guard up while a save is in flight, then hides the bar and keeps the saved value', async () => {
      const pending = deferred<ProjectAddon>();
      mocks.update.mockReturnValueOnce(pending.promise);
      const privacy = inputFor('site.analyticsConsentPrivacy');
      await type(privacy, 'https://acme.test/privacy');
      await save();
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(mocks.update).toHaveBeenCalledWith(consentBody('https://acme.test/privacy', 1));
      expect(region()).not.toBeNull();
      expect(saveButton()?.getAttribute('aria-busy')).toBe('true');
      expect(dirty.size).toBeGreaterThan(0);

      await act(async () => pending.resolve(savedConsent('https://acme.test/privacy', { revision: 2 })));
      expect(privacy.value).toBe('https://acme.test/privacy');
      expect(region()).toBeNull();
      expect(dirty.size).toBe(0);
    });

    it('keeps an edit made during a save, dirty, and saves it next with the revision the first save produced', async () => {
      const pending = deferred<ProjectAddon>();
      mocks.update.mockReturnValueOnce(pending.promise);
      const privacy = inputFor('site.analyticsConsentPrivacy');
      await type(privacy, 'https://acme.test/a');
      await save();
      await type(privacy, 'https://acme.test/b');
      await act(async () => pending.resolve(savedConsent('https://acme.test/a', { revision: 2 })));
      expect(privacy.value).toBe('https://acme.test/b');
      expect(region()).not.toBeNull();
      expect(dirty.size).toBeGreaterThan(0);

      // The list refetch after the save brings the new revision; the newer edit stays.
      await serverSends(withAddon('consent-banner', savedConsent('https://acme.test/a', { revision: 2 })));
      expect(privacy.value).toBe('https://acme.test/b');
      expect(region()).not.toBeNull();

      mocks.update.mockResolvedValueOnce(savedConsent('https://acme.test/b', { revision: 3 }));
      await save();
      expect(mocks.update).toHaveBeenLastCalledWith(consentBody('https://acme.test/b', 2));
      expect(region()).toBeNull();
      expect(dirty.size).toBe(0);
    });

    it('starts exactly one save while one is in flight, whatever submits again (Enter, Save, Ctrl+S)', async () => {
      const pending = deferred<ProjectAddon>();
      mocks.update.mockReturnValueOnce(pending.promise);
      const privacy = inputFor('site.analyticsConsentPrivacy');
      await type(privacy, 'https://acme.test/a');
      await save();
      await type(privacy, 'https://acme.test/b');
      await pressEnterIn(privacy);
      await save();
      await pressCtrlS();
      expect(mocks.update).toHaveBeenCalledTimes(1);

      await act(async () => pending.resolve(savedConsent('https://acme.test/a', { revision: 2 })));
      // Nothing was queued behind the first save: the newer edit waits for the person.
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(privacy.value).toBe('https://acme.test/b');
      expect(region()).not.toBeNull();

      // Once it settled, Enter saves again (so the Enter above was really refused), and Ctrl+S during that save is too.
      const second = deferred<ProjectAddon>();
      mocks.update.mockReturnValueOnce(second.promise);
      await pressEnterIn(privacy);
      expect(mocks.update).toHaveBeenCalledTimes(2);
      // It sends the revision the first save returned, before the list has refetched.
      expect(mocks.update).toHaveBeenLastCalledWith(consentBody('https://acme.test/b', 2));
      await type(privacy, 'https://acme.test/c');
      await pressCtrlS();
      expect(mocks.update).toHaveBeenCalledTimes(2);
      await act(async () => second.resolve(savedConsent('https://acme.test/b', { revision: 3 })));
      mocks.update.mockResolvedValueOnce(savedConsent('https://acme.test/c', { revision: 4 }));
      await pressCtrlS();
      expect(mocks.update).toHaveBeenCalledTimes(3);
      expect(mocks.update).toHaveBeenLastCalledWith(consentBody('https://acme.test/c', 3));
    });
  });

  describe('server changes while editing', () => {
    it('flags a field someone else changed, keeps the edit, and keeps the flag through a refetch of another field', async () => {
      const privacy = inputFor('site.analyticsConsentPrivacy');
      await type(privacy, 'https://mine.test/privacy');
      expect(conflictNote()).toBe(false);

      await serverSends(withAddon('consent-banner', savedConsent('https://theirs.test/privacy', { revision: 2 })));
      expect(conflictNote()).toBe(true);
      expect(buttonNamed(container, 'forms.useTheirs')).toBeTruthy();
      expect(buttonNamed(container, 'forms.keepMine')).toBeTruthy();
      expect(privacy.value).toBe('https://mine.test/privacy');
      expect(region()).not.toBeNull();

      // Another field changes elsewhere: it is merged in, and the open conflict stays.
      await serverSends(
        withAddon('consent-banner', {
          config: { ...consent.config, presentation: 'compact', privacyPolicyUrl: 'https://theirs.test/privacy' },
          revision: 3,
        }),
      );
      expect(conflictNote()).toBe(true);
      expect(privacy.value).toBe('https://mine.test/privacy');
      expect(controlFor('settings.addons.consent.presentation').textContent).toContain('settings.addons.consent.presentation.compact');

      // "Use theirs" takes the server's address; nothing is left to save.
      await act(async () => buttonNamed(container, 'forms.useTheirs')?.click());
      expect(conflictNote()).toBe(false);
      expect(privacy.value).toBe('https://theirs.test/privacy');
      expect(region()).toBeNull();
      expect(dirty.size).toBe(0);
    });

    it('"Keep mine" clears the flag and saves the edit against the newest revision', async () => {
      const privacy = inputFor('site.analyticsConsentPrivacy');
      await type(privacy, 'https://mine.test/privacy');
      await serverSends(withAddon('consent-banner', savedConsent('https://theirs.test/privacy', { revision: 2 })));
      await act(async () => buttonNamed(container, 'forms.keepMine')?.click());
      expect(conflictNote()).toBe(false);
      expect(privacy.value).toBe('https://mine.test/privacy');
      expect(region()).not.toBeNull();

      mocks.update.mockResolvedValueOnce(savedConsent('https://mine.test/privacy', { revision: 3 }));
      await save();
      expect(mocks.update).toHaveBeenCalledWith(consentBody('https://mine.test/privacy', 2));
      expect(region()).toBeNull();
    });
  });

  describe('the switch and the settings save together', () => {
    it('locks the switch while a settings save runs, then flips it with the saved revision', async () => {
      const pendingSave = deferred<ProjectAddon>();
      mocks.update.mockReturnValueOnce(pendingSave.promise);
      const privacy = inputFor('site.analyticsConsentPrivacy');
      await type(privacy, 'https://acme.test/privacy');
      await save();
      expect(mocks.update).toHaveBeenCalledWith(consentBody('https://acme.test/privacy', 1));

      // Both write the same add-on revision, so the switch waits for the save.
      const toggle = switchFor('settings.addons.consent.title');
      expect(toggle.getAttribute('aria-disabled')).toBe('true');
      await act(async () => toggle.click());
      expect(mocks.deactivate).not.toHaveBeenCalled();

      await act(async () => pendingSave.resolve(savedConsent('https://acme.test/privacy', { revision: 2 })));
      expect(privacy.value).toBe('https://acme.test/privacy');
      expect(region()).toBeNull();

      // Before the list refetches, the switch already sends the revision the save produced.
      mocks.deactivate.mockResolvedValueOnce({ ...consent, enabled: false, status: 'inactive', revision: 3 });
      const unlocked = switchFor('settings.addons.consent.title');
      expect(unlocked.getAttribute('aria-disabled')).not.toBe('true');
      await act(async () => unlocked.click());
      expect(mocks.deactivate).toHaveBeenCalledWith({ addonId: 'consent-banner', expectedRevision: 2 });
      await serverSends(withAddon('consent-banner', { enabled: false, status: 'inactive', revision: 3 }));
      expect(privacy.value).toBe('https://acme.test/privacy');
      expect(region()).toBeNull();

      // The next save sends the newest revision.
      mocks.update.mockResolvedValueOnce(savedConsent('https://acme.test/next', { revision: 4 }));
      await type(privacy, 'https://acme.test/next');
      await save();
      expect(mocks.update).toHaveBeenLastCalledWith(consentBody('https://acme.test/next', 3));
    });

    it('holds a settings save until a switch flip lands, then sends its revision', async () => {
      const pendingToggle = deferred<ProjectAddon>();
      mocks.deactivate.mockReturnValueOnce(pendingToggle.promise);
      await act(async () => switchFor('settings.addons.consent.title').click());
      const privacy = inputFor('site.analyticsConsentPrivacy');
      await type(privacy, 'https://acme.test/privacy');
      mocks.update.mockResolvedValueOnce(savedConsent('https://acme.test/privacy', { enabled: false, status: 'inactive', revision: 3 }));
      await save();
      // Nothing is sent while the switch's write is in flight.
      expect(mocks.update).not.toHaveBeenCalled();
      await act(async () => pendingToggle.resolve({ ...consent, enabled: false, status: 'inactive', revision: 2 }));
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(mocks.update).toHaveBeenCalledWith(consentBody('https://acme.test/privacy', 2));
    });

    it('sends the revision the switch produced when settings are saved after it', async () => {
      mocks.deactivate.mockResolvedValueOnce({ ...consent, enabled: false, status: 'inactive', revision: 2 });
      await act(async () => switchFor('settings.addons.consent.title').click());
      await serverSends(withAddon('consent-banner', { enabled: false, status: 'inactive', revision: 2 }));

      mocks.update.mockResolvedValueOnce(savedConsent('https://acme.test/privacy', { revision: 3 }));
      const privacy = inputFor('site.analyticsConsentPrivacy');
      expect(privacy.disabled).toBe(false); // settings stay editable while the add-on is off
      await type(privacy, 'https://acme.test/privacy');
      await save();
      expect(mocks.update).toHaveBeenCalledWith(consentBody('https://acme.test/privacy', 2));
    });
  });

  describe('add-ons the plan no longer includes', () => {
    const unavailable = (addon: ProjectAddon, enabled: boolean): Partial<ProjectAddon> => ({
      enabled,
      status: 'unavailable',
      availability: { ...addon.availability, state: 'coming_soon', available: false, decision: 'disabled' },
    });

    it('lets an enabled one be switched off, with its settings disabled', async () => {
      const editSuggestions = addonById('edit-suggestions');
      await serverSends(withAddon('edit-suggestions', unavailable(editSuggestions, true)));
      const toggle = switchFor('settings.addons.editSuggestions.title');
      expect(toggle.getAttribute('aria-disabled')).not.toBe('true');
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      expect(describedText(toggle)).not.toContain('settings.addons.unavailableDescription');
      expect(inputFor('settings.addons.editUrl.label').disabled).toBe(true);

      mocks.deactivate.mockResolvedValueOnce({ ...editSuggestions, ...unavailable(editSuggestions, false), revision: 3 });
      await act(async () => toggle.click());
      expect(mocks.deactivate).toHaveBeenCalledWith({ addonId: 'edit-suggestions', expectedRevision: 2 });
      expect(mocks.activate).not.toHaveBeenCalled();
    });

    it('keeps a disabled one off, says why next to the switch, and disables its settings', async () => {
      const feedback = addonById('feedback');
      await serverSends(withAddon('feedback', unavailable(feedback, false)));
      const toggle = switchFor('settings.addons.feedback.title');
      expect(toggle.getAttribute('aria-disabled')).toBe('true');
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      expect(describedText(toggle)).toContain('settings.addons.unavailableDescription');
      expect(container.textContent).toContain('settings.addons.unavailableDescription');
      for (const label of ['settings.addons.feedback.placement', 'settings.addons.feedback.presentation']) {
        const trigger = controlFor(label);
        expect(trigger.hasAttribute('disabled') || trigger.hasAttribute('data-disabled')).toBe(true);
      }

      await act(async () => toggle.click());
      expect(mocks.activate).not.toHaveBeenCalled();
    });
  });
});
