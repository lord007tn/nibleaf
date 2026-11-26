// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// An in-memory BroadcastChannel: every instance with the same name hears the
// others, as two tabs of one origin do.
class Bus {
  static channels = new Set<Bus>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) {
    Bus.channels.add(this);
  }
  postMessage(data: unknown) {
    for (const other of Bus.channels) if (other !== this && other.name === this.name) queueMicrotask(() => other.onmessage?.({ data }));
  }
  close() {
    Bus.channels.delete(this);
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  Bus.channels.clear();
  vi.stubGlobal('BroadcastChannel', Bus);
  document.documentElement.setAttribute('data-locale', 'en');
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
});
afterEach(() => vi.unstubAllGlobals());

/** The other tab, as this module sees it: a channel posting what that tab chose. */
const otherTab = () => {
  const names = [...Bus.channels].map((channel) => channel.name);
  expect(names).toHaveLength(1);
  return new Bus(names[0] as string);
};

describe('a language chosen in another tab (AUTH-20)', () => {
  it('switches this tab whole: its messages, lang and dir together', async () => {
    const { getLocale, subscribeLanguage } = await import('@nibleaf/i18n/locale-state');
    (await import('./interface-language-sync')).startInterfaceLanguageSync();
    const changed = vi.fn();
    subscribeLanguage(changed);
    otherTab().postMessage({ locale: 'ar' });
    await flush();
    await flush();
    expect(getLocale()).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(changed).toHaveBeenCalled();
  });

  it('tells the other tabs when this one chooses, and does not echo what it was told', async () => {
    const { setLanguage } = await import('@nibleaf/i18n/locale-state');
    (await import('./interface-language-sync')).startInterfaceLanguageSync();
    const other = otherTab();
    const heard = vi.fn();
    other.onmessage = (event) => heard(event.data);
    await setLanguage('de');
    await flush();
    expect(heard).toHaveBeenCalledWith({ locale: 'de' });
    heard.mockClear();
    other.postMessage({ locale: 'fr' });
    await flush();
    await flush();
    expect(heard).not.toHaveBeenCalled();
  });

  it('ignores anything that is not a supported locale', async () => {
    const { getLocale } = await import('@nibleaf/i18n/locale-state');
    (await import('./interface-language-sync')).startInterfaceLanguageSync();
    const tab = otherTab();
    tab.postMessage({ locale: 'xx' });
    tab.postMessage('ar');
    await flush();
    expect(getLocale()).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('is started only by the dashboard locale module, so published sites never open the channel', async () => {
    await import('@nibleaf/i18n/locale-state');
    expect(Bus.channels.size).toBe(0);
  });
});
