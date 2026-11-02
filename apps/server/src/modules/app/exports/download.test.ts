import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findArtifact: vi.fn(), assertAccess: vi.fn(), stream: vi.fn(), event: vi.fn() }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), getJob: vi.fn(), removeJob: vi.fn(), QueueNames: { EXPORT: 'export' } }));
vi.mock('@nibleaf/database', () => ({
  Prisma: { DbNull: null },
  prisma: { exportArtifact: { findFirst: mocks.findArtifact }, user: { findUnique: vi.fn() } },
}));
vi.mock('@/actions/projects', () => ({ assertProjectAccess: mocks.assertAccess }));
vi.mock('@/actions/platform-events', () => ({ logPlatformEvent: mocks.event }));
vi.mock('@/env', () => ({ env: { EXPORT_DOWNLOAD_TTL_SECONDS: 300 } }));
vi.mock('@nibleaf/storage', async (importOriginal) => {
  const storage = await importOriginal<typeof import('@nibleaf/storage')>();
  return {
    ...storage,
    getObjectStream: mocks.stream,
    presignGetUrl: (options: Parameters<typeof storage.presignGetUrl>[0]) =>
      storage.presignGetUrl({
        ...options,
        target: {
          bucket: 'synthetic',
          endpoint: 'https://storage.example.test',
          region: 'us-east-1',
          forcePathStyle: true,
          accessKeyId: 'synthetic-access',
          secretAccessKey: 'synthetic-secret',
        },
      }),
  };
});

import { presignGetUrl } from '@nibleaf/storage';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import handlers from './handlers';

const app = new Hono<HonoEnv>()
  .use(contextStorage())
  .use('*', async (ctx, next) => {
    ctx.set('user', ctx.req.header('Cookie') === 'synthetic=member' ? ({ id: 'synthetic-user' } as HonoEnv['Variables']['user']) : null);
    await next();
  })
  .route('/api/app/projects/:projectId/exports', handlers)
  .onError((error, ctx) => (error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: 'Download unavailable' }, 500)));
const base = '/api/app/projects/project-1/exports/run-1/artifacts/artifact-1';
const request = (path = `${base}/file`, signal?: AbortSignal) => app.request(path, { headers: { Cookie: 'synthetic=member' }, signal });
const bodyOf = (response: Response) => {
  if (!response.body) throw new Error('Expected download body');
  return response.body;
};
const pendingStream = () =>
  new Readable({
    read() {
      /* The test pushes each chunk explicitly. */
    },
  });
const artifact = { storageKey: 'exports/guide.pdf', fileName: "دليل 'special'.pdf", format: 'PDF', size: 8, job: { expiresAt: null } };

beforeEach(() => {
  mocks.findArtifact.mockResolvedValue(artifact);
  mocks.assertAccess.mockResolvedValue({ organizationId: 'project-org', role: 'VIEWER' });
  mocks.stream.mockImplementation(() => Readable.from([Buffer.from('PDF-data')]));
});
afterEach(() => vi.resetAllMocks());

describe('authenticated export file downloads', () => {
  it('streams attachment bytes independently of storage response metadata', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      "attachment; filename=\"____ 'special'.pdf\"; filename*=UTF-8''%D8%AF%D9%84%D9%8A%D9%84%20%27special%27.pdf",
    );
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Length')).toBe('8');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe('sandbox');
    expect(await response.text()).toBe('PDF-data');
    expect(mocks.assertAccess).toHaveBeenCalledExactlyOnceWith('synthetic-user', 'project-1');
    expect(mocks.findArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'artifact-1', jobId: 'run-1', job: { projectId: 'project-1', status: 'SUCCEEDED' } } }),
    );
    expect(mocks.stream).toHaveBeenCalledWith('exports/guide.pdf', undefined, expect.any(AbortSignal));
    expect(mocks.event).toHaveBeenCalledWith('export_file_requested', expect.objectContaining({ userId: 'synthetic-user', projectId: 'project-1' }));
  });

  it('preserves the signed URL API and adds a first-party file link', async () => {
    const response = await request(`${base}/download`);
    const { data } = (await response.json()) as { data: { url: string; fileName: string; expiresInSeconds: number; fileUrl: string } };
    const url = new URL(data.url);
    expect(response.status).toBe(200);
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(data).toMatchObject({ expiresInSeconds: 300, fileName: artifact.fileName, fileUrl: `${base}/file` });
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('keeps ordinary asset signed GETs unchanged', async () => {
    const url = new URL(await presignGetUrl({ key: 'images/logo.svg' }));
    expect(url.searchParams.has('response-content-disposition')).toBe(false);
    expect(url.pathname).toBe('/synthetic/images/logo.svg');
  });

  it('requires authentication before artifact or storage access', async () => {
    expect((await app.request(`${base}/file`)).status).toBe(401);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.findArtifact).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('requires membership in the target project organization', async () => {
    mocks.assertAccess.mockRejectedValue(new AppError({ code: 'auth:insufficient_role' }));
    expect((await request()).status).toBe(403);
    expect(mocks.findArtifact).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it.each([null, { ...artifact, job: { expiresAt: new Date(0) } }])(
    'rejects missing, foreign or expired artifacts before storage',
    async (record) => {
      mocks.findArtifact.mockResolvedValue(record);
      expect((await request()).status).toBe(404);
      expect(mocks.stream).not.toHaveBeenCalled();
    },
  );

  it.each(['bad\r\nInjected: value.pdf', '../private.pdf', 'path/file.pdf', 'path\\file.pdf', '', 'bad\0name.pdf', 'bad\u007fname.pdf'])(
    'rejects unsafe filenames before streaming: %j',
    async (fileName) => {
      mocks.findArtifact.mockResolvedValue({ ...artifact, fileName });
      const response = await request();
      expect(response.status).toBe(500);
      expect(response.headers.has('Content-Disposition')).toBe(false);
      expect(mocks.stream).not.toHaveBeenCalled();
    },
  );

  it('sends ZIP content as an attachment too', async () => {
    mocks.findArtifact.mockResolvedValue({ ...artifact, fileName: 'guide.zip', format: 'MARKDOWN' });
    const response = await request();
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('Content-Disposition')).toContain('filename="guide.zip"');
    await response.arrayBuffer();
  });

  it('delivers a chunk before the object stream finishes', async () => {
    const source = pendingStream();
    mocks.stream.mockResolvedValue(source);
    const response = await request();
    const reader = bodyOf(response).getReader();
    source.push(Buffer.from('PDF-'));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('PDF-');
    source.push(Buffer.from('data'));
    source.push(null);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data');
    expect((await reader.read()).done).toBe(true);
  });

  it('cancels storage when the client cancels the body', async () => {
    const source = pendingStream();
    mocks.stream.mockResolvedValue(source);
    await bodyOf(await request()).cancel();
    expect(source.destroyed).toBe(true);
  });

  it('passes request cancellation to storage and destroys an opened stream', async () => {
    const source = pendingStream();
    mocks.stream.mockResolvedValue(source);
    const controller = new AbortController();
    const response = await request(`${base}/file`, controller.signal);
    const storageSignal = mocks.stream.mock.calls[0]?.[2] as AbortSignal;
    expect(storageSignal.aborted).toBe(false);
    controller.abort();
    expect(source.destroyed).toBe(true);
    expect(storageSignal.aborted).toBe(true);
    await bodyOf(response).cancel();
  });

  it('does not substitute an HTML page for a storage failure', async () => {
    mocks.stream.mockRejectedValue(new Error('synthetic storage failure'));
    const response = await request();
    expect(response.status).toBe(500);
    expect(response.headers.has('Content-Disposition')).toBe(false);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.text()).toBe('{"error":"Download unavailable"}');
  });

  it('propagates a mid-stream failure instead of completing a truncated file', async () => {
    const source = pendingStream();
    mocks.stream.mockResolvedValue(source);
    const reader = bodyOf(await request()).getReader();
    source.push(Buffer.from('PDF-'));
    await reader.read();
    source.destroy(new Error('synthetic stream failure'));
    await expect(reader.read()).rejects.toThrow('synthetic stream failure');
  });
});
