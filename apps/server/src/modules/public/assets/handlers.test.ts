import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const mocks = vi.hoisted(() => ({
  getObjectStream: vi.fn(),
  getProjectDeliveryAccess: vi.fn(),
  headObject: vi.fn(),
  isProjectTakenDown: vi.fn(),
}));

vi.mock('@nibleaf/storage', () => ({ getObjectStream: mocks.getObjectStream, headObject: mocks.headObject }));
vi.mock('@/actions/sites', () => ({ getProjectDeliveryAccess: mocks.getProjectDeliveryAccess, isProjectTakenDown: mocks.isProjectTakenDown }));

import handlers from './handlers';

const app = new Hono<HonoEnv>();
app.onError((error, ctx) =>
  error instanceof AppError ? ctx.json(error.toJSON(), error.status) : ctx.json({ error: { message: error.message } }, 500),
);
app.route('/api/public/assets', handlers);

const assetRequest = (key: string) => app.request(`/api/public/assets/${key}`);
const errorOf = async (response: Response) => ((await response.json()) as { error: { code: string; entityType?: string } }).error;

const expectNoStorageCall = () => {
  expect(mocks.headObject).not.toHaveBeenCalled();
  expect(mocks.getObjectStream).not.toHaveBeenCalled();
};

describe('public asset delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isProjectTakenDown.mockResolvedValue(false);
    mocks.getProjectDeliveryAccess.mockResolvedValue({ kind: 'public', allowedPageIds: null });
    mocks.headObject.mockResolvedValue({ ContentType: 'image/png' });
    mocks.getObjectStream.mockImplementation(async () => Readable.from([Buffer.from('image-bytes')]));
  });

  it('streams an asset of a public project with the shared cache policy', async () => {
    const response = await assetRequest('projects/project-a/assets/logo.png');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('image-bytes');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(mocks.getProjectDeliveryAccess).toHaveBeenCalledWith('project-a', expect.any(Headers));
    expect(mocks.headObject).toHaveBeenCalledWith('projects/project-a/assets/logo.png');
  });

  it('keeps an asset of a private project out of shared caches for an allowed viewer', async () => {
    mocks.getProjectDeliveryAccess.mockResolvedValue({ kind: 'workspace', allowedPageIds: null });
    const response = await assetRequest('projects/project-a/assets/logo.png');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('hides an asset of a private or unknown project from a visitor without access', async () => {
    mocks.getProjectDeliveryAccess.mockResolvedValue(null);
    const response = await assetRequest('projects/project-a/assets/logo.png');
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toMatchObject({ code: 'database:not_found', entityType: 'asset' });
    expectNoStorageCall();
  });

  it('hides an asset of a taken-down project', async () => {
    mocks.isProjectTakenDown.mockResolvedValue(true);
    const response = await assetRequest('projects/project-a/assets/logo.png');
    expect(response.status).toBe(404);
    expectNoStorageCall();
  });

  it.each([
    'projects/project-a/exports/run-1/site.zip',
    'projects/project-a/other/file.bin',
    'projects%2Fproject-a%2Fassets%2F..%2Fexports%2Frun-1%2Fsite.zip',
    'legacy%2F..%2Fprojects%2Fproject-a%2Fexports%2Frun-1%2Fsite.zip',
    '%2Fprojects%2Fproject-a%2Fexports%2Frun-1%2Fsite.zip',
    'projects%2F%2Fproject-a%2Fexports%2Frun-1%2Fsite.zip',
    // Authorization could see one project and the read another, depending on the store.
    'projects%2Fproject-a%2Fassets%2F..%2F..%2Fproject-b%2Fassets%2Fsecret.png',
    'projects%2Fproject-a%2Fexports%2F..%2Fassets%2Fsecret.zip',
    'projects%2F.%2Fproject-a%2Fassets%2Flogo.png',
    '.%2Fprojects%2Fproject-a%2Fassets%2Flogo.png',
    'projects%2F..%2Flegacy%2Flogo.png',
  ])('answers %s with the missing-asset 404 and no storage call', async (key) => {
    const response = await assetRequest(key);
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toMatchObject({ code: 'database:not_found', entityType: 'asset' });
    expectNoStorageCall();
    expect(mocks.getProjectDeliveryAccess).not.toHaveBeenCalled();
  });

  it('matches the response of an object that does not exist', async () => {
    mocks.headObject.mockRejectedValue(new Error('NotFound'));
    const missing = await assetRequest('projects/project-a/assets/missing.png');
    const exported = await assetRequest('projects/project-a/exports/run-1/site.zip');
    expect(exported.status).toBe(missing.status);
    expect(await errorOf(exported)).toMatchObject({ code: (await errorOf(missing)).code, entityType: 'asset' });
  });

  it.each([
    ['legacy/logo.png', 'legacy/logo.png'],
    ['legacy%2F..%2Flogo.png', 'legacy/../logo.png'],
    ['legacy%2F%2Flogo.png', 'legacy//logo.png'],
  ])('leaves %s, outside projects/, as it was', async (requested, stored) => {
    const response = await assetRequest(requested);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('image-bytes');
    expect(mocks.isProjectTakenDown).not.toHaveBeenCalled();
    expect(mocks.getProjectDeliveryAccess).not.toHaveBeenCalled();
    expect(mocks.headObject).toHaveBeenCalledWith(stored);
  });
});
