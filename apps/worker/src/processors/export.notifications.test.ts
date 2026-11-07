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
}));
vi.mock('@nibleaf/database', () => ({
  Prisma: {},
  prisma: {
    exportJob: { findUnique: mocks.find, update: mocks.update },
    notification: { create: mocks.notify },
    platformEvent: { create: mocks.event },
    exportArtifact: { upsert: mocks.artifact },
  },
}));
vi.mock('@nibleaf/logger', () => ({ createLogger: () => ({ info: vi.fn() }) }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), QueueNames: { EXPORT: 'export' } }));
vi.mock('@nibleaf/storage', () => ({ deleteObject: vi.fn(), deletePrefix: vi.fn(), getObjectStream: vi.fn(), putObject: mocks.put }));
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
