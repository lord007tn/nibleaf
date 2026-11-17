// @vitest-environment jsdom
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ locale: 'en', invalidate: vi.fn() }));
vi.mock('@/functions/site', () => ({ getGitPreviewFn: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));
vi.mock('@nibleaf/i18n/locale-state', () => ({
  getLocale: () => mocks.locale,
  renderedLocale: () => mocks.locale,
  subscribeLanguage: () => () => undefined,
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: mocks.invalidate }),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { getGitPreviewFn } from '@/functions/site';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { Route } from './git-preview.$token';

const page = (id: string, path: string, content: string, versionId = 'branch_next'): SnapshotPage => ({
  id,
  parentId: null,
  versionId,
  updatedAt: '2026-11-01T00:00:00.000Z',
  languageCode: 'en',
  kind: 'PAGE',
  title: id,
  slug: path,
  path,
  icon: null,
  description: null,
  content,
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
});

const snapshot = {
  project: {
    id: 'docs',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: null,
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
    versions: [
      { id: 'branch_main', name: 'main', slug: 'main', isDefault: true },
      { id: 'branch_next', name: 'next', slug: 'next', isDefault: false },
    ],
  },
  pages: [page('Intro', 'intro', 'See [the guide](/guides/setup).'), page('Setup', 'guides/setup', 'Setup body.')],
  generatedAt: '2026-11-01T00:00:00.000Z',
} as SiteSnapshot;

afterEach(() => document.body.replaceChildren());

it('builds preview links with the version slug and opens snapshot pages in place', async () => {
  window.scrollTo = vi.fn();
  // The preview lives on the app origin, not on a site's custom domain.
  window.history.replaceState(null, '', '/git-preview/token');
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ snapshot } as never);
  const Page = Route.options.component as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  await vi.waitFor(() => expect(container.querySelector('article a')).not.toBeNull());

  const link = container.querySelector<HTMLAnchorElement>('article a');
  // The slug, never the version ID, and no `?lang=` for the default language.
  expect(link?.getAttribute('href')).toBe('/sites/docs/next/guides/setup');
  await act(async () => link?.click());
  expect(container.querySelector('article h1')?.textContent).toBe('Setup');
  await act(async () => root.unmount());
});

it('keeps a link’s #fragment and scrolls to that heading once the page renders', async () => {
  window.scrollTo = vi.fn();
  const scrolled: string[] = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
  window.history.replaceState(null, '', '/git-preview/token');
  const withFragment = {
    ...snapshot,
    pages: [
      page('Intro', 'intro', 'See [installing](/guides/setup#install).'),
      page('Setup', 'guides/setup', 'Setup body.\n\n## Install\n\nRun it.'),
    ],
  } as SiteSnapshot;
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ snapshot: withFragment } as never);
  const Page = Route.options.component as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  await vi.waitFor(() => expect(container.querySelector('article a')).not.toBeNull());

  const link = container.querySelector<HTMLAnchorElement>('article a');
  expect(link?.getAttribute('href')).toBe('/sites/docs/next/guides/setup#install');
  await act(async () => link?.click());
  await vi.waitFor(() => expect(scrolled).toContain('install'));
  expect(window.scrollTo).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it.each([false, true])('opens the page in the language an authored ?lang= link names (collision: %s)', async (collision) => {
  window.scrollTo = vi.fn();
  window.history.replaceState(null, '', '/git-preview/token');
  const arabicSetup = { ...page('الإعداد', 'guides/setup', 'محتوى الإعداد.'), id: 'Setup-ar', languageCode: 'ar' };
  const bilingual = {
    ...snapshot,
    project: {
      ...snapshot.project,
      languages: [...snapshot.project.languages, { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: null }],
    },
    pages: [
      page('Intro', 'intro', 'Read it [in Arabic](/guides/setup?lang=ar).'),
      page('Setup', 'guides/setup', 'Setup body.'),
      arabicSetup,
      ...(collision ? [page('Collision', 'ar/existing', 'Existing English content.')] : []),
    ],
  } as SiteSnapshot;
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ snapshot: bilingual } as never);
  const Page = Route.options.component as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  await vi.waitFor(() => expect(container.querySelector('article a')).not.toBeNull());

  expect(container.querySelector('article a')?.getAttribute('href')).toBe(`/sites/docs/${collision ? '~lang/ar' : 'ar'}/next/guides/setup`);
  await act(async () => container.querySelector<HTMLAnchorElement>('article a')?.click());
  expect(container.querySelector('article h1')?.textContent).toBe('الإعداد');
  await act(async () => root.unmount());
});

it('opens a sidebar page at its top', async () => {
  window.scrollTo = vi.fn();
  window.history.replaceState(null, '', '/git-preview/token');
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ snapshot } as never);
  const Page = Route.options.component as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Page />));

  const setup = [...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Preview pages"] button')].find(
    (button) => button.textContent === 'Setup',
  );
  await act(async () => setup?.click());
  expect(container.querySelector('article h1')?.textContent).toBe('Setup');
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
  await act(async () => root.unmount());
});

const translated = (base: SnapshotPage, languageCode: string, title: string, versionId = base.versionId): SnapshotPage => ({
  ...base,
  id: `${base.id}-${languageCode}-${versionId}`,
  languageCode,
  title,
  versionId,
  translationKey: base.id,
});

// Same titles in two languages and two versions: the old list showed "Setup" twice and "الإعداد" twice.
const multiScope = {
  ...snapshot,
  project: {
    ...snapshot.project,
    languages: [...snapshot.project.languages, { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: null }],
  },
  pages: [
    { ...page('Setup', 'setup', 'Main setup.', 'branch_main'), translationKey: 'Setup' },
    translated(page('Setup', 'setup', 'إعداد الرئيسي.', 'branch_main'), 'ar', 'الإعداد'),
    { ...page('Setup-next', 'setup', 'Next setup.', 'branch_next'), title: 'Setup', translationKey: 'Setup' },
    translated(page('Setup', 'setup', 'إعداد التالي.', 'branch_next'), 'ar', 'الإعداد'),
  ],
} as SiteSnapshot;

const mount = async (data: SiteSnapshot) => {
  window.scrollTo = vi.fn();
  window.history.replaceState(null, '', '/git-preview/token');
  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ snapshot: data } as never);
  const Page = Route.options.component as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  return { container, root };
};
const navButtons = (container: ParentNode, label = 'Preview pages') =>
  [...container.querySelectorAll<HTMLButtonElement>(`nav[aria-label="${label}"] button`)].map((button) => button.textContent);
/** Picks an option of a design-system Select by its visible label. */
const choose = async (trigger: Element | null | undefined, label: string) => {
  if (!trigger) throw new Error('Missing scope picker');
  await act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'mouseup']) trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
    (trigger as HTMLElement).click();
  });
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.trim() === label);
  if (!option) throw new Error(`No option ${label}`);
  await act(async () => {
    option.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    option.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    option.click();
  });
};

it('shows one language and version at a time, with the scope named on the page', async () => {
  const { container, root } = await mount(multiScope);
  expect(navButtons(container)).toEqual(['Setup']);
  expect(container.querySelector('article h1')?.textContent).toBe('Setup');
  expect(container.querySelector('article')?.textContent).toContain('Main setup.');
  expect(container.querySelector('article')?.textContent).toContain('English · main');

  const language = container.querySelector('[data-testid="git-preview-language"]');
  const version = container.querySelector('[data-testid="git-preview-version"]');
  await choose(version, 'next');
  expect(container.querySelector('article')?.textContent).toContain('Next setup.');
  expect(container.querySelector('article')?.textContent).toContain('English · next');

  // Switching language keeps the same page, in that language and version.
  await choose(language, 'العربية');
  expect(navButtons(container, 'صفحات المعاينة')).toEqual(['الإعداد']);
  expect(container.querySelector('article h1')?.textContent).toBe('الإعداد');
  expect(container.querySelector('article')?.textContent).toContain('إعداد التالي.');
  await act(async () => root.unmount());
});

it('sets the page language and direction, and speaks the shell in that language', async () => {
  const { container, root } = await mount(multiScope);
  const shell = container.firstElementChild;
  expect(shell?.getAttribute('lang')).toBe('en');
  expect(shell?.getAttribute('dir')).toBe('ltr');
  expect(container.textContent).toContain('Pull request preview');

  await choose(container.querySelector('[data-testid="git-preview-language"]'), 'العربية');
  expect(shell?.getAttribute('lang')).toBe('ar');
  expect(shell?.getAttribute('dir')).toBe('rtl');
  expect(container.textContent).toContain('معاينة طلب الدمج');
  expect(container.textContent).not.toContain('Pull request preview');
  await act(async () => root.unmount());
});

it('opens the page list as a drawer on phones and closes it after a page is picked', async () => {
  const { container, root } = await mount(snapshot);
  const open = [...container.querySelectorAll<HTMLButtonElement>('header button')].find((button) => button.textContent?.includes('Pages'));
  expect(open?.getAttribute('aria-expanded')).toBe('false');
  await act(async () => open?.click());
  const drawer = await vi.waitFor(() => {
    const element = document.querySelector<HTMLElement>('[data-slot="sheet-content"]');
    if (!element) throw new Error('drawer not open');
    return element;
  });
  expect(open?.getAttribute('aria-expanded')).toBe('true');
  expect(navButtons(drawer)).toEqual(['Intro', 'Setup']);

  const setup = [...drawer.querySelectorAll<HTMLButtonElement>('nav button')].find((button) => button.textContent === 'Setup');
  await act(async () => setup?.click());
  expect(container.querySelector('article h1')?.textContent).toBe('Setup');
  await vi.waitFor(() => expect(open?.getAttribute('aria-expanded')).toBe('false'));
  await act(async () => root.unmount());
});

it('says there is nothing to show for a snapshot without visible pages', async () => {
  const { container, root } = await mount({ ...snapshot, pages: [{ ...page('Hidden', 'hidden', ''), hidden: true }] } as SiteSnapshot);
  expect(container.querySelector('article')?.textContent).toBe('This preview has no pages to show.');
  await act(async () => root.unmount());
});

it.each([
  ['en', 'ltr', 'This preview isn’t available', 'Try again'],
  ['ar', 'rtl', 'هذه المعاينة غير متاحة', 'أعد المحاولة'],
])('explains an invalid or expired link in %s and offers to try again', async (locale, dir, title, retry) => {
  mocks.locale = locale;
  const Unavailable = Route.options.errorComponent as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Unavailable />));
  expect(container.querySelector('main')?.getAttribute('dir')).toBe(dir);
  expect(container.querySelector('h1')?.textContent).toBe(title);
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === retry)?.click());
  expect(mocks.invalidate).toHaveBeenCalledOnce();
  mocks.invalidate.mockClear();
  mocks.locale = 'en';
  await act(async () => root.unmount());
});

it('stays out of search indexes', () => {
  const head = (Route.options.head as () => { meta: Array<Record<string, string>> })();
  expect(head.meta).toContainEqual({ name: 'robots', content: 'noindex,nofollow' });
});

it('shows a log-in screen instead of the drafts when the site is not public', async () => {
  const loader = Route.options.loader as (input: { params: { token: string } }) => Promise<unknown>;
  vi.mocked(getGitPreviewFn).mockRejectedValueOnce(
    new ApiResponseError('git preview not found', 404, 'database:not_found', undefined, undefined, undefined, undefined, { reason: 'private' }),
  );
  await expect(loader({ params: { token: 'token' } })).resolves.toEqual({ snapshot: null });
  // Any other failure (an unknown or expired link) stays an error.
  vi.mocked(getGitPreviewFn).mockRejectedValueOnce(new ApiResponseError('git preview not found', 404, 'database:not_found'));
  await expect(loader({ params: { token: 'token' } })).rejects.toBeInstanceOf(ApiResponseError);

  vi.spyOn(Route, 'useLoaderData').mockReturnValue({ snapshot: null } as never);
  vi.spyOn(Route, 'useParams').mockReturnValue({ token: 'token' } as never);
  const Page = Route.options.component as ComponentType;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<Page />));
  expect(container.querySelector('h1')?.textContent).toBe('preview.privateTitle');
  expect(container.querySelector('article')).toBeNull();
  const logIn = container.querySelector<HTMLAnchorElement>('a[href="/sign-in"]');
  logIn?.addEventListener('click', (event) => event.preventDefault());
  await act(async () => logIn?.click());
  expect(window.localStorage.getItem('nibleaf.pendingDestination')).toBe('/git-preview/token');
  await act(async () => root.unmount());
});
