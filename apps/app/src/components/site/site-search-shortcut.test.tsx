// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The '/' preference's edge orders (WCAG 2.1.4, site-search-shortcut.ts): what
 * storage holds, what the reader chose this visit when it couldn't be saved,
 * and what another tab of the same site changed.
 */

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

type Shortcut = typeof import('./site-search-shortcut');
const KEY = 'nibleaf:site-search:slash-shortcut:docs';
let shortcut: Shortcut;
let root: Root | undefined;
let shown: boolean | undefined;

/** A fresh page: the module starts over, as it does on every page load. */
const loadPage = async () => {
  vi.resetModules();
  shortcut = await import('./site-search-shortcut');
};

function Reader() {
  shown = shortcut.useSlashShortcut('docs');
  return null;
}

async function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<Reader />));
}

/** Writes the preference as another tab of the same site does: storage, then a `storage` event here. */
const otherTab = (value: string | null, key: string | null = KEY) =>
  act(async () => {
    if (key === null) window.localStorage.clear();
    else if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value, storageArea: window.localStorage }));
  });

const write = (on: boolean) => act(async () => shortcut.writeSlashShortcut('docs', on));

/** Makes storage writes fail (quota full) until the returned restore runs. */
const failWrites = () =>
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  });

beforeEach(async () => {
  window.localStorage.clear();
  await loadPage();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  shown = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("the '/' preference's edge orders", () => {
  it('an unsaved off, then an on that saves: storage is in charge again', async () => {
    window.localStorage.setItem(KEY, 'on');
    await mount();
    const writes = failWrites();
    await write(false);
    expect(shown).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe('on');

    writes.mockRestore();
    await write(true);
    expect(shown).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe('on');
    // The visit's override is gone: another tab's change now applies here.
    await otherTab('off');
    expect(shown).toBe(false);
    expect(shortcut.readSlashShortcut('docs')).toBe(false);
  });

  it("applies another tab's change, including a cleared key or storage", async () => {
    await mount();
    expect(shown).toBe(true);
    await otherTab('off');
    expect(shown).toBe(false);
    await otherTab('on');
    expect(shown).toBe(true);
    await otherTab('off');
    // Cleared storage, or a removed key, falls back to the default.
    await otherTab(null);
    expect(shown).toBe(true);
    await otherTab('off');
    await otherTab(null, null);
    expect(shown).toBe(true);
  });

  it("ignores other keys another tab changes, and other sites' preferences", async () => {
    await mount();
    await otherTab('off', 'nibleaf:site-search:slash-shortcut:guides');
    expect(shown).toBe(true);
    await otherTab('x', 'some-other-key');
    expect(shown).toBe(true);
  });

  it("keeps this visit's unsaved choice over another tab's change", async () => {
    await mount();
    failWrites();
    await write(false);
    expect(shown).toBe(false);
    // Another tab, whose storage writes work, turns it on.
    vi.restoreAllMocks();
    await otherTab('on');
    expect(shown).toBe(false);
    expect(shortcut.readSlashShortcut('docs')).toBe(false);
  });

  it("drops this visit's unsaved choice on a fresh page", async () => {
    window.localStorage.setItem(KEY, 'on');
    failWrites();
    await write(false);
    expect(shortcut.readSlashShortcut('docs')).toBe(false);
    vi.restoreAllMocks();

    await loadPage();
    expect(shortcut.readSlashShortcut('docs')).toBe(true);
    await mount();
    expect(shown).toBe(true);
  });
});
