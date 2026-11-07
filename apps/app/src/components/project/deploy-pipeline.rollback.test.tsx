// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deployment, Project } from '@/hooks/api/types';
import { DeployPipeline } from './deploy-pipeline';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  query: vi.fn(),
  deployments: { data: [] as Deployment[] },
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@nibleaf/design-system/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: { version?: number }) => `${key}${variables?.version ? `:${variables.version}` : ''}`,
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@/hooks/api', () => ({
  useDomains: () => ({ data: [] }),
  useRollback: () => ({ mutate: mocks.mutate, isPending: false }),
  useDeployments: (_id: string, options: object) => {
    mocks.query(options);
    return mocks.deployments;
  },
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
}));

const deployment = (id: string, version: number, status: Deployment['status']): Deployment => ({
  id,
  version,
  status,
  pagesCount: 1,
  commitMessage: null,
  error: null,
  createdAt: '2026-11-07T00:00:00Z',
  completedAt: null,
});
const project = { id: 'project', name: 'Synthetic docs', slug: 'docs' } as Project;

describe('rollback progress', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const close = vi.fn();
  const render = async (open = true) =>
    act(async () => root.render(<DeployPipeline project={project} open={open} onOpenChange={close} trackedDeploymentId="live-3" />));
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.confirm.mockResolvedValue(true);
    mocks.deployments.data = [deployment('live-3', 3, 'READY'), deployment('old-2', 2, 'READY')];
    mocks.mutate.mockImplementation((_id, options) => {
      const queued = deployment('restore-4', 4, 'PENDING');
      mocks.deployments.data = [queued, ...mocks.deployments.data];
      options.onSuccess(queued);
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const queueRollback = async () => {
    await render();
    mocks.success.mockClear();
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === 'deploy.rollback');
    if (!button) throw new Error('Rollback button missing');
    await act(async () => button.click());
  };
  it('tracks the returned deployment and announces restoration only after that deployment is READY', async () => {
    await queueRollback();
    expect(container.textContent).toContain('deploy.rollback.restoring:2');
    expect(mocks.success).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    mocks.deployments.data = [deployment('unrelated-5', 5, 'READY'), ...mocks.deployments.data];
    await render();
    expect(container.textContent).toContain('deploy.rollback.restoring:2');
    expect(mocks.success).not.toHaveBeenCalled();
    mocks.deployments.data = mocks.deployments.data.map((item) => (item.id === 'restore-4' ? { ...item, status: 'READY' } : item));
    await render();
    expect(mocks.success).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledWith('deploy.rollback.success:2', expect.any(Object));
  });
  it('keeps polling after close and reports an eventual restoration failure', async () => {
    await queueRollback();
    await render(false);
    expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    mocks.deployments.data = mocks.deployments.data.map((item) => (item.id === 'restore-4' ? { ...item, status: 'FAILED' } : item));
    await render(false);
    expect(mocks.error).toHaveBeenCalledWith('deploy.rollback.error');
    expect(mocks.success).not.toHaveBeenCalled();
    await render(false);
    expect(mocks.error).toHaveBeenCalledOnce();
  });
});
