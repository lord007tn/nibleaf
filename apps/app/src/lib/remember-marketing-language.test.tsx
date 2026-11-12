// @vitest-environment jsdom

import { cookieName } from '@nibleaf/i18n/runtime';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRememberMarketingLanguage } from './remember-marketing-language';

function Page({ pathname, href }: { pathname: string; href: string }) {
  useRememberMarketingLanguage(pathname);
  return (
    <a href={href} onClick={(event) => event.preventDefault()}>
      <span>ابدأ مجانًا</span>
    </a>
  );
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const savedLocale = () =>
  document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);

async function clickLink(pathname: string, href: string, init: MouseEventInit = { button: 0 }, type = 'click') {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<Page pathname={pathname} href={href} />));
  container.querySelector('span')?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom fixture; the browser already chose English.
  document.cookie = `${cookieName}=en; path=/`;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom fixture cleanup; no browser account cookies are accessed.
  document.cookie = `${cookieName}=; Max-Age=0; path=/`;
  vi.unstubAllGlobals();
});

it('saves Arabic when a visitor follows a link from the Arabic site to sign-up', async () => {
  await clickLink('/ar', '/sign-up');
  expect(savedLocale()).toBe('ar');
});

it('saves Arabic for sign-in, and for a link opened with the middle button', async () => {
  await clickLink('/ar/pricing', '/sign-in?redirect=%2Fapp', { button: 1 }, 'auxclick');
  expect(savedLocale()).toBe('ar');
});

it('leaves the language alone for other links on the Arabic site', async () => {
  await clickLink('/ar', '/ar/pricing');
  expect(savedLocale()).toBe('en');
});

it('leaves the language alone on the English site', async () => {
  await clickLink('/pricing', '/sign-up');
  expect(savedLocale()).toBe('en');
});

it('leaves the language alone for a sign-up link to another site', async () => {
  await clickLink('/ar', 'https://example.com/sign-up');
  expect(savedLocale()).toBe('en');
});
