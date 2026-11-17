import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ pageFindFirst: vi.fn(), pageFindMany: vi.fn(), projectFindUnique: vi.fn(), revision: vi.fn() }));
vi.mock('@nibleaf/database', () => ({
  prisma: {
    page: { findFirst: database.pageFindFirst, findMany: database.pageFindMany },
    project: { findUnique: database.projectFindUnique },
    $queryRaw: database.revision,
  },
}));
vi.mock('@/env', () => ({ env: { SITE_BASE_DOMAIN: '*.nibleaf.test.' } }));

const stamp = new Date('2026-11-11T12:00:00Z');
const project = () => ({
  id: 'project',
  name: 'Docs',
  slug: 'docs',
  description: null,
  icon: null,
  config: null as object | null,
  updatedAt: stamp,
  languages: [{ code: 'en', label: 'English', direction: 'LTR' as const, isDefault: true, config: null }],
  branches: [
    { id: 'main', name: 'main', isDefault: true },
    { id: 'other', name: 'v2', isDefault: false },
  ],
  domains: [
    { domain: 'verified.example.test', verified: true },
    { domain: 'unverified.example.test', verified: false },
  ],
  openApiDocument: null,
});
const row = (id: string, content = '') => ({
  id,
  parentId: null,
  branchId: 'main',
  language: { code: 'en' },
  kind: 'PAGE',
  title: id,
  slug: id,
  path: id,
  content,
  icon: null,
  description: null,
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
  createdAt: stamp,
  updatedAt: stamp,
});

describe('branch inbound map cache and trusted origins', () => {
  let getPageInboundLinks: typeof import('./page-inbound-links').getPageInboundLinks;
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    ({ getPageInboundLinks } = await import('./page-inbound-links'));
    database.pageFindFirst.mockResolvedValue({ branchId: 'main' });
    database.projectFindUnique.mockResolvedValue(project());
    database.pageFindMany.mockResolvedValue([row('target'), row('source', '[Target](/target)')]);
    database.revision.mockResolvedValue([{ revision: 'revision-one', count: 2 }]);
  });

  it('loads only the target branch and reuses one map for different deletion targets', async () => {
    expect((await getPageInboundLinks('project', 'target')).total).toBe(1);
    expect((await getPageInboundLinks('project', 'source')).total).toBe(0);
    expect(database.pageFindMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: { projectId: 'project', branchId: 'main' } }));
    const call = database.revision.mock.calls[0];
    if (!call) throw new Error('Missing revision read');
    const sql = call[0].join(' ');
    expect(sql).toContain('"updatedAt"');
    expect(sql).toContain('"parentId"');
    expect(sql).toContain('xmin::text');
    expect(sql).not.toContain('content');
    expect(call.slice(1)).toEqual(['project', 'main']);
  });

  it('invalidates on an edit without relying on the newest page revision or changing count', async () => {
    expect((await getPageInboundLinks('project', 'target')).total).toBe(1);
    database.pageFindMany.mockResolvedValue([row('target'), { ...row('source', 'Link removed.'), updatedAt: new Date(stamp.getTime() + 1) }]);
    database.revision.mockResolvedValue([{ revision: 'edited-source-revision', count: 2 }]);
    expect((await getPageInboundLinks('project', 'target')).total).toBe(0);
    expect(database.pageFindMany).toHaveBeenCalledTimes(2);
  });

  it('invalidates on redirects/config and verified-domain changes', async () => {
    database.pageFindMany.mockResolvedValue([row('target'), row('source', '[Target](/old)')]);
    expect((await getPageInboundLinks('project', 'target')).total).toBe(0);
    database.projectFindUnique.mockResolvedValue({ ...project(), config: { redirects: [{ from: '/old', to: '/target' }] } });
    expect((await getPageInboundLinks('project', 'target')).total).toBe(1);
    database.pageFindMany.mockResolvedValue([row('target'), row('source', '[Target](https://new.example.test/target)')]);
    database.projectFindUnique.mockResolvedValue({ ...project(), domains: [{ domain: 'new.example.test', verified: true }] });
    expect((await getPageInboundLinks('project', 'target')).total).toBe(1);
    expect(database.pageFindMany).toHaveBeenCalledTimes(3);
  });

  it('uses the shared default-host convention and verified aliases, excluding unverified domains', async () => {
    database.pageFindMany.mockResolvedValue([
      row('target'),
      row('default-host', '[Target](https://DOCS.nibleaf.test:443/target)'),
      row('custom-host', '[Target](http://verified.example.test:80/target)'),
      row('unverified-host', '[Target](https://unverified.example.test/target)'),
    ]);
    expect((await getPageInboundLinks('project', 'target')).pages.map((p) => p.id)).toEqual(['default-host', 'custom-host']);
  });

  it('evicts least-recently-used branches and retains a recently opened map', async () => {
    await getPageInboundLinks('project', 'target');
    for (let i = 0; i < 7; i++) await getPageInboundLinks(`project-${i}`, 'target');
    await getPageInboundLinks('project', 'target'); // refresh LRU position
    await getPageInboundLinks('new-project', 'target');
    expect(database.pageFindMany).toHaveBeenCalledTimes(9);
    await getPageInboundLinks('project', 'target');
    expect(database.pageFindMany).toHaveBeenCalledTimes(9);
    await getPageInboundLinks('project-0', 'target');
    expect(database.pageFindMany).toHaveBeenCalledTimes(10);
  });

  it('coalesces concurrent scans and removes a failed map so the next request can recover', async () => {
    database.pageFindMany.mockRejectedValueOnce(new Error('read failed'));
    const requests = await Promise.allSettled([getPageInboundLinks('project', 'target'), getPageInboundLinks('project', 'source')]);
    expect(requests.every((r) => r.status === 'rejected')).toBe(true);
    expect(database.pageFindMany).toHaveBeenCalledTimes(1);
    expect((await getPageInboundLinks('project', 'target')).total).toBe(1);
    expect(database.pageFindMany).toHaveBeenCalledTimes(2);
  });

  it('evicts an aborted scan and rebuilds the complete map on the next open', async () => {
    const shared = await import('@nibleaf/shared/publish-checks');
    const scan = shared.buildInboundPageLinkMapAsync;
    const controller = new AbortController();
    let clock = 0;
    const scanner = vi.spyOn(shared, 'buildInboundPageLinkMapAsync').mockImplementationOnce((snapshot, origins, options) =>
      scan(snapshot, origins, {
        ...options,
        now: () => {
          clock += 25;
          return clock;
        },
        yieldToEventLoop: async () => {
          controller.abort();
        },
      }),
    );
    await expect(getPageInboundLinks('project', 'target', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect((await getPageInboundLinks('project', 'target')).total).toBe(1);
    expect((await getPageInboundLinks('project', 'source')).total).toBe(0);
    expect(database.pageFindMany).toHaveBeenCalledTimes(2);
    expect(scanner).toHaveBeenCalledTimes(2);
  });

  it('keeps a coalesced scan alive for another caller when one request aborts', async () => {
    const shared = await import('@nibleaf/shared/publish-checks');
    const scan = shared.buildInboundPageLinkMapAsync;
    const controller = new AbortController();
    let clock = 0;
    vi.spyOn(shared, 'buildInboundPageLinkMapAsync').mockImplementationOnce((snapshot, origins, options) =>
      scan(snapshot, origins, {
        ...options,
        now: () => {
          clock += 25;
          return clock;
        },
        yieldToEventLoop: async () => {
          controller.abort();
        },
      }),
    );
    const aborted = getPageInboundLinks('project', 'target', controller.signal);
    const retained = getPageInboundLinks('project', 'target');
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect((await retained).total).toBe(1);
    expect((await getPageInboundLinks('project', 'target')).total).toBe(1);
    expect(database.pageFindMany).toHaveBeenCalledTimes(1);
  });

  it('rejects an already aborted request before any reads', async () => {
    await expect(getPageInboundLinks('project', 'target', AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(database.pageFindFirst).not.toHaveBeenCalled();
  });
});
