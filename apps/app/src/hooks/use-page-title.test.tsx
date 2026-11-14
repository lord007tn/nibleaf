// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { usePageTitle } from './use-page-title';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

function Titled({ title }: { title: string }) {
  usePageTitle(title);
  return null;
}

// Sol review of #643: a dashboard title stayed on /app/welcome after navigating there.
it('gives the previous title back when the page that set it goes away', async () => {
  document.title = 'Nibleaf Cloud — documentation workspace';
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root?.render(<Titled title="General · Documentation · Nibleaf" />));
  expect(document.title).toBe('General · Documentation · Nibleaf');
  await act(async () => root?.render(<Titled title="Domain · Documentation · Nibleaf" />));
  expect(document.title).toBe('Domain · Documentation · Nibleaf');
  // Navigating to a page that sets no title of its own.
  await act(async () => root?.render(null));
  expect(document.title).toBe('Nibleaf Cloud — documentation workspace');
});

it('hands over from one titled page to the next without a stale title', async () => {
  document.title = 'Fallback';
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root?.render(<Titled key="account" title="Account · Account settings · Nibleaf" />));
  await act(async () => root?.render(<Titled key="welcome" title="Create your organization · Nibleaf" />));
  expect(document.title).toBe('Create your organization · Nibleaf');
});
