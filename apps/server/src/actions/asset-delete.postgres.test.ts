import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ deleteObject: vi.fn(), deleteObjects: vi.fn() }));
vi.mock('@nibleaf/storage', async (importOriginal) => ({
  StorageDeleteError: (await importOriginal<typeof import('@nibleaf/storage')>()).StorageDeleteError,
  UPLOAD_PRESIGN_EXPIRES_IN_SECONDS: 600,
  ...storage,
  headObject: vi.fn(),
  presignPutUrl: vi.fn(),
  putObject: vi.fn(),
  isNotFound: () => false,
}));
vi.mock('./projects', () => ({ assertProjectInOrg: vi.fn() }));

// Opt in only against a migrated test database. Every fixture is synthetic, storage
// is mocked, and cleanup is restricted to the organizations this suite creates.
describe.skipIf(process.env.ASSET_DELETE_INTEGRATION !== '1')('deleting an asset in PostgreSQL', () => {
  let db: typeof import('@nibleaf/database');
  let actions: typeof import('./assets');
  const organizationIds: string[] = [];

  beforeAll(async () => {
    db = await import('@nibleaf/database');
    actions = await import('./assets');
  }, 120_000);
  beforeEach(() => {
    storage.deleteObject.mockReset().mockResolvedValue(undefined);
    storage.deleteObjects.mockReset().mockImplementation(async (keys: string[]) => {
      for (const key of keys) await storage.deleteObject(key);
    });
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await db.prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  });

  const fixture = async () => {
    const label = `asset-delete-${randomUUID()}`;
    const organization = await db.prisma.organization.create({ data: { name: label } });
    organizationIds.push(organization.id);
    const project = await db.prisma.project.create({ data: { organizationId: organization.id, name: label, slug: label } });
    const main = await db.prisma.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
    const draft = await db.prisma.branch.create({ data: { projectId: project.id, name: 'v2' } });
    const en = await db.prisma.language.create({ data: { projectId: project.id, code: 'en', label: 'English', isDefault: true } });
    const ar = await db.prisma.language.create({ data: { projectId: project.id, code: 'ar', label: 'العربية', direction: 'RTL' } });
    const key = `projects/${project.id}/assets/${randomUUID()}-diagram.png`;
    const asset = await db.prisma.asset.create({
      data: { projectId: project.id, key, url: `/api/public/assets/${key}`, contentType: 'image/png', size: 1024 },
    });
    const page = (data: { branchId: string; languageId: string; content?: string; config?: object }) =>
      db.prisma.page.create({ data: { projectId: project.id, title: 'Guide', slug: 'guide', path: 'guide', ...data } });
    return { organization, project, main, draft, en, ar, asset, page };
  };
  const remove = (f: Awaited<ReturnType<typeof fixture>>, assetId = f.asset.id) => actions.deleteAsset(f.organization.id, f.project.id, assetId);

  it('deletes an unused asset, its record and its stored file', async () => {
    const f = await fixture();
    await f.page({ branchId: f.main.id, languageId: f.en.id, content: '# Guide\n\nNo images here.' });
    await expect(remove(f)).resolves.toEqual({ id: f.asset.id });
    expect(await db.prisma.asset.findUnique({ where: { id: f.asset.id } })).toBeNull();
    expect(storage.deleteObject).toHaveBeenCalledWith(f.asset.key);
    expect(await db.prisma.assetUploadTombstone.findUnique({ where: { key: f.asset.key } })).toBeNull();
  });

  it.each([
    ['a page in another language and version (a draft)', 'draft-page'],
    ['a page on main as an HTML image', 'main-html'],
    ["a page's social image", 'page-config'],
    ["the site's logo", 'project-config'],
    ["a language's settings", 'language-config'],
    ['the published site', 'deployment'],
  ])('keeps an asset that %s still uses', async (_label, where) => {
    const f = await fixture();
    const url = f.asset.url;
    if (where === 'draft-page') await f.page({ branchId: f.draft.id, languageId: f.ar.id, content: `![مخطط](${url})` });
    if (where === 'main-html')
      await f.page({ branchId: f.main.id, languageId: f.en.id, content: `<img src="https://docs.example.test${url}" alt="" />` });
    if (where === 'page-config') await f.page({ branchId: f.main.id, languageId: f.en.id, config: { seo: { ogImage: url } } });
    if (where === 'project-config') await db.prisma.project.update({ where: { id: f.project.id }, data: { config: { branding: { logo: url } } } });
    if (where === 'language-config') await db.prisma.language.update({ where: { id: f.ar.id }, data: { config: { seo: { socialImage: url } } } });
    if (where === 'deployment')
      await db.prisma.deployment.create({
        data: { projectId: f.project.id, version: 1, status: 'READY', snapshot: { pages: [{ content: `![x](${url})` }] } },
      });
    await expect(remove(f)).rejects.toMatchObject({ code: 'asset:in_use', status: 409 });
    expect(await db.prisma.asset.findUnique({ where: { id: f.asset.id } })).not.toBeNull();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("never deletes another project's asset", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(remove(f, other.asset.id)).rejects.toMatchObject({ status: 404 });
    expect(await db.prisma.asset.findUnique({ where: { id: other.asset.id } })).not.toBeNull();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('leaves a cleanup record when storage fails, and the worker finishes the delete', async () => {
    const f = await fixture();
    storage.deleteObject.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(remove(f)).resolves.toEqual({ id: f.asset.id });
    expect(await db.prisma.asset.findUnique({ where: { id: f.asset.id } })).toBeNull();
    const tombstone = await db.prisma.assetUploadTombstone.findUnique({ where: { key: f.asset.key } });
    expect(tombstone).toMatchObject({ projectId: f.project.id, firstRecheckedAt: expect.any(Date) });
    const workerModule = new URL('../../../worker/src/pending-asset-uploads.ts', import.meta.url).href;
    const sweeper: { sweepAssetUploadTombstones(now?: Date): Promise<number> } = await import(workerModule);
    // Only this suite's tombstones are due this far ahead in a test database.
    await sweeper.sweepAssetUploadTombstones(new Date((tombstone?.nextCheckAt.getTime() ?? 0) + 1000));
    expect(storage.deleteObject).toHaveBeenLastCalledWith(f.asset.key);
    expect(await db.prisma.assetUploadTombstone.findUnique({ where: { key: f.asset.key } })).toBeNull();
  });

  it('answers a second delete of the same asset with not found', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([remove(f), remove(f)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 404 } });
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
  });
});
