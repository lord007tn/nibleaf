/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api/types';
import { PublishModal } from './publish-modal';

const { mutate, showError, preflight, refreshPreflight } = vi.hoisted(() => ({
  mutate: vi.fn(),
  showError: vi.fn(),
  preflight: { isFetching: false },
  refreshPreflight: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: showError } }));
vi.mock('@/hooks/api', () => ({
  usePublish: () => ({ isPending: false, mutate }),
  usePendingChanges: () => ({
    data: { changes: [], redirectIssues: [], hasBaseline: true },
    isPending: false,
    isFetching: preflight.isFetching,
    isError: false,
    refetch: refreshPreflight,
  }),
}));
vi.mock('@/lib/first-publish-activation', () => ({ readFirstPublishAttribution: () => null }));

const project = { id: 'project-a', name: 'Docs' } as Project;

describe('publish draft barrier', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.clearAllMocks();
    preflight.isFetching = false;
    refreshPreflight.mockResolvedValue({ data: { redirectIssues: [] }, isError: false });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('waits for the current draft before creating the deployment', async () => {
    let finishSaving!: () => void;
    const beforePublish = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSaving = resolve;
        }),
    );
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    expect(beforePublish).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled();
    expect(refreshPreflight).not.toHaveBeenCalled();
    await act(async () => finishSaving());
    expect(mutate).toHaveBeenCalledOnce();
    expect(refreshPreflight).toHaveBeenCalledOnce();
  });

  it('keeps publish available for retry without creating a deployment when saving fails', async () => {
    const beforePublish = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('editor.saveError');
    expect(publish.disabled).toBe(false);
    await act(async () => publish.click());
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('blocks a cached preflight while the latest saved changes are being fetched', async () => {
    preflight.isFetching = true;
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    expect(publish.disabled).toBe(true);
    expect(document.body.textContent).toContain('publish.checking');
    await act(async () => publish.click());
    expect(mutate).not.toHaveBeenCalled();
    preflight.isFetching = false;
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    expect(publish.disabled).toBe(false);
  });

  it('uses the post-save preflight result before starting a deployment', async () => {
    refreshPreflight.mockResolvedValue({ data: { redirectIssues: [{ message: 'Redirect loop' }] }, isError: false });
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    expect(refreshPreflight).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('silently stops when unsaved configuration blocks publishing and allows a later retry', async () => {
    const beforePublish = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    expect(refreshPreflight).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(publish.disabled).toBe(false);
    await act(async () => publish.click());
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('does not publish after Cancel while the draft save is still pending', async () => {
    let finishSaving!: () => void;
    const beforePublish = () =>
      new Promise<void>((resolve) => {
        finishSaving = resolve;
      });
    const onOpenChange = vi.fn();
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={onOpenChange} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent === 'common.cancel');
    if (!publish || !cancel) throw new Error('Publish actions were not rendered');
    await act(async () => publish.click());
    await act(async () => cancel.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await act(async () => finishSaving());
    expect(refreshPreflight).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it('does not publish after Cancel while the post-save preflight is still pending', async () => {
    let finishPreflight!: (result: { data: { redirectIssues: [] }; isError: false }) => void;
    refreshPreflight.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPreflight = resolve;
        }),
    );
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent === 'common.cancel');
    if (!publish || !cancel) throw new Error('Publish actions were not rendered');
    await act(async () => publish.click());
    expect(refreshPreflight).toHaveBeenCalledOnce();
    await act(async () => cancel.click());
    await act(async () => finishPreflight({ data: { redirectIssues: [] }, isError: false }));
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it('invalidates a pending save when the publish UI unmounts', async () => {
    let finishSaving!: () => void;
    const beforePublish = () =>
      new Promise<void>((resolve) => {
        finishSaving = resolve;
      });
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    await act(async () => root.unmount());
    await act(async () => finishSaving());
    expect(refreshPreflight).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
});
