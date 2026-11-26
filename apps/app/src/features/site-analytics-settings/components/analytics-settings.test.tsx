// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { Project } from '@/hooks/api';
import { AnalyticsSettings } from './analytics-settings';

const mocks = vi.hoisted(() => ({ update: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('@/hooks/api', () => ({ useUpdateProjectConfig: () => ({ mutateAsync: mocks.update, isPending: false }) }));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: () => 'Could not save' }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type Analytics = NonNullable<NonNullable<Project['config']>['analytics']>;
/** A site as the project query returns it; other config sections ride along untouched. */
const site = (analytics: Analytics, id = 'site-1') =>
  ({ id, config: { theme: { preset: 'nib' }, analytics: { cookieConsent: true, ...analytics } } }) as unknown as Project;
/** The updated project the PATCH returns, with the config the server merged. */
const saved = (analytics: Analytics) => site(analytics);

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let dirty: Set<string>;

const render = (project: Project) =>
  act(async () =>
    root.render(
      <ConfigDirtyProvider report={(id, changed) => (changed ? dirty.add(id) : dirty.delete(id))}>
        <AnalyticsSettings project={project} />
      </ConfigDirtyProvider>,
    ),
  );

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  dirty = new Set();
  await render(site({ ga4: 'G-ABC123' }));
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
const input = (label: string) => {
  const control = controlFor(label);
  if (!(control instanceof HTMLInputElement)) throw new Error(`No text control for ${label}`);
  return control;
};
const ga4 = () => input('settings.analytics.ga4.label');
const plausible = () => input('settings.analytics.plausible.label');
const campaign = () => controlFor('settings.analytics.campaignDimensions.title');
const searchTerms = () => controlFor('settings.analytics.searchTerms.title');
const checked = (control: HTMLElement) =>
  control.closest('[data-slot="settings-row"]')?.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true';

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
const click = (el: HTMLElement) => act(async () => el.click());
const region = () => container.querySelector('[data-slot="save-region"]');
const regionButton = (name: string) => {
  const button = [...(region()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes(name));
  if (!button) throw new Error(`No ${name} button in the save bar`);
  return button;
};
const save = () => click(regionButton('common.save'));
const discard = () => click(regionButton('forms.discard'));
const errorOf = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id))
    .find((node) => node?.dataset.slot === 'settings-row-error')?.textContent;

const status = () => container.querySelector('[role="status"]')?.textContent;
/**
 * A keydown on `el`, then what the browser's implicit submission does in the
 * same task unless the key was cancelled: it clicks the form's default button.
 * The next macrotask is awaited so a key the form ignored is forgotten.
 */
const pressEnter = async (el: HTMLInputElement, init: KeyboardEventInit = {}) => {
  const keydown = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
  await act(async () => {
    el.dispatchEvent(keydown);
    if (!keydown.defaultPrevented) el.form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  });
  await act(() => new Promise((resolve) => setTimeout(resolve)));
  return keydown;
};
const payload = (analytics: Partial<Analytics>) => ({
  config: { analytics: { ga4: 'G-ABC123', campaignDimensions: false, storePublicSearchTerms: false, ...analytics } },
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

describe('AnalyticsSettings', () => {
  it('opens pristine: the saved values, both opt-ins off, no errors and no save bar', () => {
    // The page's own heading (Integrations → Analytics) names the form; no second heading repeats it.
    expect(container.querySelector('h2')).toBeNull();
    expect(ga4().value).toBe('G-ABC123');
    expect(plausible().value).toBe('');
    expect(checked(campaign())).toBe(false);
    expect(checked(searchTerms())).toBe(false);
    expect(container.textContent).toContain('settings.analytics.cookieConsent.managed');
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  it('keeps identifiers left to right, whatever the interface direction', () => {
    expect(ga4().dir).toBe('ltr');
    expect(plausible().dir).toBe('ltr');
    expect(ga4().placeholder).toBe('G-XXXXXXXXXX');
    expect(plausible().placeholder).toBe('docs.yoursite.com');
  });

  it('waits for the field to be left before showing its error, then follows the typing', async () => {
    await type(plausible(), 'https://docs');
    expect(region()).not.toBeNull();
    expect(plausible().getAttribute('aria-invalid')).toBeNull();
    await blur(plausible());
    expect(plausible().getAttribute('aria-invalid')).toBe('true');
    expect(errorOf(plausible())).toBe('settings.analytics.plausible.error');
    await type(plausible(), 'docs.acme.com');
    expect(plausible().getAttribute('aria-invalid')).toBeNull();
  });

  it('shows every error on Save without a blur, focuses the first, and sends nothing', async () => {
    await type(ga4(), 'UA-1234');
    await type(plausible(), 'not a domain');
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    await save();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(errorOf(ga4())).toBe('settings.analytics.ga4.error');
    expect(errorOf(plausible())).toBe('settings.analytics.plausible.error');
    expect(document.activeElement).toBe(ga4());
    expect(region()).not.toBeNull();
  });

  describe('Enter in an id field', () => {
    it('has one hidden default button, so Enter submits a form with two text fields', () => {
      const buttons = container.querySelectorAll<HTMLButtonElement>('form button[type="submit"]');
      expect(buttons).toHaveLength(1);
      expect(buttons[0]?.hidden).toBe(true);
    });

    it.each([
      ['GA4', ga4, 'G-NEW1', { ga4: 'G-NEW1' }],
      ['Plausible', plausible, 'docs.acme.com', { plausible: 'docs.acme.com' }],
    ])('in %s sends one valid request and says Saved', async (_, field, text, sent) => {
      mocks.update.mockResolvedValueOnce(saved({ ga4: 'G-ABC123', ...sent }));
      await type(field(), text);
      expect(status()).toBe('');
      await pressEnter(field());
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(mocks.update).toHaveBeenCalledWith(payload(sent));
      expect(status()).toBe('common.saved');
      expect(region()).toBeNull();
      expect(dirty.size).toBe(0);
    });

    it('says Saved again on a second Enter save', async () => {
      mocks.update.mockResolvedValueOnce(saved({ ga4: 'G-ONE' }));
      await type(ga4(), 'G-ONE');
      await pressEnter(ga4());
      expect(status()).toBe('common.saved');

      const second = deferred<Project>();
      mocks.update.mockReturnValueOnce(second.promise);
      await type(plausible(), 'docs.acme.com');
      await pressEnter(plausible());
      // The run clears the last announcement while it saves, so the next one is new.
      expect(status()).toBe('');
      await act(async () => second.resolve(saved({ ga4: 'G-ONE', plausible: 'docs.acme.com' })));
      expect(mocks.update).toHaveBeenCalledTimes(2);
      expect(mocks.update).toHaveBeenLastCalledWith(payload({ ga4: 'G-ONE', plausible: 'docs.acme.com' }));
      expect(status()).toBe('common.saved');
    });

    it('shows the error, focuses the first invalid field and sends nothing', async () => {
      await type(plausible(), 'not a domain');
      await pressEnter(plausible());
      expect(mocks.update).not.toHaveBeenCalled();
      expect(errorOf(plausible())).toBe('settings.analytics.plausible.error');
      expect(document.activeElement).toBe(plausible());
      expect(status()).toBe('forms.fixHighlighted');

      await type(ga4(), 'UA-1234');
      await type(plausible(), 'docs.acme.com');
      await pressEnter(plausible());
      expect(mocks.update).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(ga4());
    });

    it('after a refusal keeps the edit, says why once, and does not say Saved', async () => {
      mocks.update.mockRejectedValueOnce({ status: 403 });
      await type(ga4(), 'G-NEW1');
      await pressEnter(ga4());
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).toHaveBeenCalledWith('Could not save');
      expect(status()).toBe('');
      expect(ga4().value).toBe('G-NEW1');
      expect(region()).not.toBeNull();
    });

    it('while a save runs, starts nothing and says nothing until it ends', async () => {
      const pending = deferred<Project>();
      mocks.update.mockReturnValueOnce(pending.promise);
      await type(ga4(), 'G-NEW1');
      await pressEnter(ga4());
      await pressEnter(ga4());
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(status()).toBe('');
      await act(async () => pending.resolve(saved({ ga4: 'G-NEW1' })));
      expect(status()).toBe('common.saved');
    });

    it('while clean, sends nothing and says nothing', async () => {
      await pressEnter(ga4());
      expect(mocks.update).not.toHaveBeenCalled();
      expect(status()).toBe('');
    });

    it.each([
      ['Shift+Enter', { shiftKey: true }],
      ['Ctrl+Enter', { ctrlKey: true }],
      ['Alt+Enter', { altKey: true }],
      ['Cmd+Enter', { metaKey: true }],
      ['Enter while an IME composition is open', { isComposing: true }],
      ['the IME’s own key (229)', { key: 'Process', keyCode: 229 }],
    ])('%s does not save, and the key is not cancelled', async (_, init) => {
      await type(ga4(), 'G-NEW1');
      const keydown = await pressEnter(ga4(), init);
      expect(keydown.defaultPrevented).toBe(false);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(status()).toBe('');
      expect(region()).not.toBeNull();
    });
  });

  it.each([
    ['Ctrl+S', { ctrlKey: true }],
    ['Cmd+S', { metaKey: true }],
  ])('%s saves the form and says Saved, as before', async (_, init) => {
    mocks.update.mockResolvedValueOnce(saved({ ga4: 'G-NEW1' }));
    await type(ga4(), 'G-NEW1');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true, ...init })));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(payload({ ga4: 'G-NEW1' }));
    expect(status()).toBe('common.saved');
  });

  it('makes the form dirty with a switch alone, and discards it', async () => {
    await click(campaign());
    expect(checked(campaign())).toBe(true);
    expect(region()).not.toBeNull();
    expect(dirty.size).toBeGreaterThan(0);
    await discard();
    expect(checked(campaign())).toBe(false);
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
    // Back to where it started by hand is clean too: dirty compares values, not touches.
    await click(searchTerms());
    await click(searchTerms());
    expect(region()).toBeNull();
  });

  it('saves a switch alone, with the other opt-in as an explicit false and the saved id as it was', async () => {
    mocks.update.mockResolvedValueOnce(saved({ ga4: 'G-ABC123', campaignDimensions: false, storePublicSearchTerms: true }));
    await click(searchTerms());
    await save();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith({
      config: { analytics: { ga4: 'G-ABC123', campaignDimensions: false, storePublicSearchTerms: true } },
    });
    expect(checked(searchTerms())).toBe(true);
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
    expect(status()).toBe('common.saved');
  });

  it('saves trimmed ids, clears an emptied one, and settles on what the server holds', async () => {
    mocks.update.mockResolvedValueOnce(saved({ ga4: '', plausible: 'docs.acme.com', campaignDimensions: true, storePublicSearchTerms: false }));
    await type(ga4(), '   ');
    await type(plausible(), '  docs.acme.com ');
    await click(campaign());
    await save();
    expect(mocks.update).toHaveBeenCalledWith({
      config: { analytics: { ga4: '', plausible: 'docs.acme.com', campaignDimensions: true, storePublicSearchTerms: false } },
    });
    expect(ga4().value).toBe('');
    expect(plausible().value).toBe('docs.acme.com');
    expect(region()).toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('keeps every edit after a refusal and says so once', async () => {
    mocks.update.mockRejectedValueOnce({ status: 403 });
    await type(ga4(), 'G-NEW1');
    await click(campaign());
    await save();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('Could not save');
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(ga4().value).toBe('G-NEW1');
    expect(checked(campaign())).toBe(true);
    expect(region()).not.toBeNull();
    expect(dirty.size).toBeGreaterThan(0);

    mocks.update.mockResolvedValueOnce(saved({ ga4: 'G-NEW1', campaignDimensions: true, storePublicSearchTerms: false }));
    await save();
    expect(mocks.update).toHaveBeenLastCalledWith({
      config: { analytics: { ga4: 'G-NEW1', campaignDimensions: true, storePublicSearchTerms: false } },
    });
    expect(region()).toBeNull();
  });

  it('takes a refetch silently while clean', async () => {
    await render(site({ ga4: 'G-OTHER', plausible: 'docs.acme.com', campaignDimensions: true }));
    expect(ga4().value).toBe('G-OTHER');
    expect(plausible().value).toBe('docs.acme.com');
    expect(checked(campaign())).toBe(true);
    expect(region()).toBeNull();
  });

  it('keeps edits through a refetch while dirty, takes the server for untouched fields, and flags a field both changed', async () => {
    await type(plausible(), 'mine.acme.com');
    await click(searchTerms());
    await render(site({ ga4: 'G-OTHER', plausible: 'theirs.acme.com', campaignDimensions: true }));
    expect(plausible().value).toBe('mine.acme.com');
    expect(checked(searchTerms())).toBe(true);
    expect(ga4().value).toBe('G-OTHER');
    expect(checked(campaign())).toBe(true);
    expect(container.textContent).toContain('forms.changedElsewhere');
    expect(region()).not.toBeNull();
  });

  it('keeps edits made during a pending save through its response and the refetch after it', async () => {
    const pending = deferred<Project>();
    mocks.update.mockReturnValueOnce(pending.promise);
    await type(ga4(), 'G-SENT');
    await save();
    expect(mocks.update).toHaveBeenCalledWith({ config: { analytics: { ga4: 'G-SENT', campaignDimensions: false, storePublicSearchTerms: false } } });
    // Typed and switched while the request is in flight.
    await type(plausible(), 'docs.acme.com');
    await click(campaign());
    await act(async () => pending.resolve(saved({ ga4: 'G-SENT', campaignDimensions: false, storePublicSearchTerms: false })));
    expect(ga4().value).toBe('G-SENT');
    expect(plausible().value).toBe('docs.acme.com');
    expect(checked(campaign())).toBe(true);
    expect(region()).not.toBeNull();

    // The invalidation refetch brings back what was saved; the newer edits stay, and stay unsaved.
    await render(site({ ga4: 'G-SENT', campaignDimensions: false, storePublicSearchTerms: false }));
    expect(plausible().value).toBe('docs.acme.com');
    expect(checked(campaign())).toBe(true);
    expect(container.textContent).not.toContain('forms.changedElsewhere');
    expect(region()).not.toBeNull();

    mocks.update.mockResolvedValueOnce(saved({ ga4: 'G-SENT', plausible: 'docs.acme.com', campaignDimensions: true, storePublicSearchTerms: false }));
    await save();
    expect(mocks.update).toHaveBeenLastCalledWith({
      config: { analytics: { ga4: 'G-SENT', plausible: 'docs.acme.com', campaignDimensions: true, storePublicSearchTerms: false } },
    });
    expect(region()).toBeNull();
  });

  it('starts over on another site, dropping the first site’s draft', async () => {
    await type(ga4(), 'G-DRAFT');
    await click(campaign());
    await render(site({ plausible: 'other.acme.com', storePublicSearchTerms: true }, 'site-2'));
    expect(ga4().value).toBe('');
    expect(plausible().value).toBe('other.acme.com');
    expect(checked(campaign())).toBe(false);
    expect(checked(searchTerms())).toBe(true);
    expect(region()).toBeNull();
    expect(dirty.size).toBe(0);
  });

  // Regression: the opt-ins used to be useState seeded once, outside the form.
  // A server change never reached them, so the next save of any field sent the
  // stale value back and turned the opt-in off again.
  it('saves the opt-in the server now holds, not the one the page opened with', async () => {
    await render(site({ ga4: 'G-ABC123', campaignDimensions: true }));
    expect(checked(campaign())).toBe(true);
    mocks.update.mockResolvedValueOnce(saved({ ga4: 'G-ABC999', campaignDimensions: true }));
    await type(ga4(), 'G-ABC999');
    await save();
    expect(mocks.update).toHaveBeenCalledWith({
      config: { analytics: { ga4: 'G-ABC999', campaignDimensions: true, storePublicSearchTerms: false } },
    });
  });
});
