// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@/hooks/api/types';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/editor/site-config-panel', () => ({ ConfigSection: () => <div data-testid="config-section" /> }));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key }));

import { ConfigCanvas, EmptyCanvas, GroupCanvas, PageCanvasSkeleton, PageLoadFailedCanvas } from './editor-canvas-states';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('editor canvas states', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const buttons = () => [...container.querySelectorAll('button')];
  const click = async (label: string) =>
    act(async () =>
      buttons()
        .find((button) => button.textContent?.includes(label))
        ?.click(),
    );

  it('announces a busy skeleton while a page opens', async () => {
    await act(async () => root.render(<PageCanvasSkeleton status="editor.openingPage" />));
    expect(container.querySelector('[aria-busy="true"] [role="status"]')?.textContent).toBe('editor.openingPage');
  });

  it('shows the configuration section once the site is loaded, a skeleton before', async () => {
    await act(async () =>
      root.render(
        <ConfigCanvas canManage permissionsPending={false} onBackToWriting={vi.fn()} project={undefined} reportDirty={vi.fn()} section="branding" />,
      ),
    );
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () =>
      root.render(
        <ConfigCanvas
          canManage
          permissionsPending={false}
          onBackToWriting={vi.fn()}
          project={{ id: 'p1' } as never}
          reportDirty={vi.fn()}
          section="branding"
        />,
      ),
    );
    expect(container.querySelector('[data-testid="config-section"]')).not.toBeNull();
  });

  it('offers the group actions, and adding a page only for a group in a language', async () => {
    const actions = { onAddPage: vi.fn(), onRename: vi.fn(), onOpenSettings: vi.fn(), onDelete: vi.fn() };
    const group = { id: 'g1', title: 'Billing', languageId: 'en' } as PageNode;
    await act(async () => root.render(<GroupCanvas addingPage={false} group={group} {...actions} />));
    expect(container.querySelector('h1')?.textContent).toBe('Billing');
    await click('editor.addPageInside');
    await click('editor.rename');
    await click('editor.groupSettings');
    await click('editor.deleteGroup');
    for (const action of Object.values(actions)) expect(action).toHaveBeenCalledOnce();

    await act(async () => root.render(<GroupCanvas addingPage={false} group={{ ...group, languageId: null } as never} {...actions} />));
    expect(container.textContent).not.toContain('editor.addPageInside');
  });

  it('explains a page that failed to load, with Retry and the page list', async () => {
    const onRetry = vi.fn();
    const onShowPages = vi.fn();
    await act(async () =>
      root.render(
        <PageLoadFailedCanvas error={new Error('boom')} onRetry={onRetry} onShowPages={onShowPages} retrying={false} sidebarCollapsed={false} />,
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('editor.openPageFailed');
    await click('common.retry');
    await click('editor.showPages');
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onShowPages).toHaveBeenCalledOnce();
  });

  it('offers a first page only when the site has a language for it', async () => {
    const onNewPage = vi.fn();
    await act(async () => root.render(<EmptyCanvas canCreate creating={false} onNewPage={onNewPage} />));
    await click('editor.newPage');
    expect(onNewPage).toHaveBeenCalledOnce();
    await act(async () => root.render(<EmptyCanvas canCreate={false} creating={false} onNewPage={onNewPage} />));
    expect(container.textContent).not.toContain('editor.newPage');
  });
});
