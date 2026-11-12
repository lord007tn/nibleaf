// @vitest-environment jsdom

import { setLanguage } from '@nibleaf/i18n/locale-state';
import { useT } from '@nibleaf/i18n/react';
import { cookieName } from '@nibleaf/i18n/runtime';
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalizedProductProviders } from './localized-product-providers';

function ProductPage() {
  const t = useT();
  return <button type="button">{t('auth.otp.sendSignIn')}</button>;
}

const page = () => (
  <LocalizedProductProviders>
    <ProductPage />
  </LocalizedProductProviders>
);

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // The toaster reads the colour scheme.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })),
  );
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom fixture cleanup; no browser account cookies are accessed.
  document.cookie = `${cookieName}=; Max-Age=0; path=/`;
  for (const name of ['lang', 'dir', 'data-locale']) document.documentElement.removeAttribute(name);
  vi.unstubAllGlobals();
});

/** Server HTML as src/server.ts renders it for an Arabic request: Arabic text
 *  inside `<html lang="ar" dir="rtl" data-locale="ar">`. */
async function hydrateArabicServerHtml() {
  document.documentElement.setAttribute('lang', 'ar');
  document.documentElement.setAttribute('dir', 'rtl');
  document.documentElement.setAttribute('data-locale', 'ar');
  container = document.createElement('div');
  container.innerHTML = renderToString(page());
  document.body.append(container);
  const before = container.textContent;
  const changes: string[] = [];
  const observer = new MutationObserver(() => changes.push(container?.textContent ?? ''));
  observer.observe(container, { childList: true, characterData: true, subtree: true });
  const documentChanges: string[] = [];
  const documentObserver = new MutationObserver((records) => documentChanges.push(...records.map((record) => record.attributeName ?? '')));
  documentObserver.observe(document.documentElement, { attributes: true });
  const errors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container as HTMLDivElement, page(), { onRecoverableError: (error) => errors.push(error) });
  });
  // Let effects, subscriptions and any follow-up render settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  observer.disconnect();
  documentObserver.disconnect();
  return { before, after: container.textContent, changes, documentChanges, errors };
}

it('hydrates an Arabic server render without a mismatch, a language switch or a direction flip', async () => {
  // biome-ignore lint/suspicious/noDocumentCookie: exercise the real Paraglide cookie resolver in isolated jsdom.
  document.cookie = `${cookieName}=ar; path=/`;
  const result = await hydrateArabicServerHtml();
  expect(result.before).toBe('تسجيل الدخول');
  expect(result.errors).toEqual([]);
  expect(result.changes).toEqual([]);
  expect(result.after).toBe(result.before);
  expect(result.documentChanges).toEqual([]);
  expect(document.documentElement.dir).toBe('rtl');
  expect(document.documentElement.lang).toBe('ar');
});

it('hydrates against the server’s locale even when the browser alone would pick another one', async () => {
  // No cookie yet, and a browser preference that differs from the request's
  // Accept-Language (for example a reduced header): hydration still matches the
  // server HTML, and only then follows the browser.
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
  const result = await hydrateArabicServerHtml();
  expect(result.before).toBe('تسجيل الدخول');
  expect(result.errors).toEqual([]);
});

it('keeps the server’s Arabic after hydration settles, even when the browser alone would pick English', async () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
  const result = await hydrateArabicServerHtml();
  expect(result.changes).toEqual([]);
  expect(result.after).toBe('تسجيل الدخول');
  expect(result.documentChanges).toEqual([]);
  expect(document.documentElement.lang).toBe('ar');
  expect(document.documentElement.dir).toBe('rtl');
});

it('keeps the server’s Arabic when the language cookie changed before hydration', async () => {
  // biome-ignore lint/suspicious/noDocumentCookie: exercise the real Paraglide cookie resolver in isolated jsdom.
  document.cookie = `${cookieName}=en; path=/`;
  const result = await hydrateArabicServerHtml();
  expect(result.changes).toEqual([]);
  expect(result.after).toBe('تسجيل الدخول');
  expect(document.documentElement.dir).toBe('rtl');
});

it('switches language only when the visitor picks one', async () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ar']);
  const result = await hydrateArabicServerHtml();
  expect(result.after).toBe('تسجيل الدخول');
  await act(async () => {
    await setLanguage('en');
  });
  expect(container?.textContent).toBe('Log in');
  expect(document.documentElement.dir).toBe('ltr');
  expect(document.documentElement.lang).toBe('en');
});
