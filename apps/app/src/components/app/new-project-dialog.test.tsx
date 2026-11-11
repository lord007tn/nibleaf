// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';

const mocks = vi.hoisted(() => ({
  locale: 'en',
  navigate: vi.fn(),
  create: vi.fn(),
  availability: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useLocale: () => ({
    locale: mocks.locale,
    t: (key: string, variables?: Record<string, string>) => (variables?.slug ? `${key}: ${variables.slug}` : key),
  }),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/env', () => ({ env: { VITE_SITE_BASE_DOMAIN: '*.nibleaf.com' } }));
vi.mock('@/hooks/api', () => ({ useCreateProject: () => ({ mutateAsync: mocks.create, isPending: false }) }));
vi.mock('@/services/api', () => ({ api: { app: { projects: { availability: { $get: mocks.availability } } } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

import { NewProjectDialog } from './new-project-dialog';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];
const clients: QueryClient[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.create.mockResolvedValue({ id: 'site', firstPageId: 'welcome-page' });
  mocks.availability.mockImplementation(async ({ query }: { query: { name: string; slug?: string } }) =>
    Response.json({ data: { slug: query.slug ?? 'acme-docs', available: true, suggestedSlug: query.slug ?? 'acme-docs', nameTaken: false } }),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  for (const client of clients.splice(0)) client.clear();
  document.body.replaceChildren();
});
async function render() {
  const node = document.createElement('div');
  document.body.append(node);
  const root = createRoot(node);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const close = vi.fn();
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NewProjectDialog open organizationId="org-a" onOpenChange={close} />
      </QueryClientProvider>,
    ),
  );
  return close;
}
function accessibleName(element: Element): string {
  return [...element.childNodes]
    .map((node) =>
      node.nodeType === Node.TEXT_NODE
        ? node.textContent
        : node instanceof Element && node.getAttribute('aria-hidden') !== 'true' && !node.classList.contains('invisible')
          ? accessibleName(node)
          : '',
    )
    .join('')
    .trim();
}
const button = (text: string) => {
  const match = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => accessibleName(item) === text);
  if (!match) throw new Error(`Missing button ${text}`);
  return match;
};
const isDisabled = (element: HTMLButtonElement) => element.disabled || element.getAttribute('aria-disabled') === 'true';
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function element<T extends HTMLElement>(selector: string): T {
  const match = document.querySelector<T>(selector);
  if (!match) throw new Error(`Missing ${selector}`);
  return match;
}
const nameField = () => element<HTMLInputElement>('input:not([type="hidden"])');
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
async function nameSite() {
  await type(nameField(), 'Acme Docs');
  await settle();
}

describe('create site dialog', () => {
  it('shows the final address including an automatically suggested suffix and disables stale checks', async () => {
    mocks.availability.mockResolvedValue(
      Response.json({ data: { slug: 'acme-docs-2', available: true, suggestedSlug: 'acme-docs-2', nameTaken: false } }),
    );
    await render();
    await nameSite();
    expect(document.querySelector('output')?.textContent).toBe('acme-docs-2.nibleaf.com');
    expect(isDisabled(button('newSite.continue'))).toBe(false);
    await type(nameField(), 'Another');
    expect(isDisabled(button('newSite.continue'))).toBe(true);
  });
  it('shows an inline duplicate-name warning and blocks advancing', async () => {
    mocks.availability.mockResolvedValue(
      Response.json({ data: { slug: 'acme-docs-2', available: true, suggestedSlug: 'acme-docs-2', nameTaken: true } }),
    );
    await render();
    await nameSite();
    expect(document.body.textContent).toContain('newSite.nameTaken');
    expect(isDisabled(button('newSite.continue'))).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('defaults to the supported UI language and lists English and Arabic first', async () => {
    mocks.locale = 'ar';
    await render();
    const trigger = element<HTMLElement>('[role="combobox"]');
    expect(trigger.textContent).toContain('العربية');
    await click(trigger);
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.slice(0, 2).map((option) => option.textContent)).toEqual(['English', 'العربية']);
    await click(options[0] as HTMLElement);
    await nameSite();
    await click(button('newSite.continue'));
    await click(button('newSite.create'));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }));
  });
  it.each(['blank', 'product-docs', 'help-center'])('submits the %s starting point and opens the first page', async (starter) => {
    const close = await render();
    await nameSite();
    await click(button('newSite.continue'));
    expect(close).not.toHaveBeenCalled();
    const radio = element<HTMLInputElement>(`input[type="radio"][value="${starter}"]`);
    expect(radio.closest('label')).not.toBeNull();
    await click(radio);
    await click(button('newSite.create'));
    expect(mocks.create).toHaveBeenCalledWith({ name: 'Acme Docs', slug: 'acme-docs', organizationId: 'org-a', language: 'en', starter });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/app/projects/$projectId/editor',
      params: { projectId: 'site' },
      search: { page: 'welcome-page' },
    });
    expect(close).toHaveBeenCalledWith(false);
  });
  it('creates a blank site for import and opens the contentImport settings section', async () => {
    await render();
    await nameSite();
    await click(button('newSite.continue'));
    await click(button('newSite.importInstead'));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ starter: 'blank' }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/app/projects/$projectId/settings',
      params: { projectId: 'site' },
      search: { section: 'contentImport' },
    });
  });
  it('shows the suggestion for a taken typed address and uses it only when chosen', async () => {
    await render();
    await nameSite();
    await click(button('newSite.editAddress'));
    const input = element<HTMLInputElement>('input[dir="ltr"]');
    mocks.availability.mockImplementation(async ({ query }: { query: { slug: string } }) =>
      Response.json({ data: { slug: query.slug, available: query.slug !== 'taken', suggestedSlug: 'taken-2', nameTaken: false } }),
    );
    await type(input, 'taken');
    await settle();
    expect(input.value).toBe('taken');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(isDisabled(button('newSite.continue'))).toBe(true);
    expect(document.body.textContent).toContain('newSite.slugTaken: taken-2');
    await click(button('newSite.useSuggestion: taken-2'));
    await settle();
    expect(input.value).toBe('taken-2');
    expect(isDisabled(button('newSite.continue'))).toBe(false);
  });
  it('keeps the dialog open after a racing slug conflict and shows the suggested address', async () => {
    const close = await render();
    await nameSite();
    await click(button('newSite.continue'));
    mocks.create.mockRejectedValue(
      new ApiResponseError('taken', 409, 'database:conflict', undefined, undefined, undefined, undefined, {
        reason: 'slug_taken',
        suggestedSlug: 'acme-docs-2',
      }),
    );
    await click(button('newSite.create'));
    expect(close).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('newSite.slugTaken: acme-docs-2');
    expect(isDisabled(button('newSite.continue'))).toBe(true);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('shows a retryable availability failure and does not allow creation', async () => {
    mocks.availability.mockRejectedValue(new Error('offline'));
    await render();
    await nameSite();
    expect(document.body.textContent).toContain('newSite.checkError');
    expect(isDisabled(button('newSite.continue'))).toBe(true);
    mocks.availability.mockResolvedValue(
      Response.json({ data: { slug: 'acme-docs', available: true, suggestedSlug: 'acme-docs', nameTaken: false } }),
    );
    await click(button('common.retry'));
    await settle();
    expect(isDisabled(button('newSite.continue'))).toBe(false);
  });
  it('does not advance on Enter while the name or availability is invalid', async () => {
    await render();
    await act(async () => document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(document.querySelector('input[type="radio"]')).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('submits once and prevents cancellation while creation is pending', async () => {
    let resolve!: (value: { id: string; firstPageId: string }) => void;
    mocks.create.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const close = await render();
    await nameSite();
    await click(button('newSite.continue'));
    await act(async () => {
      const form = document.querySelector('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => clients[0]?.invalidateQueries({ queryKey: ['projects'] }));
    expect(mocks.availability).toHaveBeenCalledTimes(1);
    await click(button('common.cancel'));
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    await act(async () => resolve({ id: 'site', firstPageId: 'welcome-page' }));
    expect(close).toHaveBeenCalledWith(false);
  });
  it.each([
    ['مركز المساعدة', 'site-0s7xtf9', true],
    ['وثائق جود 263', 'site-178xry5', true],
    ['Jood وثائق', 'jood', false],
    ['Acme Docs', 'acme-docs', false],
    ['وثائق جود للمساعدة X', 'site-12zr2ig', true],
  ] as const)('previews a usable address and prompts for Latin letters when needed: %s', async (name, expected, fallback) => {
    mocks.availability.mockImplementation(async ({ query }: { query: { slug?: string } }) =>
      Response.json({ data: { slug: query.slug ?? expected, available: true, suggestedSlug: query.slug ?? expected, nameTaken: false } }),
    );
    await render();
    await type(nameField(), name);
    // Check the immediate local preview, before the debounced server response.
    expect(document.querySelector('output')?.textContent).toBe(`${expected}.nibleaf.com`);
    const address = document.querySelector<HTMLInputElement>('input[dir="ltr"]');
    expect(Boolean(address)).toBe(fallback);
    if (fallback) {
      expect(address?.value).toBe(expected);
      expect(document.body.textContent).toContain('newSite.addressLatinHint');
    } else {
      expect(document.body.textContent).not.toContain('newSite.addressLatinHint');
    }
    await settle();
    expect(isDisabled(button('newSite.continue'))).toBe(false);
  });

  it('creates with the preselected Product docs starter without clicking a card', async () => {
    await render();
    await nameSite();
    await click(button('newSite.continue'));
    expect(element<HTMLInputElement>('input[value="product-docs"]').checked).toBe(true);
    expect(isDisabled(button('newSite.create'))).toBe(false);
    await click(button('newSite.create'));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ starter: 'product-docs' }));
  });

  it('shows the final neutral suffix and preserves an address the author edits', async () => {
    mocks.availability.mockImplementation(async ({ query }: { query: { slug?: string } }) =>
      Response.json({
        data: { slug: query.slug ?? 'site-178xry5-2', available: true, suggestedSlug: query.slug ?? 'site-178xry5-2', nameTaken: false },
      }),
    );
    await render();
    await type(nameField(), 'وثائق جود 263');
    await settle();
    const address = element<HTMLInputElement>('input[dir="ltr"]');
    expect(address.value).toBe('site-178xry5-2');
    expect(document.querySelector('output')?.textContent).toBe('site-178xry5-2.nibleaf.com');
    await type(address, 'help-center');
    await settle();
    await type(nameField(), 'مركز المساعدة');
    await settle();
    expect(address.value).toBe('help-center');
    await type(nameField(), 'Jood Docs');
    await settle();
    expect(element<HTMLInputElement>('input[dir="ltr"]').value).toBe('help-center');
    await click(button('newSite.continue'));
    await click(button('newSite.create'));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'help-center' }));
  });
});
