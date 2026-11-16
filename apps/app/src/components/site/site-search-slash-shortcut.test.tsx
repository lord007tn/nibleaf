// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ search: vi.fn(), navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate: mocks.navigate }) }));
vi.mock('@/hooks/api/site-search', () => ({ useSiteSearch: mocks.search }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));
vi.mock('@tanstack/react-pacer', () => ({ useDebouncedValue: (value: string) => [value] }));

import { SiteSearch } from './site-search';
import { cancelSearchKeystrokes } from './site-search-keystrokes';
import { searchKeyShortcuts, useSlashShortcut } from './site-search-shortcut';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

beforeAll(async () => {
  await import('./site-search-dialog');
});

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  mocks.search.mockReturnValue({ data: [], isFetching: false, error: null, refetch: vi.fn() });
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  cancelSearchKeystrokes();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

type Props = Parameters<typeof SiteSearch>[0];

/** The reader's search trigger, as the site header renders it. */
function Trigger({ projectId, hotkey }: { projectId: string; hotkey?: 'cmdk' | 'slash' }) {
  const slashOn = useSlashShortcut(projectId);
  return <button type="button" data-trigger="" aria-keyshortcuts={searchKeyShortcuts(hotkey, slashOn)} />;
}

async function render(overrides: Partial<Props> = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const props = { projectId: 'docs', open: false, lang: 'en', ...overrides, onOpenChange: vi.fn<(open: boolean) => void>() };
  const rerender = (next: Partial<Props> = {}) =>
    act(async () =>
      root.render(
        <>
          <Trigger projectId={props.projectId} hotkey={next.hotkey ?? props.hotkey} />
          <SiteSearch {...props} {...next} />
        </>,
      ),
    );
  await rerender();
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  return { props, rerender };
}

const slashSwitch = () => document.querySelector<HTMLElement>('[role="switch"]');
const triggerShortcuts = () => document.querySelector('[data-trigger]')?.getAttribute('aria-keyshortcuts');

const slash = (init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key: '/', code: 'Slash', bubbles: true, cancelable: true, composed: true, ...init });

/** Presses '/' on `target` and reports whether search took it. */
async function pressSlash(target: EventTarget, init?: KeyboardEventInit) {
  const event = slash(init);
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** Opens search, flips the footer's '/' switch, and closes search again. */
async function turnSlashOff(rerender: (next?: Partial<Props>) => Promise<void>) {
  await rerender({ open: true });
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  const control = slashSwitch();
  if (!control) throw new Error('Missing the / switch');
  expect(control.getAttribute('aria-checked')).toBe('true');
  await act(async () => control.click());
  expect(slashSwitch()?.getAttribute('aria-checked')).toBe('false');
  await rerender({ open: false });
}

/** Types like a keyboard into whatever has focus. */
const typeKeys = (text: string) =>
  act(async () => {
    for (const key of text) {
      const target = document.activeElement ?? document.body;
      const allowed = target.dispatchEvent(slash({ key, code: key === '/' ? 'Slash' : `Key${key.toUpperCase()}` }));
      const field = document.activeElement;
      if (!allowed || !(field instanceof HTMLInputElement)) continue;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, field.value + key);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

describe("the '/' search shortcut readers can turn off (WCAG 2.1.4)", () => {
  it.each([undefined, 'cmdk', 'slash'] as const)('is on by default on a site whose shown shortcut is %s', async (hotkey) => {
    const { props } = await render({ hotkey });
    // Search takes the key: the slash is not typed anywhere.
    expect(await pressSlash(document.body)).toBe(true);
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each([
    ['an input', () => document.createElement('input')],
    ['a textarea', () => document.createElement('textarea')],
    ['a select', () => document.createElement('select')],
    [
      'an editable region',
      () => {
        const region = document.createElement('div');
        region.setAttribute('contenteditable', 'true');
        return region;
      },
    ],
    [
      'text inside an editable region',
      () => {
        const region = document.createElement('div');
        region.setAttribute('contenteditable', '');
        const text = document.createElement('strong');
        region.append(text);
        document.body.append(region);
        return text;
      },
    ],
    [
      'an input inside a shadow root',
      () => {
        const host = document.createElement('search-box');
        const field = document.createElement('input');
        host.attachShadow({ mode: 'open' }).append(field);
        document.body.append(host);
        return field;
      },
    ],
  ])('leaves a / typed in %s alone while it is on', async (_, make) => {
    // A site that shows '/', so main's opt-in shortcut is listening too.
    const { props } = await render({ hotkey: 'slash' });
    const field = make();
    if (!field.isConnected) document.body.append(field);
    expect(await pressSlash(field)).toBe(false);
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('leaves / alone mid-composition, as a dead key or with AltGr, ⌘ or Ctrl, or once another handler took it', async () => {
    const { props } = await render({ hotkey: 'slash' });
    expect(await pressSlash(document.body, { isComposing: true })).toBe(false);
    expect(await pressSlash(document.body, { key: 'Dead' })).toBe(false);
    // AltGr arrives as Ctrl+Alt on Windows.
    expect(await pressSlash(document.body, { ctrlKey: true, altKey: true })).toBe(false);
    expect(await pressSlash(document.body, { metaKey: true })).toBe(false);
    expect(await pressSlash(document.body, { ctrlKey: true })).toBe(false);
    const taken = slash();
    taken.preventDefault();
    await act(async () => {
      document.body.dispatchEvent(taken);
    });
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('once turned off, / opens nothing and types into whatever has focus, while ⌘K still opens search', async () => {
    const { props, rerender } = await render({ hotkey: 'slash' });
    await turnSlashOff(rerender);
    props.onOpenChange.mockClear();

    expect(await pressSlash(document.body)).toBe(false);
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    expect(await pressSlash(button)).toBe(false);
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    await typeKeys('a/b');
    expect(field.value).toBe('a/b');
    expect(document.activeElement).toBe(field);
    expect(props.onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  // Base UI's switch prevents Enter's default, which cmdk respects.
  it('flips the switch with Enter without opening the highlighted result', async () => {
    await render({ open: true, suggestions: [{ title: 'Getting started', path: 'getting-started' }] });
    expect(document.querySelector('[role="option"]')).not.toBeNull();
    const control = slashSwitch();
    await act(async () => {
      control?.focus();
      control?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(control?.getAttribute('aria-checked')).toBe('false');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('keeps the choice per site', async () => {
    const docs = await render({ projectId: 'docs' });
    await turnSlashOff(docs.rerender);
    expect(window.localStorage.getItem('nibleaf:site-search:slash-shortcut:docs')).toBe('off');
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    document.body.replaceChildren();

    // Another site keeps its own default.
    const guides = await render({ projectId: 'guides' });
    expect(await pressSlash(document.body)).toBe(true);
    expect(guides.props.onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
    for (const root of roots.splice(0)) await act(async () => root.unmount());
    document.body.replaceChildren();

    // The first site remembers it after a reload.
    const again = await render({ projectId: 'docs' });
    expect(await pressSlash(document.body)).toBe(false);
    expect(again.props.onOpenChange).not.toHaveBeenCalled();
    await again.rerender({ open: true });
    expect(slashSwitch()?.getAttribute('aria-checked')).toBe('false');
  });

  it('falls back to on without throwing where storage is blocked, and the switch still works for the visit', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    try {
      const { props, rerender } = await render({ projectId: 'blocked' });
      expect(await pressSlash(document.body)).toBe(true);
      expect(props.onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
      await turnSlashOff(rerender);
      props.onOpenChange.mockClear();
      expect(await pressSlash(document.body)).toBe(false);
      expect(props.onOpenChange).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('keeps the reader’s off for the visit when storage reads but cannot write', async () => {
    window.localStorage.setItem('nibleaf:site-search:slash-shortcut:quota', 'on');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    try {
      const { props, rerender } = await render({ projectId: 'quota' });
      await turnSlashOff(rerender);
      props.onOpenChange.mockClear();
      expect(await pressSlash(document.body)).toBe(false);
      expect(props.onOpenChange).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  // Class-level: jsdom applies no CSS, so a click test can't see `hidden sm:flex`.
  // '/' works at every width and pointer, so its switch must too.
  it.each([
    ['without filters', {}],
    [
      'with the language filter',
      {
        languages: [
          { code: 'en', label: 'English' },
          { code: 'ar', label: 'العربية' },
        ],
      },
    ],
  ] satisfies Array<[string, Partial<Props>]>)('keeps the switch reachable at every width and pointer type, %s', async (_, extra) => {
    await render({ open: true, ...extra });
    const control = slashSwitch();
    if (!control) throw new Error('Missing the / switch');
    const dialog = control.closest('[role="dialog"]');
    const gated: string[] = [];
    for (let node: Element | null = control; node && node !== dialog; node = node.parentElement) {
      if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') gated.push(`${node.tagName} [hidden]`);
      for (const token of node.classList) {
        // `hidden`, and any breakpoint or pointer variant that sets display (sm:flex, pointer-coarse:hidden!).
        if (
          /^(?:[\w-]+:)*(?:hidden|flex|inline-flex|block|inline-block|grid|contents)!?$/.test(token) &&
          (token === 'hidden' || token.includes(':'))
        ) {
          gated.push(`${node.tagName} .${token}`);
        }
      }
    }
    expect(gated).toEqual([]);
  });

  it.each([
    [undefined, 'Control+K Meta+K /'],
    ['slash', '/ Control+K Meta+K'],
  ] as const)("lists / in the trigger's aria-keyshortcuts only while it is on (shown shortcut %s)", async (hotkey, on) => {
    const { rerender } = await render({ hotkey });
    expect(triggerShortcuts()).toBe(on);
    await turnSlashOff(rerender);
    expect(triggerShortcuts()).toBe('Control+K Meta+K');
    await rerender({ open: true });
    await act(async () => slashSwitch()?.click());
    expect(triggerShortcuts()).toBe(on);
  });
});
