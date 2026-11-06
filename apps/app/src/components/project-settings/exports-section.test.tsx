// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  scheduleMutation: vi.fn(),
  download: vi.fn(),
  error: vi.fn(),
  runs: [] as unknown[],
  deployments: undefined as { status: string }[] | undefined,
  project: undefined as { hasPublishedVersion?: boolean } | undefined,
  cancel: { isPending: false, variables: undefined as string | undefined, mutate: vi.fn() },
  locale: 'en' as 'en' | 'ar',
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  return {
    useLocale: () => ({
      locale: mocks.locale,
      t: (key: Parameters<typeof translateFn>[0], variables?: Parameters<typeof translateFn>[1]) =>
        key.includes('.size.') || key.includes('.unit.') ? translateFn(key, variables, mocks.locale) : key,
    }),
  };
});
vi.mock('@/hooks/api', () => ({ useDeployments: () => ({ data: mocks.deployments }), useProject: () => ({ data: mocks.project }) }));
vi.mock('@/hooks/api/exports', () => ({
  useListExportRuns: () => ({ data: mocks.runs }),
  useListExportSchedules: () => ({
    data: [
      {
        id: 'schedule-1',
        name: 'Daily backup',
        cadence: 'DAILY',
        enabled: true,
        hour: 2,
        minute: 0,
        timezone: 'UTC',
        nextRunAt: null,
        _count: { jobs: 2 },
      },
    ],
  }),
  useCreateExport: () => ({ mutate: mocks.create }),
  useCancelExport: () => mocks.cancel,
  useGetExportDownload: () => ({ mutateAsync: mocks.download }),
  useCreateExportSchedule: () => ({ mutate: mocks.scheduleMutation }),
  useUpdateExportSchedule: () => ({ mutate: mocks.scheduleMutation }),
  useRunExportSchedule: () => ({ mutate: mocks.scheduleMutation }),
}));

import { ApiResponseError } from '@/hooks/api/client-helpers';
import { ExportsSection } from './exports-section';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('export schedule permissions', () => {
  let container: HTMLDivElement;
  let root: Root;

  const findButton = (key: string) => [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(key));

  beforeEach(() => {
    mocks.runs = [];
    mocks.deployments = [{ status: 'READY' }];
    mocks.project = { hasPublishedVersion: true };
    mocks.cancel = { isPending: false, variables: undefined, mutate: vi.fn() };
    mocks.locale = 'en';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it('lets an editor request a one-time export through the mocked mutation', async () => {
    await act(async () => root.render(<ExportsSection canManageSchedules={false} projectId="project-1" />));
    await act(async () => findButton('settings.exports.workflow.create')?.click());

    expect(mocks.create).toHaveBeenCalledWith(['MARKDOWN'], expect.any(Object));
    expect(mocks.scheduleMutation).not.toHaveBeenCalled();
  });

  it('asks to publish first instead of offering an export of a site that was never published', async () => {
    mocks.deployments = [{ status: 'FAILED' }];
    mocks.project = { hasPublishedVersion: false };
    await act(async () => root.render(<ExportsSection canManageSchedules={false} projectId="project-1" />));

    expect(container.textContent).toContain('settings.exports.workflow.publishFirst');
    // Unavailable but still reachable with Tab, and the reason is read with it.
    const button = findButton('settings.exports.workflow.create');
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    const hint = document.getElementById(button?.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('settings.exports.workflow.publishFirst');
    button?.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => button?.click());
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('offers the export when the live version is older than the recent publish history', async () => {
    // The newest 50 attempts all failed, but an older published version is still live.
    mocks.deployments = Array.from({ length: 50 }, () => ({ status: 'FAILED' }));
    mocks.project = { hasPublishedVersion: true };
    await act(async () => root.render(<ExportsSection canManageSchedules={false} projectId="project-1" />));

    expect(container.textContent).not.toContain('settings.exports.workflow.publishFirst');
    const button = findButton('settings.exports.workflow.create');
    expect(button?.getAttribute('aria-disabled')).toBeNull();
    await act(async () => button?.click());
    expect(mocks.create).toHaveBeenCalledWith(['MARKDOWN'], expect.any(Object));
  });

  it('offers the export right after a first publish, before the site itself is reloaded', async () => {
    mocks.deployments = [{ status: 'READY' }];
    mocks.project = { hasPublishedVersion: false };
    await act(async () => root.render(<ExportsSection canManageSchedules={false} projectId="project-1" />));

    expect(container.textContent).not.toContain('settings.exports.workflow.publishFirst');
    expect(findButton('settings.exports.workflow.create')?.getAttribute('aria-disabled')).toBeNull();
  });

  it('explains a refused export of an unpublished site while its publish history is still loading', async () => {
    mocks.deployments = undefined;
    mocks.project = undefined;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => root.render(<ExportsSection canManageSchedules={false} projectId="project-1" />));
    await act(async () => findButton('settings.exports.workflow.create')?.click());
    const options = mocks.create.mock.calls[0]?.[1];
    act(() => options.onError(new ApiResponseError('Publish the site before creating an export.', 400)));

    expect(mocks.error).toHaveBeenCalledWith('settings.exports.workflow.publishFirst');
  });

  it("says the site is too large, not 'try again', when the live version is over the export limit", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => root.render(<ExportsSection canManageSchedules={false} projectId="project-1" />));
    await act(async () => findButton('settings.exports.workflow.create')?.click());
    const options = mocks.create.mock.calls[0]?.[1];
    act(() => options.onError(new ApiResponseError('The published revision is larger than this instance allows.', 400)));

    expect(mocks.error).toHaveBeenCalledWith('settings.exports.workflow.tooLarge');
  });

  it('keeps the general message for an unexplained failure once a version is live', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => root.render(<ExportsSection canManageSchedules={false} projectId="project-1" />));
    await act(async () => findButton('settings.exports.workflow.create')?.click());
    const options = mocks.create.mock.calls[0]?.[1];
    act(() => options.onError(new ApiResponseError('Internal error', 500)));

    expect(mocks.error).toHaveBeenCalledWith('settings.exports.workflow.startError');
  });

  it('spins only the export being cancelled', async () => {
    const running = (id: string) => ({
      id,
      formats: ['MARKDOWN'],
      status: 'RUNNING',
      trigger: 'MANUAL',
      createdAt: '2026-10-16T00:00:00Z',
      snapshot: { deploymentVersion: 4, pagesCount: 3 },
      artifacts: [],
    });
    mocks.runs = [running('run-1'), running('run-2')];
    mocks.cancel = { isPending: true, variables: 'run-2', mutate: vi.fn() };
    await act(async () => root.render(<ExportsSection canManageSchedules={false} projectId="project-1" />));
    await act(async () => findButton('settings.exports.workflow.history')?.click());

    const cancels = [...container.querySelectorAll('button')].filter((button) => button.textContent?.includes('common.cancel'));
    expect(cancels.map((button) => button.hasAttribute('data-loading'))).toEqual([false, true]);
  });

  it('lets an editor read schedules while hiding every administrator mutation control', async () => {
    await act(async () => root.render(<ExportsSection canManageSchedules={false} projectId="project-1" />));
    await act(async () => findButton('settings.exports.workflow.schedules')?.click());

    expect(container.textContent).toContain('Daily backup');
    expect(findButton('settings.exports.workflow.newSchedule')).toBeUndefined();
    expect(findButton('settings.exports.workflow.runNow')).toBeUndefined();
    expect(findButton('settings.exports.workflow.disable')).toBeUndefined();
    expect(mocks.scheduleMutation).not.toHaveBeenCalled();
  });

  it('offers schedule management to administrators without executing a mutation on render', async () => {
    await act(async () => root.render(<ExportsSection canManageSchedules projectId="project-1" />));
    await act(async () => findButton('settings.exports.workflow.schedules')?.click());

    expect(findButton('settings.exports.workflow.newSchedule')).toBeDefined();
    expect(findButton('settings.exports.workflow.runNow')).toBeDefined();
    expect(findButton('settings.exports.workflow.disable')).toBeDefined();
    expect(mocks.scheduleMutation).not.toHaveBeenCalled();
  });

  it('downloads the selected artifact with the returned filename using a native anchor', async () => {
    mocks.runs = [
      {
        id: 'run-2',
        formats: ['MARKDOWN', 'PDF'],
        status: 'SUCCEEDED',
        trigger: 'MANUAL',
        createdAt: '2026-10-16T00:00:00Z',
        snapshot: { deploymentVersion: 4 },
        artifacts: [
          { id: 'zip', format: 'MARKDOWN', fileName: 'guide.zip', size: 1024 },
          { id: 'pdf', format: 'PDF', fileName: 'guide.pdf', size: 2048 },
        ],
      },
    ];
    const fileUrl = '/api/app/projects/project-1/exports/run-2/artifacts/pdf/file';
    mocks.download.mockResolvedValue({ url: 'https://storage.example.test/private/guide.pdf?synthetic=1', fileUrl, fileName: 'دليل-v4.pdf' });
    const clicks: { href: string; download: string; target: string; connected: boolean }[] = [];
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download, target: this.target, connected: this.isConnected });
    });
    const originalLocation = window.location.href;
    await act(async () => root.render(<ExportsSection canManageSchedules={false} projectId="project-1" />));
    await act(async () => findButton('settings.exports.workflow.history')?.click());
    await act(async () => findButton('settings.exports.workflow.format.pdf')?.click());
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith({ runId: 'run-2', artifactId: 'pdf' });
    expect(clicks).toEqual([{ href: new URL(fileUrl, window.location.href).href, download: 'دليل-v4.pdf', target: '', connected: true }]);
    expect(window.location.href).toBe(originalLocation);
    expect(container.querySelector('a')).toBeNull();
    anchorClick.mockRestore();
  });

  it.each([
    ['en', '1 KiB'],
    ['ar', '1 كيبيبايت'],
  ] as const)('shows a nonzero small artifact size in %s', async (locale, expected) => {
    mocks.locale = locale;
    mocks.runs = [
      {
        id: 'run-1',
        formats: ['MARKDOWN'],
        status: 'SUCCEEDED',
        trigger: 'MANUAL',
        createdAt: '2026-10-16T00:00:00Z',
        snapshot: { deploymentVersion: 4 },
        artifacts: [{ id: 'zip', format: 'MARKDOWN', fileName: 'guide.zip', size: 1024 }],
      },
    ];
    await act(async () => root.render(<ExportsSection canManageSchedules={false} projectId="project-1" />));
    await act(async () => findButton('settings.exports.workflow.history')?.click());
    expect(findButton('settings.exports.workflow.format.markdown')?.textContent).toContain(expected);
  });

  it('keeps the workspace and reports a failed download preflight without clicking a link', async () => {
    mocks.runs = [
      {
        id: 'run-1',
        formats: ['PDF'],
        status: 'SUCCEEDED',
        trigger: 'MANUAL',
        createdAt: '2026-10-16T00:00:00Z',
        snapshot: { deploymentVersion: 4 },
        artifacts: [{ id: 'pdf', format: 'PDF', fileName: 'guide.pdf', size: 2048 }],
      },
    ];
    mocks.download.mockRejectedValue(new Error('This export has expired.'));
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    const originalLocation = window.location.href;
    await act(async () => root.render(<ExportsSection canManageSchedules={false} projectId="project-1" />));
    await act(async () => findButton('settings.exports.workflow.history')?.click());
    await act(async () => findButton('settings.exports.workflow.format.pdf')?.click());
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('settings.exports.workflow.downloadError');
    expect(anchorClick).not.toHaveBeenCalled();
    expect(window.location.href).toBe(originalLocation);
  });
});
