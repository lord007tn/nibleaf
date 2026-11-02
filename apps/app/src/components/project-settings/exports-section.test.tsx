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
  useCancelExport: () => ({ mutate: vi.fn() }),
  useGetExportDownload: () => ({ mutateAsync: mocks.download }),
  useCreateExportSchedule: () => ({ mutate: mocks.scheduleMutation }),
  useUpdateExportSchedule: () => ({ mutate: mocks.scheduleMutation }),
  useRunExportSchedule: () => ({ mutate: mocks.scheduleMutation }),
}));

import { ExportsSection } from './exports-section';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('export schedule permissions', () => {
  let container: HTMLDivElement;
  let root: Root;

  const findButton = (key: string) => [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(key));

  beforeEach(() => {
    mocks.runs = [];
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
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('This export has expired.');
    expect(anchorClick).not.toHaveBeenCalled();
    expect(window.location.href).toBe(originalLocation);
  });
});
