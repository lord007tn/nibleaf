// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from '@/hooks/api/client-helpers';

const mocks = vi.hoisted(() => ({
  locale: 'en',
  navigate: vi.fn(),
  create: vi.fn(),
  availability: vi.fn(),
  sites: [] as Array<{ name: string }>,
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useLocale: () => ({
    locale: mocks.locale,
    t: (key: string, variables?: Record<string, string>) => (variables?.slug ? `${key}: ${variables.slug}` : key),
  }),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/env', () => ({ env: { VITE_SITE_BASE_DOMAIN: '*.nibleaf.com' } }));
vi.mock('@/hooks/api', () => ({
  useCreateProject: () => ({ mutateAsync: mocks.create, isPending: false }),
  useOrganizationProjects: () => ({ data: mocks.sites }),
}));
vi.mock('@/services/api', () => ({ api: { app: { projects: { availability: { $get: mocks.availability } } } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

import { NewProjectDialog } from './new-project-dialog';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];
const clients: QueryClient[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.sites = [];
  mocks.create.mockResolvedValue({ id: 'site', firstPageId: 'welcome-page' });
  mocks.availability.mockImplementation(async () => Response.json({ data: { available: true } }));
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function renderDismissible() {
  const node = document.createElement('div');
  document.body.append(node);
  const root = createRoot(node);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const close = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Reopen
        </button>
        <NewProjectDialog
          open={open}
          organizationId="org-a"
          onOpenChange={(next) => {
            close(next);
            setOpen(next);
          }}
        />
      </>
    );
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    ),
  );
  return close;
}
async function escapeDialog() {
  await act(async () => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
}
async function backdropClick() {
  const backdrop = element<HTMLElement>('[data-slot="dialog-overlay"]');
  await act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
      backdrop.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
  });
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
    mocks.availability.mockResolvedValue(Response.json({ data: { available: false, suggestion: 'acme-docs-2' } }));
    await render();
    await nameSite();
    expect(document.querySelector('output')?.textContent).toBe('acme-docs-2.nibleaf.com');
    expect(isDisabled(button('newSite.continue'))).toBe(false);
    await type(nameField(), 'Another');
    expect(isDisabled(button('newSite.continue'))).toBe(true);
  });
  it('shows an inline duplicate-name warning and blocks advancing', async () => {
    mocks.sites = [{ name: '  ACME Docs ' }];
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
      Response.json({ data: { available: query.slug !== 'taken', ...(query.slug === 'taken' ? { suggestion: 'taken-2' } : {}) } }),
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
    mocks.availability.mockResolvedValue(Response.json({ data: { available: true } }));
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
    mocks.availability.mockImplementation(async () => Response.json({ data: { available: true } }));
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
        data: { available: query.slug !== undefined, ...(query.slug === undefined ? { suggestion: 'site-178xry5-2' } : {}) },
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
  it.each(['escape', 'backdrop'])('preserves the draft across %s dismissal while an availability response is deferred', async (dismissal) => {
    const check = deferred<Response>();
    mocks.availability.mockReturnValueOnce(check.promise);
    const close = await renderDismissible();
    await type(nameField(), 'Draft preserved');
    await settle();
    expect(mocks.availability).toHaveBeenCalledTimes(1);
    if (dismissal === 'escape') await escapeDialog();
    else await backdropClick();
    expect(close).toHaveBeenCalledWith(false);
    await click(button('Reopen'));
    expect(nameField().value).toBe('Draft preserved');
    await act(async () => check.resolve(Response.json({ data: { available: true } })));
    expect(nameField().value).toBe('Draft preserved');
  });

  it('keeps edits made during a deferred check and ignores an older slug response', async () => {
    const old = deferred<Response>();
    const latest = deferred<Response>();
    mocks.availability.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    await render();
    await type(nameField(), 'Acme Docs');
    await settle();
    await click(button('newSite.editAddress'));
    await type(element<HTMLInputElement>('input[dir="ltr"]'), 'new-address');
    await settle();
    await act(async () => latest.resolve(Response.json({ data: { available: true } })));
    await settle();
    await act(async () => old.resolve(Response.json({ data: { available: false, suggestion: 'stale-suggestion' } })));
    expect(element<HTMLInputElement>('input[dir="ltr"]').value).toBe('new-address');
    expect(document.querySelector('output')?.textContent).toBe('new-address.nibleaf.com');
    expect(document.body.textContent).not.toContain('stale-suggestion');
    expect(isDisabled(button('newSite.continue'))).toBe(false);
  });

  it('guards Escape/backdrop during creation and retains the failed draft after dismissal and reopen', async () => {
    const create = deferred<{ id: string; firstPageId: string }>();
    mocks.create.mockReturnValueOnce(create.promise);
    const close = await renderDismissible();
    await nameSite();
    await click(button('newSite.continue'));
    await click(button('newSite.create'));
    await escapeDialog();
    await backdropClick();
    expect(close).not.toHaveBeenCalled();
    await act(async () => create.reject(new Error('injected create failure')));
    await escapeDialog();
    expect(close).toHaveBeenCalledWith(false);
    await click(button('Reopen'));
    expect(document.body.textContent).toContain('newSite.startingPoint');
    await click(button('common.back'));
    expect(nameField().value).toBe('Acme Docs');
  });
});
