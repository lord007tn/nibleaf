// @vitest-environment jsdom
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { LandingPage } from './cloud-marketing';
import { ArabicLandingPage } from './marketing/arabic-landing';
import { landingAr } from './marketing/copy/landing.ar';
import { landingEn } from './marketing/copy/landing.en';

it.each([
  ['en', LandingPage, landingEn, 'ar'],
  ['ar', ArabicLandingPage, landingAr, 'en'],
] as const)('keeps %s copy stable through hydration with another document language', async (lang, Page, copy, preference) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.documentElement.lang = preference;
  const container = document.createElement('div');
  container.innerHTML = renderToString(<Page />);
  document.body.append(container);
  const text = container.textContent;
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <Page />, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(container.textContent).toBe(text);
    expect(container.querySelector('h1')?.textContent).toBe(copy.hero.title);
    expect(container.firstElementChild?.getAttribute('lang')).toBe(lang);
    expect(document.documentElement.lang).toBe(preference);
    expect(errors).toEqual([]);
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    document.documentElement.lang = 'en';
  }
});
