/** @vitest-environment jsdom */
/**
 * PUBLIC-18 (council): following a link to another page must keep Back and
 * Forward working. The editor may be open without `?page=` (or on a page chosen
 * in the page list since), so Back has to land on an entry naming the page the
 * writer left, scrolled where it was.
 */
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { act, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useLinkedPageHistory } from './linked-page-history';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness: { open?: (id: string) => Promise<void> } = {};

const rootRoute = createRootRoute({ component: Outlet });
const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app/projects/$projectId/editor',
  validateSearch: (search: Record<string, unknown>) => ({ page: typeof search.page === 'string' ? search.page : undefined }),
  component: Editor,
});

/** The editor in miniature: it opens on page A without `?page=`, and selects the page `?page=` names, as the route does. */
function Editor() {
  const { page } = editorRoute.useSearch();
  const [selected, setSelected] = useState(page ?? 'page-a');
  useEffect(() => {
    if (page) setSelected(page);
  }, [page]);
  const canvas = useRef<HTMLDivElement>(null);
  harness.open = useLinkedPageHistory({ projectId: 'project-1', pageId: selected, canvas: () => canvas.current });
  return (
    <div ref={canvas} data-testid="canvas" data-page={selected}>
      <p>{selected}</p>
    </div>
  );
}

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((done) => requestAnimationFrame(() => done(null)));
  });

async function renderEditor() {
  const history = createMemoryHistory({ initialEntries: ['/app/projects/project-1/editor'] });
  const router = createRouter({ routeTree: rootRoute.addChildren([editorRoute]), history });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<RouterProvider router={router} />));
  await act(async () => router.load());
  const canvas = () => container.querySelector<HTMLDivElement>('[data-testid="canvas"]') as HTMLDivElement;
  const scroll = async (top: number) => {
    canvas().scrollTop = top;
    await act(async () => canvas().dispatchEvent(new Event('scroll')));
  };
  return { history, router, canvas, scroll };
}

describe('Back and Forward after following a link in the editor (PUBLIC-18)', () => {
  it('Back selects the page the link was followed from, scrolled where it was; Forward returns to the linked page', async () => {
    const { history, router, canvas, scroll } = await renderEditor();
    expect(canvas().dataset.page).toBe('page-a');
    await scroll(420);

    await act(async () => harness.open?.('page-b'));
    await settle();
    expect(router.state.location.search).toEqual({ page: 'page-b' });
    expect(canvas().dataset.page).toBe('page-b');
    // A linked page opens at its top.
    expect(canvas().scrollTop).toBe(0);
    await scroll(150);

    await act(async () => history.back());
    await settle();
    expect(router.state.location.search).toEqual({ page: 'page-a' });
    expect(canvas().dataset.page).toBe('page-a');
    expect(canvas().scrollTop).toBe(420);

    await act(async () => history.forward());
    await settle();
    expect(router.state.location.search).toEqual({ page: 'page-b' });
    expect(canvas().dataset.page).toBe('page-b');
    expect(canvas().scrollTop).toBe(150);
  });

  it('adds one history entry per followed link, and none for a link to the page on screen', async () => {
    const { history } = await renderEditor();
    const start = history.length;
    await act(async () => harness.open?.('page-a'));
    expect(history.length).toBe(start);
    await act(async () => harness.open?.('page-b'));
    await settle();
    expect(history.length).toBe(start + 1);
  });
});
