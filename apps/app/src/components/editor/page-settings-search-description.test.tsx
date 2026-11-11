/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageSearchDescriptionKey } from '@/hooks/api/page-search-description';
import type { PageNode } from '@/hooks/api/types';
import { PageSettingsDialog } from './page-settings-dialog';

// The real query hooks and cache; only the network edge (the RPC client) is stubbed.
const mocks = vi.hoisted(() => ({ searchDescription: vi.fn() }));
vi.mock('@/services/api', () => ({
  api: { app: { projects: { ':projectId': { pages: { ':id': { 'search-description': { $get: mocks.searchDescription } } } } } } },
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@nibleaf/design-system/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));

const BEFORE_SAVE = '2026-11-10T08:00:00.000Z';
const AFTER_SAVE = '2026-11-10T08:05:00.000Z';
/** The page as the editor shows it after saving a new body. */
const page: PageNode = {
  id: 'page-a',
  parentId: null,
  languageId: 'en',
  kind: 'PAGE',
  title: 'Install',
  slug: 'install',
  path: 'install',
  icon: null,
  description: null,
  position: 0,
  hidden: false,
  updatedAt: AFTER_SAVE,
};

/** A response the test sends when it chooses. */
const pendingResponse = () => {
  let send: (data: { description: string; revision: string }) => void = () => undefined;
  const response = new Promise<Response>((resolve) => {
    send = (data) => resolve(new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });
  return { response, send };
};

describe('the generated search description, with the real query cache', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let client: QueryClient;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    mocks.searchDescription.mockReset();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  });

  const openSeo = async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <PageSettingsDialog onOpenChange={vi.fn()} open page={page} projectId="project-a" />
        </QueryClientProvider>,
      ),
    );
    const tab = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('editor.pageSettings.tab.seo'));
    await act(async () => tab?.click());
  };
  const previewText = () => document.querySelector('[data-slot="search-description"]')?.textContent ?? null;
  const writeOwn = () =>
    [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('editor.pageSettings.searchPreview.writeOwn'));
  const field = () => document.querySelector<HTMLTextAreaElement>('#page-meta-desc');
  /** Lets a response travel through the client (body parsing) into the cache and the render. */
  const settle = () => act(async () => vi.waitFor(() => expect(client.isFetching()).toBe(0)));

  it('waits for the refetch after a save instead of offering the answer cached for the old body', async () => {
    client.setQueryData(pageSearchDescriptionKey('project-a', 'page-a'), { description: 'The old body.', revision: BEFORE_SAVE });
    const refetch = pendingResponse();
    mocks.searchDescription.mockReturnValue(refetch.response);
    await openSeo();

    // The cached answer is for the body before the save, and the refetch is still running.
    expect(mocks.searchDescription).toHaveBeenCalledWith({ param: { projectId: 'project-a', id: 'page-a' } });
    expect(previewText()).toBeNull();
    expect(writeOwn()?.disabled).toBe(true);
    await act(async () => writeOwn()?.click());
    expect(field()?.value).toBe('');

    refetch.send({ description: 'The new body.', revision: AFTER_SAVE });
    await settle();
    expect(previewText()).toBe('The new body.');
    expect(writeOwn()?.disabled).toBe(false);
    await act(async () => writeOwn()?.click());
    expect(field()?.value).toBe('The new body.');
  });

  it('shows a cached answer for the current body at once, but adopts it only after the refetch confirms it', async () => {
    client.setQueryData(pageSearchDescriptionKey('project-a', 'page-a'), { description: 'The current body.', revision: AFTER_SAVE });
    const refetch = pendingResponse();
    mocks.searchDescription.mockReturnValue(refetch.response);
    await openSeo();

    expect(previewText()).toBe('The current body.');
    expect(writeOwn()?.disabled).toBe(true);
    refetch.send({ description: 'The current body.', revision: AFTER_SAVE });
    await settle();
    expect(writeOwn()?.disabled).toBe(false);
  });

  it('offers nothing to adopt after an error', async () => {
    mocks.searchDescription.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Too many requests' } }), { status: 429 }));
    await openSeo();
    await settle();
    expect(previewText()).toBeNull();
    expect(writeOwn()?.disabled).toBe(true);
    expect(document.body.textContent).toContain('editor.pageSettings.searchPreview.prompt');
  });
});
