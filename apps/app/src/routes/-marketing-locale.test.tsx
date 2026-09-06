// @vitest-environment jsdom

import { cookieName, getLocale } from '@nibleaf/i18n/runtime';
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import { AboutPage } from './about';
import { DeveloperResourcesPage } from './developers';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom fixture cleanup; no browser account cookies are accessed.
  document.cookie = `${cookieName}=; Max-Age=0; path=/`;
  root = undefined;
  container = undefined;
});

for (const preference of ['ar', 'en']) {
  for (const [name, Page] of [
    ['about', AboutPage],
    ['developers', DeveloperResourcesPage],
  ] as const) {
    it(`${name} keeps English SSR and hydrated content with a ${preference} preference`, async () => {
      // biome-ignore lint/suspicious/noDocumentCookie: exercise the real Paraglide cookie resolver in isolated jsdom.
      document.cookie = `${cookieName}=${preference}; path=/`;
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
      expect(getLocale()).toBe(preference);
      const cookiesBefore = document.cookie;
      const html = renderToString(<Page />);
      container = document.createElement('div');
      container.innerHTML = html;
      document.body.append(container);
      const before = container.textContent;
      expect(before).not.toMatch(/[\u0600-\u06ff]/);
      const observedText: string[] = [];
      const observer = new MutationObserver(() => observedText.push(container?.textContent ?? ''));
      observer.observe(container, { childList: true, characterData: true, subtree: true });
      const hydrationErrors: unknown[] = [];
      try {
        await act(async () => {
          root = hydrateRoot(container as HTMLDivElement, <Page />, { onRecoverableError: (error) => hydrationErrors.push(error) });
        });
        expect(container.textContent).toBe(before);
        expect(observedText.every((text) => !/[\u0600-\u06ff]/.test(text))).toBe(true);
        expect(hydrationErrors).toEqual([]);
        expect(document.documentElement.lang).toBe('en');
        expect(document.documentElement.dir).toBe('ltr');
        expect(document.cookie).toBe(cookiesBefore);
        expect(getLocale()).toBe(preference);
        if (name === 'developers') {
          expect(container.querySelector('a[href="https://docs.nibleaf.com/self-hosting/mcp"]')).not.toBeNull();
          expect(container.querySelector('a[href*="/ar/self-hosting/mcp"]')).toBeNull();
        }
      } finally {
        observer.disconnect();
      }
    });
  }
}
