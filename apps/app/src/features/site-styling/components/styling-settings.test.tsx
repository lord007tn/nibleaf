// @vitest-environment jsdom
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, StrictMode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { Project } from '@/hooks/api';
import type { StylingConfig } from '../model/styling';
import { StylingSettings } from './styling-settings';

const mocks = vi.hoisted(() => ({ updateProject: vi.fn(), toastError: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock('@/hooks/api', () => ({ useUpdateProjectConfig: () => ({ mutateAsync: mocks.updateProject, isPending: false }) }));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: (_t: unknown, _error: unknown, fallback: string) => `friendly:${fallback}` }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/** A site as the project query returns it; the theme rides along. */
const site = (styling: StylingConfig = {}, id = 'site-a') =>
  ({ id, name: 'Handbook', config: { theme: { preset: 'harbor' }, styling } }) as unknown as Project;

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
let strict = false;
let direction: 'ltr' | 'rtl' = 'ltr';
/** What each commit of the canvas showed, read before the browser could paint it. */
let commits: Array<{ invalid: boolean; message: boolean }>;

/** Reads the DOM in the same commit as the section above it (a layout effect runs before paint). */
function CommitProbe() {
  useLayoutEffect(() => {
    commits.push({
      invalid: container.querySelector('[aria-invalid="true"]') !== null,
      message: container.textContent?.includes('settings.styling.invalidHex') ?? false,
    });
  });
  return null;
}

const render = (project: Project) => {
  const tree = (
    <QueryClientProvider client={new QueryClient()}>
      <DirectionProvider direction={direction}>
        <ConfigDirtyProvider report={() => undefined}>
          <StylingSettings project={project} />
        </ConfigDirtyProvider>
      </DirectionProvider>
      <CommitProbe />
    </QueryClientProvider>
  );
  return act(async () => root.render(strict ? <StrictMode>{tree}</StrictMode> : tree));
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  commits = [];
  strict = false;
  direction = 'ltr';
  mocks.updateProject.mockImplementation(async ({ config }: { config: { styling: StylingConfig } }) => site(config.styling));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const hex = () => container.querySelector<HTMLInputElement>('input[aria-label="settings.styling.primaryColor.label"]') as HTMLInputElement;
const type = (text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(hex(), text);
    hex().dispatchEvent(new Event('input', { bubbles: true }));
  });
const leave = () => act(async () => hex().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
const buttonNamed = (name: string) => {
  const found = [...container.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === name || button.textContent?.trim().startsWith(name),
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
const click = (name: string) => act(async () => buttonNamed(name).click());
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
const save = async () => {
  await click('common.save');
  await settle();
};
const region = () => container.querySelector('[data-slot="save-region"]');
const status = () => container.querySelector('[role="status"][aria-live="polite"]')?.textContent?.trim() ?? '';
/** The problem as assistive tech gets it: the field marked invalid and described by the message. */
const problem = () => {
  const describedBy = hex().getAttribute('aria-describedby');
  const message = describedBy ? document.getElementById(describedBy)?.textContent : undefined;
  return { invalid: hex().getAttribute('aria-invalid') === 'true', message: message ?? null };
};
const SHOWN = { invalid: true, message: 'settings.styling.invalidHex' };
const HIDDEN = { invalid: false, message: null };
/** Enter as the browser delivers it: the keydown, then implicit submission's click on the default button. */
const pressEnter = async (init: KeyboardEventInit = {}) => {
  await act(async () => {
    hex().focus();
    hex().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
    hex().form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  });
  await settle();
};
const pressSaveShortcut = () =>
  act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  });

describe.each([false, true])('StylingSettings — when the color problem shows (StrictMode: %s)', (inStrictMode) => {
  beforeEach(() => {
    strict = inStrictMode;
  });

  it('a pristine invalid stored value and partial typing show nothing until the field is left; a fix clears it; once left it follows the text', async () => {
    await render(site({ primaryColor: 'teal' }));
    expect(problem()).toStrictEqual(HIDDEN);
    await type('#12');
    expect(problem()).toStrictEqual(HIDDEN);
    await leave();
    expect(problem()).toStrictEqual(SHOWN);
    await type('#123');
    expect(problem()).toStrictEqual(HIDDEN);
    await type('#12');
    expect(problem()).toStrictEqual(SHOWN);
  });

  it('a save try shows it, focuses the field and sends nothing', async () => {
    await render(site({ primaryColor: '#5546e8' }));
    await type('#12');
    await save();
    expect(problem()).toStrictEqual(SHOWN);
    expect(document.activeElement).toBe(hex());
    expect(status()).toBe('forms.fixHighlighted');
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it('an invalid text typed during a save stays shown when the save settles unclean; a clean save resets what was shown', async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(site({ primaryColor: '#5546e8' }));
    await click('#16a34a');
    await click('common.save');
    await type('#1');
    expect(problem()).toStrictEqual(SHOWN);
    await act(async () => pending.resolve(site({ primaryColor: '#16a34a' })));
    await settle();
    expect(hex().value).toBe('#1');
    expect(problem()).toStrictEqual(SHOWN);
    expect(region()).not.toBeNull();

    await type('#0ea5e9');
    await save();
    expect(region()).toBeNull();
    // Settled: nothing was left or tried any more, so new partial text waits for the field to be left again.
    await type('#0e');
    expect(problem()).toStrictEqual(HIDDEN);
  });

  it('a failed save keeps the edit and what was shown, with one error', async () => {
    mocks.updateProject.mockRejectedValueOnce(new Error('offline'));
    await render(site({ primaryColor: '#5546e8' }));
    await type('#0ea5e9');
    await leave();
    await save();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('friendly:settings.saveError');
    expect(hex().value).toBe('#0EA5E9');
    await type('#0e');
    expect(problem()).toStrictEqual(SHOWN);
  });

  it('Discard resets what was shown', async () => {
    await render(site({ primaryColor: '#5546e8' }));
    await type('#12');
    await leave();
    expect(problem()).toStrictEqual(SHOWN);
    await click('forms.discard');
    expect(hex().value).toBe('#5546E8');
    await type('#12');
    expect(problem()).toStrictEqual(HIDDEN);
  });

  it('another site starts clean from its first commit, and so does coming back', async () => {
    await render(site({ primaryColor: '#5546e8' }, 'site-a'));
    await type('#12');
    await leave();
    expect(problem()).toStrictEqual(SHOWN);
    commits = [];
    await render(site({ primaryColor: '#0ea5e9' }, 'site-b'));
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((commit) => !(commit.invalid || commit.message))).toBe(true);
    expect(hex().value).toBe('#0EA5E9');
    await type('#0');
    expect(problem()).toStrictEqual(HIDDEN);
    commits = [];
    await render(site({ primaryColor: '#5546e8' }, 'site-a'));
    expect(commits.every((commit) => !(commit.invalid || commit.message))).toBe(true);
    expect(hex().value).toBe('#5546E8');
    await type('#12');
    expect(problem()).toStrictEqual(HIDDEN);
  });
});

describe('StylingSettings — conflicts and what stays shown', () => {
  it('"Use theirs" on the radius leaves the invalid color and its problem; on the color it resolves it', async () => {
    await render(site({ primaryColor: '#5546e8', radius: 'rounded' }));
    await type('#12');
    await leave();
    await click('settings.styling.radius.pill');
    await render(site({ primaryColor: '#5546e8', radius: 'sharp' }));
    expect(container.textContent).toContain('forms.changedElsewhere');
    await click('forms.useTheirs');
    expect(hex().value).toBe('#12');
    expect(problem()).toStrictEqual(SHOWN);

    await render(site({ primaryColor: '#0f172a', radius: 'sharp' }));
    await click('forms.useTheirs');
    expect(hex().value).toBe('#0F172A');
    expect(problem()).toStrictEqual(HIDDEN);
    expect(region()).toBeNull();
  });

  it('"Keep mine" keeps my color against theirs and saves it alone', async () => {
    await render(site({ primaryColor: '#5546e8', theme: 'dark' }));
    await click('#a855f7');
    await render(site({ primaryColor: '#0f172a', theme: 'dark' }));
    await click('forms.keepMine');
    await save();
    expect(mocks.updateProject).toHaveBeenLastCalledWith({ config: { styling: { primaryColor: '#a855f7' } } });
  });
});

describe('StylingSettings — controls', () => {
  it('sliders keep their exact position while the color they make is the draft: gray keeps its hue, 360 stays 360', async () => {
    await render(site({ primaryColor: '#ef4444' }));
    const slider = (name: string) => container.querySelector<HTMLInputElement>(`input[aria-label="settings.styling.${name}"]`) as HTMLInputElement;
    const slide = (name: string, value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(slider(name), value);
        slider(name).dispatchEvent(new Event('input', { bubbles: true }));
      });
    await slide('hue', '200');
    await slide('saturation', '0');
    expect(slider('hue').value).toBe('200');
    expect(hex().value).toBe('#999999');
    await slide('saturation', '80');
    await slide('hue', '360');
    expect(slider('hue').value).toBe('360');
    expect(hex().value).toBe('#EB4747');
    await slide('lightness', '0');
    expect(hex().value).toBe('#000000');
    expect(slider('saturation').value).toBe('80');
    // Typing a color moves the sliders to it.
    await type('#00ff00');
    expect([slider('hue').value, slider('saturation').value, slider('lightness').value]).toStrictEqual(['120', '100', '50']);
  });

  it.each([
    ['ltr', '90deg'],
    ['rtl', '270deg'],
  ] as const)('in %s the hex reads left to right and the slider tracks run %s, start to end', async (writing, angle) => {
    direction = writing;
    await render(site({ primaryColor: '#5546e8' }));
    expect(hex().getAttribute('dir')).toBe('ltr');
    for (const name of ['hue', 'saturation', 'lightness']) {
      const track = container.querySelector<HTMLInputElement>(`input[aria-label="settings.styling.${name}"]`)?.style.getPropertyValue('--pl-track');
      expect(track).toContain(`linear-gradient(${angle}`);
    }
  });

  it('the preset in use is pressed', async () => {
    await render(site({ primaryColor: '#0EA5E9' }));
    expect(buttonNamed('#0ea5e9').getAttribute('aria-pressed')).toBe('true');
    expect(buttonNamed('#5546e8').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('StylingSettings — Enter, IME, modifiers and Ctrl+S share one save', () => {
  it('plain Enter saves; Enter in an IME composition or with Shift does not; a second Enter or Ctrl+S during the save starts nothing', async () => {
    const pending = deferred<Project>();
    mocks.updateProject.mockReturnValueOnce(pending.promise);
    await render(site({ primaryColor: '#5546e8' }));
    await type('#0ea5e9');
    await pressEnter({ isComposing: true });
    await pressEnter({ keyCode: 229 });
    await pressEnter({ shiftKey: true });
    expect(mocks.updateProject).not.toHaveBeenCalled();
    await pressEnter();
    await pressEnter();
    await pressSaveShortcut();
    await settle();
    expect(mocks.updateProject).toHaveBeenCalledTimes(1);
    expect(mocks.updateProject).toHaveBeenCalledWith({ config: { styling: { primaryColor: '#0ea5e9' } } });
    await act(async () => pending.resolve(site({ primaryColor: '#0ea5e9' })));
    await settle();
    expect(status()).toBe('common.saved');
    expect(region()).toBeNull();
  });

  it('Ctrl+S with an invalid color takes the same path as Save: shown, focused, nothing sent', async () => {
    await render(site({ primaryColor: '#5546e8' }));
    await type('#12');
    await pressSaveShortcut();
    await settle();
    expect(problem()).toStrictEqual(SHOWN);
    expect(document.activeElement).toBe(hex());
    expect(status()).toBe('forms.fixHighlighted');
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });
});
