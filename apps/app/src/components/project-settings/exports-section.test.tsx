// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), scheduleMutation: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));
vi.mock('@/hooks/api/exports', () => ({
  useListExportRuns: () => ({ data: [] }),
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
  useGetExportDownload: () => ({ mutateAsync: vi.fn() }),
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
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
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
});
