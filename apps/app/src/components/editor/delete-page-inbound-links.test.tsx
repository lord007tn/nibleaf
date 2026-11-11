/** @vitest-environment jsdom */
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), remove: vi.fn(), restore: vi.fn() }));
vi.mock('@/services/api', () => ({ api: { app: { projects: { ':projectId': { pages: { ':id': { 'inbound-links': { $get: mocks.read } } } } } } } }));
vi.mock('@/hooks/api', () => ({ useDeletePage: () => ({ mutate: mocks.remove }), friendlyErrorMessage: vi.fn() }));
vi.mock('@/hooks/api/page-trash', () => ({ useRestorePageTrash: () => ({ mutateAsync: mocks.restore }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to: _to, params, search, ...props }: { to: string; params: { projectId: string }; search: { page: string }; children: ReactNode }) => (
    <a {...props} href={`/app/projects/${params.projectId}/editor?page=${search.page}`} />
  ),
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, string | number>) => {
    if (key === 'editor.deletePage') return 'Delete page';
    if (key === 'editor.deletePageConfirm') return 'Move Setup to Trash for 30 days?';
    if (key === 'editor.deleteInboundLinks') return `${variables?.count} pages link here`;
    if (key === 'publish.more') return `+${variables?.count} more`;
    return key;
  },
}));

import { useDeletePageFlow } from './use-delete-page';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const node = { id: 'target', title: 'Setup', kind: 'PAGE' as const };
function Trigger() {
  const remove = useDeletePageFlow('project-1', []);
  return (
    <button type="button" onClick={() => void remove(node)}>
      Open delete
    </button>
  );
}

describe('delete dialog inbound-link advisory', () => {
  let root: ReturnType<typeof createRoot>;
  let client: QueryClient;
  let container: HTMLDivElement;
  beforeEach(async () => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ConfirmProvider>
            <Trigger />
          </ConfirmProvider>
        </QueryClientProvider>,
      ),
    );
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });
  const button = (name: string) => {
    const found = [...document.querySelectorAll('button')].find((b) => b.textContent === name);
    if (!found) throw new Error(`Missing ${name}`);
    return found;
  };
  const open = async () => {
    const trigger = button('Open delete');
    trigger.focus();
    await act(async () => trigger.click());
    return document.querySelector('[role="dialog"]') as HTMLElement;
  };

  it('fetches only on open, exposes a polite warning and named editor links, and keeps cancel focus', async () => {
    mocks.read.mockResolvedValue(
      Response.json({
        data: { total: 9, pages: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, title: `Topic ${i}`, path: `topic-${i}` })) },
      }),
    );
    expect(mocks.read).not.toHaveBeenCalled();
    const dialog = await open();
    await act(async () => {
      await vi.waitFor(() => expect(dialog.querySelector('[role="status"]')?.textContent).toContain('9 pages link here'));
    });
    expect(mocks.read).toHaveBeenCalledWith({ param: { projectId: 'project-1', id: 'target' } }, { init: { signal: expect.any(AbortSignal) } });
    // Accessible dialog name and description still refer to the original
    // title/Trash copy, with the async warning in its own live region.
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Delete page');
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toContain('30 days');
    const links = [...dialog.querySelectorAll('a')];
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual(
      Array.from({ length: 5 }, (_, i) => [`Topic ${i}`, `/app/projects/project-1/editor?page=p${i}`]),
    );
    expect(links.every((link) => link.target === '_blank' && link.rel.includes('noopener'))).toBe(true);
    expect(dialog.textContent).toContain('+4 more');
    expect(document.activeElement).toBe(button('Cancel'));
    await act(async () => button('Cancel').click());
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('lets deletion proceed while the lookup is still loading', async () => {
    mocks.read.mockImplementation(
      () =>
        new Promise(() => {
          /* Held until after the dialog closes. */
        }),
    );
    const dialog = await open();
    expect(dialog.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(button('Delete page').disabled).toBe(false);
    await act(async () => button('Delete page').click());
    expect(mocks.remove).toHaveBeenCalledWith('target', expect.any(Object));
  });

  it('fails open and hides cached counts when a fresh lookup errors', async () => {
    client.setQueryData(['pages', 'project-1', 'target', 'inbound-links'], { total: 4, pages: [{ id: 'old', title: 'Old result', path: 'old' }] });
    mocks.read.mockRejectedValue(new Error('offline'));
    const dialog = await open();
    await act(async () => {
      await vi.waitFor(() => expect(client.getQueryState(['pages', 'project-1', 'target', 'inbound-links'])?.status).toBe('error'));
    });
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    expect(dialog.querySelector('a')).toBeNull();
    expect(dialog.textContent).not.toContain('pages link here');
    await act(async () => button('Delete page').click());
    expect(mocks.remove).toHaveBeenCalled();
  });

  it('shows no warning for zero links', async () => {
    mocks.read.mockResolvedValue(Response.json({ data: { total: 0, pages: [] } }));
    const dialog = await open();
    await act(async () => {
      await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    });
    expect(dialog.querySelector('[data-slot="callout"]')).toBeNull();
    expect(button('Delete page').disabled).toBe(false);
  });

  it('keeps the reserved region and footer in place across loading, results, error and empty states', async () => {
    let release: (response: Response) => void = () => {
      throw new Error('Request not started');
    };
    mocks.read.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const dialog = await open();
    const region = dialog.querySelector('[data-slot="delete-page-advisory"]');
    const footer = dialog.querySelector('[data-slot="dialog-footer"]');
    const check = () => {
      expect(dialog.querySelector('[data-slot="delete-page-advisory"]')).toBe(region);
      expect(region?.classList.contains('h-72')).toBe(true);
      expect(region?.classList.contains('min-h-72')).toBe(true);
      expect(region?.classList.contains('overflow-y-auto')).toBe(true);
      expect(region?.contains(footer)).toBe(false);
      expect(footer?.previousElementSibling).toBe(region);
      expect(button('Delete page').disabled).toBe(false);
    };
    check();
    await act(async () => {
      release(Response.json({ data: { total: 1, pages: [{ id: 'source', title: 'Source', path: 'source' }] } }));
    });
    await act(async () => {
      await vi.waitFor(() => expect(dialog.querySelector('a')).not.toBeNull());
    });
    check();
    mocks.read.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['pages', 'project-1', 'target', 'inbound-links'] });
    });
    await act(async () => {
      await vi.waitFor(() => expect(dialog.querySelector('[role="status"]')).toBeNull());
    });
    check();
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    mocks.read.mockResolvedValueOnce(Response.json({ data: { total: 0, pages: [] } }));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['pages', 'project-1', 'target', 'inbound-links'] });
    });
    await act(async () => {
      await vi.waitFor(() => expect(region?.textContent).toBe(''));
    });
    check();
    expect(region?.textContent).toBe('');
  });

  it('aborts an in-flight lookup when the dialog closes', async () => {
    let requestSignal: AbortSignal | undefined;
    mocks.read.mockImplementation(
      (_args: unknown, { init: { signal } }: { init: { signal: AbortSignal } }) =>
        new Promise((_resolve, reject) => {
          requestSignal = signal;
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }),
    );
    await open();
    expect(requestSignal?.aborted).toBe(false);
    await act(async () => button('Cancel').click());
    expect(requestSignal?.aborted).toBe(true);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
