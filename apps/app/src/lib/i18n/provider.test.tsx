// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectionProvider } from '@/components/direction-provider';
import { LocaleProvider, useLocale } from './index';
import { useStandaloneT } from './standalone';

const englishMessages = { 'common.cancel': 'Cancel' };
const arabicMessages = { 'common.cancel': 'إلغاء' };

function LocaleControl() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div>
      <output>
        {locale}:{t('common.cancel')}
      </output>
      <button type="button" onClick={() => setLocale('ar')}>
        Arabic
      </button>
      <button type="button" onClick={() => setLocale('en')}>
        English
      </button>
    </div>
  );
}

function StandaloneLoading() {
  const t = useStandaloneT();
  return <span>{t('common.loading')}</span>;
}

describe('LocaleProvider', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
  });

  it('hydrates in English, then loads a persisted Arabic catalog and RTL direction', async () => {
    window.localStorage.setItem('nibleaf.locale', 'ar');
    window.localStorage.setItem('nibleaf.direction', 'rtl');
    const loadMessages = vi.fn(async () => ({ default: arabicMessages }));

    await act(async () => {
      root.render(
        <DirectionProvider>
          <LocaleProvider englishMessages={englishMessages} loadMessages={loadMessages}>
            <LocaleControl />
          </LocaleProvider>
        </DirectionProvider>,
      );
    });

    expect(loadMessages).toHaveBeenCalledWith('ar');
    expect(container.querySelector('output')?.textContent).toBe('ar:إلغاء');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('switches locales, persists the choice, and ignores a stale Arabic load', async () => {
    let finishArabic: ((value: { default: typeof arabicMessages }) => void) | undefined;
    const loadMessages = vi.fn(
      () =>
        new Promise<{ default: typeof arabicMessages }>((resolve) => {
          finishArabic = resolve;
        }),
    );

    act(() => {
      root.render(
        <DirectionProvider>
          <LocaleProvider englishMessages={englishMessages} loadMessages={loadMessages}>
            <LocaleControl />
          </LocaleProvider>
        </DirectionProvider>,
      );
    });
    const output = container.querySelector('output');
    const [arabicButton, englishButton] = container.querySelectorAll('button');
    expect(output?.textContent).toBe('en:Cancel');

    act(() => arabicButton?.click());
    expect(window.localStorage.getItem('nibleaf.locale')).toBe('ar');
    act(() => englishButton?.click());
    expect(window.localStorage.getItem('nibleaf.locale')).toBe('en');

    await act(async () => finishArabic?.({ default: arabicMessages }));
    expect(output?.textContent).toBe('en:Cancel');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('keeps router boundary text identical for SSR, then applies a stored locale after mount', async () => {
    window.localStorage.setItem('nibleaf.locale', 'ar');
    expect(renderToString(<StandaloneLoading />)).toContain('Loading…');

    await act(async () => root.render(<StandaloneLoading />));
    expect(container.textContent).toBe('جارٍ التحميل…');
  });
});
