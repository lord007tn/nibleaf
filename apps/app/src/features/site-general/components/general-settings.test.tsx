// @vitest-environment jsdom
import { type AnchorHTMLAttributes, act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { Project } from '@/hooks/api';
import { GeneralSettings } from './general-settings';

const mocks = vi.hoisted(() => ({ updateProject: vi.fn(), updateLanguage: vi.fn(), languages: [] as unknown[] }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('@/env', () => ({ env: { VITE_SITE_BASE_DOMAIN: 'nibleaf.app' } }));
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({ data: mocks.languages, isPending: false }),
  useUpdateProject: () => ({ mutateAsync: mocks.updateProject, isPending: false }),
  useUpdateLanguage: () => ({ mutateAsync: mocks.updateLanguage, isPending: false }),
}));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: () => 'Could not save' }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a className={className} href="/settings?section=domain">
      {children}
    </a>
  ),
  useBlocker: () => undefined,
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const project = { id: 'site-1', name: 'Original', slug: 'docs', description: null, icon: null } as Project;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let dirty: Set<string>;

beforeEach(async () => {
  mocks.languages = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  dirty = new Set();
  const report = (id: string, changed: boolean) => (changed ? dirty.add(id) : dirty.delete(id));
  await act(async () =>
    root.render(
      <ConfigDirtyProvider report={report}>
        <GeneralSettings project={project} />
      </ConfigDirtyProvider>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const input = (label: string) => {
  const labelEl = [...container.querySelectorAll('label')].find((el) => el.textContent === label);
  const control = labelEl ? document.getElementById(labelEl.htmlFor) : null;
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) throw new Error(`No control for ${label}`);
  return control;
};
const type = (el: HTMLInputElement | HTMLTextAreaElement, text: string) =>
  act(async () => {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const blur = (el: HTMLElement) =>
  act(async () => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
  });
const region = () => container.querySelector('[data-slot="save-region"]');
const regionButton = (name: string) => [...(region()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes(name));
const save = () => act(async () => regionButton('common.save')?.click());
const errorOf = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id))
    .find((node) => node?.dataset.slot === 'settings-row-error')?.textContent;

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('GeneralSettings', () => {
  it('shows no errors and no save bar on an untouched form', () => {
    expect(container.querySelector('h1')?.textContent).toBe('settings.general.title');
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('waits for the field to be left before showing its error', async () => {
    const name = input('settings.general.name.label');
    await type(name, '');
    expect(region()).not.toBeNull();
    expect(name.getAttribute('aria-invalid')).toBeNull();
    await blur(name);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(errorOf(name)).toBe('validation.required');
    await type(name, 'Back');
    expect(name.getAttribute('aria-invalid')).toBeNull();
  });

  it('keeps text typed during a slow save, and the unsaved-changes guard with it', async () => {
    const first = deferred();
    mocks.updateProject.mockReturnValueOnce(first.promise);
    const name = input('settings.general.name.label');
    await type(name, 'A');
    await save();
    expect(mocks.updateProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'A' }));
    await type(name, 'AB');
    await act(async () => first.resolve());
    expect(name.value).toBe('AB');
    expect(dirty.size).toBeGreaterThan(0);
    expect(region()).not.toBeNull();

    mocks.updateProject.mockResolvedValueOnce(undefined);
    await save();
    expect(mocks.updateProject).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'AB' }));
    expect(name.value).toBe('AB');
    expect(dirty.size).toBe(0);
    expect(region()).toBeNull();
  });

  it('keeps the save bar and the leave guard up until a pending save settles, even if the text goes back', async () => {
    const pending = deferred();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    const name = input('settings.general.name.label');
    await type(name, 'Renamed');
    await save();
    await type(name, 'Original');
    expect(region()).not.toBeNull();
    expect(dirty.size).toBeGreaterThan(0);
    await act(async () => pending.resolve());
    // The server now holds "Renamed" while the field says "Original": that is a real unsaved change.
    expect(name.value).toBe('Original');
    expect(region()).not.toBeNull();
  });

  it('shows a taken address on the address field and clears it when the address changes', async () => {
    mocks.updateProject.mockRejectedValueOnce({ status: 409, details: { slug: 'help' } });
    const slug = input('settings.general.url.label');
    await type(slug, 'help');
    await save();
    expect(slug.getAttribute('aria-invalid')).toBe('true');
    expect(errorOf(slug)).toBe('settings.general.url.taken');
    expect(region()).not.toBeNull();
    await type(slug, 'help-center');
    expect(slug.getAttribute('aria-invalid')).toBeNull();
  });

  it('discards back to the saved values', async () => {
    const name = input('settings.general.name.label');
    await type(name, 'Changed');
    await act(async () => regionButton('forms.discard')?.click());
    expect(name.value).toBe('Original');
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('on an invalid save, shows every error, focuses the first one and sends nothing', async () => {
    const name = input('settings.general.name.label');
    const slug = input('settings.general.url.label');
    await type(slug, 'Bad Slug!'.toLowerCase().replace(/[^a-z-]/g, '-'));
    await type(name, '');
    await save();
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('forms.fixHighlighted');
  });

  it('edits translations in the form and saves only the changed language', async () => {
    await act(async () => root.unmount());
    mocks.languages = [
      { id: 'en', code: 'en', label: 'English', isDefault: true, position: 0, direction: 'LTR' },
      { id: 'ar', code: 'ar', label: 'العربية', isDefault: false, position: 1, direction: 'RTL', translation: { name: '', description: '' } },
    ];
    root = createRoot(container);
    await act(async () => root.render(<GeneralSettings project={project} />));
    const arabicName = [...container.querySelectorAll('input')].find((el) => el.lang === 'ar');
    if (!arabicName) throw new Error('No Arabic name field');
    expect(arabicName.dir).toBe('rtl');
    expect(arabicName.placeholder).toBe('Original');
    mocks.updateLanguage.mockResolvedValueOnce(undefined);
    await type(arabicName, 'التوثيق');
    await save();
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(mocks.updateLanguage).toHaveBeenCalledWith({ id: 'ar', body: { translation: { name: 'التوثيق', description: '' } } });
  });
});
