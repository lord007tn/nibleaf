// @vitest-environment jsdom
import { translateFn } from '@nibleaf/i18n';
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
  info: vi.fn(),
  query: vi.fn(),
  deployments: { data: [] as Deployment[] },
  domains: { data: [] as object[] },
  live: { data: [] as Deployment[], isFetching: false },
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
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error, info: mocks.info } }));
vi.mock('@/hooks/api', () => ({
  useDomains: () => mocks.domains,
  useLiveDeployments: () => mocks.live,
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
  it.each([
    ['en', 'A newer publish went live after this rollback, so readers see that version.'],
    ['ar', 'نُشرت نسخة أحدث بعد طلب الاستعادة، وهي النسخة التي يراها القرّاء الآن.'],
  ] as const)('explains the superseded outcome in %s', (locale, message) => {
    expect(translateFn('deploy.rollback.superseded', undefined, locale)).toBe(message);
  });
  it.each([
    ['en', 'A newer version is live'],
    ['ar', 'نسخة أحدث متاحة الآن'],
  ] as const)('gives the superseded dialog a status title in %s', (locale, title) => {
    expect(translateFn('deploy.rollback.supersededTitle', undefined, locale)).toBe(title);
  });
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const close = vi.fn();
  const retryDraft = vi.fn();
  const render = async (open = true) =>
    act(async () =>
      root.render(<DeployPipeline project={project} open={open} onOpenChange={close} trackedDeploymentId="live-3" onRetry={retryDraft} />),
    );
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutate.mockReset();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.confirm.mockResolvedValue(true);
    mocks.deployments.data = [deployment('live-3', 3, 'READY'), deployment('old-2', 2, 'READY')];
    mocks.domains.data = [];
    mocks.live.data = [];
    mocks.live.isFetching = false;
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
  it.each([
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' }, true],
    // Ownership proven, but readers would get a browser error: keep the default address.
    [{ dnsStatus: 'ERROR', sslStatus: 'PENDING' }, false],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' }, false],
  ])('names the custom domain as the site address only once readers can open it: %o', async (status, live) => {
    mocks.domains.data = [{ id: 'domain-1', domain: 'docs.example.com', verified: true, isPrimary: true, ...status }];
    await render();
    // The site address line, compared whole (not as a substring of the page).
    const addresses = [...container.querySelectorAll('[dir="ltr"]')].map((element) => element.textContent?.trim());
    // An address is always shown: the default one when the domain isn't live.
    expect(addresses.some((address) => address?.startsWith('http') || address?.startsWith('/'))).toBe(true);
    if (live) expect(addresses).toContain('https://docs.example.com');
    else expect(addresses).not.toContain('https://docs.example.com');
  });

  it('offers a rollback to the previous live version even when it is older than the newest 50 attempts', async () => {
    // v60 just went live after 49 failures; v3, the version before it, only the live-only list has.
    mocks.deployments.data = [
      deployment('live-60', 60, 'READY'),
      ...Array.from({ length: 49 }, (_, index) => deployment(`f${index}`, 59 - index, 'FAILED')),
    ];
    mocks.live.data = [deployment('live-60', 60, 'READY'), deployment('old-3', 3, 'READY')];
    await act(async () =>
      root.render(<DeployPipeline project={project} open onOpenChange={close} trackedDeploymentId="live-60" onRetry={retryDraft} />),
    );
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === 'deploy.rollback');
    expect(button?.hasAttribute('disabled')).toBe(false);
    await act(async () => button?.click());
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ description: 'deploy.rollback.confirmDesc:3' }));
    expect(mocks.mutate).toHaveBeenCalledWith('old-3', expect.anything());
  });

  it('waits for a fresh live list before offering a rollback target', async () => {
    mocks.deployments.data = [
      deployment('live-60', 60, 'READY'),
      ...Array.from({ length: 49 }, (_, index) => deployment(`f${index}`, 59 - index, 'FAILED')),
    ];
    // Stale: v4 went live after v3 but this cached answer predates it.
    mocks.live.data = [deployment('old-3', 3, 'READY')];
    mocks.live.isFetching = true;
    await act(async () =>
      root.render(<DeployPipeline project={project} open onOpenChange={close} trackedDeploymentId="live-60" onRetry={retryDraft} />),
    );
    const rollbackButton = () => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('deploy.rollback'));
    expect(rollbackButton()?.hasAttribute('disabled')).toBe(true);

    mocks.live.data = [deployment('live-60', 60, 'READY'), deployment('v4', 4, 'READY'), deployment('old-3', 3, 'READY')];
    mocks.live.isFetching = false;
    await act(async () =>
      root.render(<DeployPipeline project={project} open onOpenChange={close} trackedDeploymentId="live-60" onRetry={retryDraft} />),
    );
    await act(async () => rollbackButton()?.click());
    expect(mocks.mutate).toHaveBeenCalledWith('v4', expect.anything());
  });

  const queueRollback = async () => {
    await render();
    mocks.success.mockClear();
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === 'deploy.rollback');
    if (!button) throw new Error('Rollback button missing');
    await act(async () => button.click());
  };
  it('reports a superseded restoration instead of claiming that readers see the historical version', async () => {
    await queueRollback();
    expect(container.textContent).toContain('deploy.rollback.restoring:2');
    expect(mocks.success).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    mocks.deployments.data = [deployment('unrelated-5', 5, 'READY'), ...mocks.deployments.data];
    await render();
    expect(container.textContent).toContain('deploy.rollback.restoring:2');
    expect(mocks.success).not.toHaveBeenCalled();
    mocks.deployments.data = mocks.deployments.data.map((item) => (item.id === 'restore-4' ? { ...item, status: 'READY' } : item));
    await render(false);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith('deploy.rollback.superseded');
    await render();
    expect(mocks.info).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('deploy.rollback.superseded');
    expect(container.textContent).not.toContain('deploy.deployed');
    expect(container.querySelector('h1')?.textContent).toBe('deploy.rollback.supersededTitle');
    expect(container.querySelector('details')).toBeNull();
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'deploy.rollback')).toBe(false);
  });
  it('keeps polling after close and reports an eventual restoration failure', async () => {
    await queueRollback();
    await render(false);
    expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    mocks.deployments.data = mocks.deployments.data.map((item) =>
      item.id === 'restore-4' ? { ...item, status: 'FAILED', completedAt: new Date().toISOString() } : item,
    );
    await render(false);
    expect(mocks.error).toHaveBeenCalledWith('deploy.rollback.error');
    expect(mocks.success).not.toHaveBeenCalled();
    await render(false);
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it('retries the chosen historical version after a terminal failure instead of publishing the draft', async () => {
    await queueRollback();
    mocks.deployments.data = mocks.deployments.data.map((item) =>
      item.id === 'restore-4' ? { ...item, status: 'FAILED', completedAt: new Date().toISOString() } : item,
    );
    await render();
    mocks.mutate.mockImplementationOnce((_id, options) => {
      const queued = deployment('restore-5', 5, 'PENDING');
      mocks.deployments.data = [queued, ...mocks.deployments.data];
      options.onSuccess(queued);
    });
    const retry = [...container.querySelectorAll('button')].find((item) => item.textContent === 'common.retry');
    if (!retry) throw new Error('Retry button missing');
    await act(async () => retry.click());
    expect(retryDraft).not.toHaveBeenCalled();
    expect(mocks.mutate).toHaveBeenLastCalledWith('old-2', expect.any(Object));
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('deploy.rollback.restoring:2');
    expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ retryingDeploymentId: 'restore-5' }));
    mocks.deployments.data = mocks.deployments.data.map((item) => (item.id === 'restore-5' ? { ...item, status: 'READY' } : item));
    await render(false);
    expect(mocks.success).toHaveBeenLastCalledWith('deploy.rollback.success:2', expect.any(Object));
  });

  it('keeps a closed rollback observable through FAILED to BUILDING to READY', async () => {
    await queueRollback();
    for (const status of ['FAILED', 'BUILDING', 'READY'] as const) {
      mocks.deployments.data = mocks.deployments.data.map((item) =>
        item.id === 'restore-4' ? { ...item, status, completedAt: status === 'READY' ? new Date().toISOString() : null } : item,
      );
      await render(false);
      expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, retryingDeploymentId: 'restore-4' }));
    }
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.success).toHaveBeenCalledWith('deploy.rollback.success:2', expect.any(Object));
  });

  it('announces READY independently of a previously announced FAILED outcome', async () => {
    await queueRollback();
    mocks.deployments.data = mocks.deployments.data.map((item) =>
      item.id === 'restore-4' ? { ...item, status: 'FAILED', completedAt: new Date().toISOString() } : item,
    );
    await render(false);
    mocks.deployments.data = mocks.deployments.data.map((item) => (item.id === 'restore-4' ? { ...item, status: 'READY' } : item));
    await render(false);
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledWith('deploy.rollback.success:2', expect.any(Object));
  });

  it('keeps an untracked legacy failure with no completion time visible as failed', async () => {
    mocks.deployments.data = [deployment('legacy-failure', 1, 'FAILED')];
    await act(async () => root.render(<DeployPipeline project={project} open onOpenChange={close} />));
    expect(container.textContent).toContain('deploy.failed');
    expect(container.textContent).not.toContain('deploy.deploying');
  });
});
