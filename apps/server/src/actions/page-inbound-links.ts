import { createHash } from 'node:crypto';
import { prisma } from '@nibleaf/database';
import { buildInboundPageLinkMap, type InboundPageLinks } from '@nibleaf/shared/publish-checks';
import { buildSnapshot } from '@nibleaf/shared/site';
import { notFound } from '@/errors';
import { trustedSiteOrigins } from '@/lib/site-host';

const MAX_BRANCHES = 8;
const MAX_CACHED_PAGES = 10_000;
const branches = new Map<string, { fingerprint: string; count: number; result: Promise<Map<string, InboundPageLinks>> }>();

/** Read-only advisory. Only the target branch's bodies are loaded. Other
 * branch metadata is needed for buildSnapshot's stable version slugs.
 * Cache capped results for every target so opening another deletion is a
 * lookup after the cheap metadata fingerprint, never another content scan. */
export const getPageInboundLinks = async (projectId: string, id: string) => {
  const target = await prisma.page.findFirst({ where: { projectId, id }, select: { branchId: true } });
  if (!target) throw notFound('page', { id });
  const branchId = target.branchId;
  const [project, revisions] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      include: {
        languages: { orderBy: { position: 'asc' } },
        branches: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true, name: true, isDefault: true, updatedAt: true } },
        domains: { where: { verified: true }, select: { domain: true, verified: true }, orderBy: { domain: 'asc' } },
        openApiDocument: { select: { title: true, path: true, contentHash: true, updatedAt: true } },
      },
    }),
    // Only small revision/structure columns, never content. Unlike max(time)
    // plus count, this also detects an edit to an older revision, or a same-
    // count delete/restore. xmin also catches writes retaining an old timestamp.
    prisma.$queryRaw<{ revision: string; count: number }[]>`
      SELECT md5(COALESCE(string_agg(json_build_array(id, xmin::text, "updatedAt", "parentId", slug, path,
        "languageId", position, hidden)::text, ',' ORDER BY id), '')) AS revision,
        COUNT(*)::int AS count FROM "page" WHERE "projectId" = ${projectId} AND "branchId" = ${branchId}
    `,
  ]);
  if (!project) throw notFound('project', { id: projectId });
  const origins = trustedSiteOrigins(project);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([revisions, project.updatedAt, project.config, project.languages, project.branches, project.openApiDocument, origins]))
    .digest('base64');
  const key = JSON.stringify([projectId, branchId]);
  let cached = branches.get(key);
  if (cached?.fingerprint === fingerprint) {
    branches.delete(key);
    branches.set(key, cached);
  } else {
    const result = (async () => {
      const pages = await prisma.page.findMany({
        where: { projectId, branchId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: { language: { select: { code: true } } },
      });
      const snapshot = buildSnapshot(
        { ...project, openApiDocument: project.openApiDocument ? { ...project.openApiDocument, document: {} } : null },
        pages.map(({ language, createdAt, updatedAt, ...page }) => ({
          ...page,
          languageCode: language.code,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
        })),
        new Date().toISOString(),
      );
      return buildInboundPageLinkMap(snapshot, origins);
    })();
    cached = { fingerprint, count: revisions[0]?.count ?? 0, result };
    branches.delete(key);
    branches.set(key, cached);
    while (branches.size > MAX_BRANCHES || [...branches.values()].reduce((sum, entry) => sum + entry.count, 0) > MAX_CACHED_PAGES) {
      const oldest = branches.keys().next().value;
      if (oldest === undefined) break;
      branches.delete(oldest);
    }
  }
  try {
    const result = (await cached.result).get(id);
    if (!result) throw notFound('page', { id });
    return result;
  } catch (error) {
    if (branches.get(key) === cached) branches.delete(key);
    throw error;
  }
};
