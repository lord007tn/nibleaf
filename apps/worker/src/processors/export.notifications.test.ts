import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  update: vi.fn(),
  notify: vi.fn(),
  event: vi.fn(),
  artifact: vi.fn(),
  render: vi.fn(),
  put: vi.fn(),
  track: vi.fn(),
  runs: vi.fn(),
  schedule: vi.fn(),
  remove: vi.fn(),
  deleteObject: vi.fn(),
  info: vi.fn(),
}));
vi.mock('@nibleaf/database', () => ({
  Prisma: {},
  prisma: {
    exportJob: { findUnique: mocks.find, update: mocks.update, findMany: mocks.runs, deleteMany: mocks.remove, delete: mocks.remove },
    exportSchedule: { findUnique: mocks.schedule },
    exportSnapshot: { deleteMany: vi.fn() },
    notification: { create: mocks.notify },
    platformEvent: { create: mocks.event },
    exportArtifact: { upsert: mocks.artifact },
  },
}));
vi.mock('@nibleaf/logger', () => ({ createLogger: () => ({ info: mocks.info, warn: vi.fn() }) }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), QueueNames: { EXPORT: 'export' } }));
vi.mock('@nibleaf/storage', () => ({ deleteObject: mocks.deleteObject, deletePrefix: vi.fn(), getObjectStream: vi.fn(), putObject: mocks.put }));
vi.mock('../env', () => ({ env: { EXPORT_MAX_ASSET_BYTES: 1024 } }));
vi.mock('../exports/pdf', () => ({ renderPdf: vi.fn() }));
vi.mock('../exports/render', () => ({ renderMarkdownZip: mocks.render, renderStaticHtml: vi.fn(), selectPublishedAssets: () => [] }));
vi.mock('../lib/export-analytics', () => ({ trackExportLifecycle: mocks.track }));

import { handleExportJobs } from './export';

const job = { id: 'queue-1', name: 'render-export', data: { exportJobId: 'export-1' }, attemptsMade: 0, opts: { attempts: 1 } } as Parameters<
  typeof handleExportJobs
>[0];

describe('export notification parameters', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.find.mockResolvedValue({
      id: 'export-1',
      projectId: 'site-1',
      status: 'PENDING',
      createdById: 'user-1',
      attempts: 0,
      formats: ['MARKDOWN'],
      snapshot: { snapshot: { project: { slug: 'fixture' } }, assets: [], deploymentVersion: 1 },
    });
    mocks.render.mockResolvedValue({ bytes: new Uint8Array([1]), contentType: 'application/zip', extension: 'zip' });
  });

  it('writes structured parameters when an export is ready', async () => {
    await expect(handleExportJobs(job)).resolves.toEqual({ artifacts: 1 });
    expect(mocks.notify).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', projectId: 'site-1', type: 'export_ready', params: { formatCount: 1 } }),
    });
  });

  it('stores final technical failures in parameters with a safe fallback body', async () => {
    mocks.render.mockRejectedValue(new Error('ProviderError: renderer failed at internal.ts:12'));
    await expect(handleExportJobs(job)).rejects.toThrow('ProviderError');
    expect(mocks.notify).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'export_failed',
        body: 'The export could not finish. Try creating it again.',
        params: { details: 'ProviderError: renderer failed at internal.ts:12' },
      }),
    });
  });

  it('bounds inbox details to 300 characters while retaining the job error', async () => {
    const message = `ProviderError: ${'a'.repeat(500)} tail`;
    mocks.render.mockRejectedValue(new Error(message));
    await expect(handleExportJobs(job)).rejects.toThrow('ProviderError');
    expect(mocks.notify).toHaveBeenCalledWith({ data: expect.objectContaining({ params: { details: message.slice(0, 300) } }) });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'export-1' }, data: expect.objectContaining({ status: 'FAILED', error: message }) });
  });
});

describe.each(['expiry', 'schedule'] as const)('%s export retention retries', (path) => {
  const run = { id: 'expired', createdAt: new Date('2000-01-01'), artifacts: [{ storageKey: 'a' }, { storageKey: 'b' }, { storageKey: 'c' }] };
  const cleanup = () =>
    handleExportJobs(
      path === 'expiry' ? ({ ...job, name: 'cleanup-exports', data: { requestedAt: new Date().toISOString() } } as unknown as typeof job) : job,
    );
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.find.mockResolvedValue({
      id: 'new',
      projectId: 'site-1',
      status: 'PENDING',
      scheduleId: 'schedule',
      formats: [],
      snapshot: { snapshot: { project: { slug: 'synthetic' } }, assets: [] },
    });
    mocks.runs.mockResolvedValue([run]);
    mocks.schedule.mockResolvedValue({ retentionCount: 1, retentionDays: 7 });
    mocks.deleteObject.mockResolvedValue(undefined);
  });
  it.each([1, 3])('retains all keys when %i deletes fail, then removes records after a successful retry', async (failures) => {
    for (let i = 0; i < failures; i++) mocks.deleteObject.mockRejectedValueOnce(new Error('storage unavailable'));
    const first = await cleanup();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: run.id }, data: { expiresAt: expect.any(Date) } });
    if (path === 'expiry') expect(first).toEqual({ deleted: 0, pending: 1 });
    else expect(mocks.info).toHaveBeenCalledWith({ scheduleId: 'schedule', deleted: 0, pending: 1 }, expect.any(String));
    mocks.deleteObject.mockClear();
    const second = await cleanup();
    expect(mocks.deleteObject.mock.calls.map(([key]) => key)).toEqual(['a', 'b', 'c']);
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: run.id } });
    if (path === 'expiry') expect(second).toEqual({ deleted: 1, pending: 0 });
  });
});
