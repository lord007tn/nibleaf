import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/bullmq', async (original) => ({
  ...(await original<typeof import('@nibleaf/bullmq')>()),
  createJob: vi.fn(async () => undefined),
}));
describe.skipIf(process.env.JOIN_LINKS_INTEGRATION !== '1')('website join-link compatibility endpoints', () => {
  let db: typeof import('@nibleaf/database');
  let links: typeof import('./join-links');
  const id = `links-${randomUUID()}`;
  let projectId: string;
  beforeAll(async () => {
    db = await import('@nibleaf/database');
    links = await import('./join-links');
    await db.prisma.user.create({ data: { id, name: 'Synthetic', email: `${id}@nibleaf.test`, emailVerified: true } });
    await db.prisma.organization.create({ data: { id, name: 'Synthetic organization', slug: id } });
    await db.prisma.member.create({ data: { organizationId: id, userId: id, orgRole: 'owner', role: 'owner' } });
    projectId = (await db.prisma.project.create({ data: { organizationId: id, name: 'Synthetic website', slug: id } })).id;
  }, 120_000);
  afterAll(async () => {
    await db.prisma.project.deleteMany({ where: { organizationId: id } });
    await db.prisma.organization.delete({ where: { id } });
    await db.prisma.user.deleteMany({ where: { id: { startsWith: id } } });
    await db.prisma.$disconnect();
  });
  it('stores only a hash and previews safe organization, website and domain information', async () => {
    const { token, link } = await links.createJoinLink(id, { id, role: 'owner' }, { role: 'viewer', allowedDomain: 'nibleaf.test' }, projectId);
    const stored = await db.prisma.joinLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.role).toBe('viewer');
    expect(stored.orgRole).toBe('member');
    expect(await links.getJoinLinkPreview(token)).toEqual({
      organizationName: 'Synthetic organization',
      siteName: 'Synthetic website',
      role: 'viewer',
      grants: [{ name: 'Synthetic website', role: 'viewer' }],
      allowedDomain: 'nibleaf.test',
    });
  });
  it('regenerates, revokes finally and hides unknown tokens', async () => {
    const first = await links.createJoinLink(id, { id, role: 'owner' }, { role: 'member' }, projectId);
    const second = await links.regenerateJoinLink(id, first.link.id, { id, role: 'owner' }, projectId);
    if (!second.token) throw new Error('Expected regenerated token');
    await expect(links.getJoinLinkPreview(first.token)).rejects.toMatchObject({ code: 'join:invalid' });
    await expect(links.getJoinLinkPreview(second.token)).resolves.toMatchObject({ role: 'member' });
    await links.revokeJoinLink(id, first.link.id, { id, role: 'owner' }, projectId);
    await expect(links.getJoinLinkPreview(second.token)).rejects.toMatchObject({ code: 'join:invalid' });
    await expect(links.regenerateJoinLink(id, first.link.id, { id, role: 'owner' }, projectId)).rejects.toMatchObject({ status: 409 });
    await expect(links.getJoinLinkPreview('missing')).rejects.toMatchObject({ code: 'join:invalid' });
  });
  it('uses the shared admission and returns its exact landing', async () => {
    const userId = `${id}-joiner`;
    await db.prisma.user.create({ data: { id: userId, name: 'Synthetic', email: `${userId}@nibleaf.test`, emailVerified: true } });
    const { token } = await links.createJoinLink(id, { id, role: 'owner' }, { role: 'viewer' }, projectId);
    expect(await links.joinWithLink(token, userId)).toEqual({ organizationId: id, landing: { projectId } });
    expect((await links.listJoinLinks(id, projectId)).some((link) => link.useCount === 1)).toBe(true);
  });
});
