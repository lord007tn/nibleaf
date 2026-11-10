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
  useProjectAddons: () => ({ data: addons, isPending: false, isError: false, isFetching: false, refetch: vi.fn() }),
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

async function render() {
  container = document.createElement('div');
  container.dir = 'rtl';
  document.body.append(container);
  root = createRoot(container);
  dirty = new Set();
  const report = (id: string, changed: boolean) => (changed ? dirty.add(id) : dirty.delete(id));
  await act(async () =>
    root.render(
      <ConfigDirtyProvider report={report}>
        <AddonsSettings projectId="site-1" />
      </ConfigDirtyProvider>,
    ),
  );
}

beforeEach(async () => {
  mocks.access = { status: 'admin', edit: 'edit' };
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
const save = () => act(async () => [...(region()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('common.save'))?.click());
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
});
