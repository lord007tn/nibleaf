import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@nibleaf/database';
import { summarizeRedirectIssues } from '@nibleaf/shared/redirects';
import type { SiteSnapshot, SnapshotProject } from '@nibleaf/shared/site';
import { z } from 'zod';
import { getCurrentSnapshot, getPendingChanges, listDeployments, type PendingChanges } from '@/actions/deployments';
import { findLiveDomain } from '@/actions/live-domain';
import { env } from '@/env';
import { AppError } from '@/errors';
import { normalizeBaseDomain } from '@/lib/site-host';
import { canonicalHash } from './idempotency';

const PREVIEW_TOKEN_VERSION = 'v1';
export const PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEW_CHANGES = 50;
const previewPayloadSchema = z.tuple([z.string(), z.string(), z.string(), z.number().int()]);

const previewSignature = (payload: string) =>
  createHmac('sha256', env.BETTER_AUTH_SECRET).update(`nibleaf:mcp-publish-preview:${PREVIEW_TOKEN_VERSION}:${payload}`, 'utf8').digest('base64url');

/** A stateless, short-lived token binding the acting person and project to the
 *  exact publishable state they were shown. It is bound to the key's owner
 *  rather than the key itself: every key of that person already holds no more
 *  than their role, a token is consumed once per key, and any publish moves the
 *  digest, so a second key of the same person cannot reuse it to ship anything. */
export const createPublishPreviewToken = (actorUserId: string, projectId: string, digest: string, now = Date.now()) => {
  const expiresAt = now + PREVIEW_TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify([actorUserId, projectId, digest, expiresAt]), 'utf8').toString('base64url');
  return { token: `${PREVIEW_TOKEN_VERSION}.${payload}.${previewSignature(payload)}`, expiresAt };
};

const invalidPreview = () =>
  new AppError({
    code: 'mcp:preview_invalid',
    message: 'The previewToken is not valid for this person and project. Call preview_publish to get a new one.',
  });

/** Verify a preview token and return the state digest it was issued for. The
 *  signature is checked before anything else, so a forged or tampered token is
 *  always `mcp:preview_invalid`, never `expired` or `stale`. */
export const readPublishPreviewToken = (token: string, actorUserId: string, projectId: string, now = Date.now()): string => {
  const [version, payload, signature, ...rest] = token.split('.');
  if (version !== PREVIEW_TOKEN_VERSION || !(payload && signature) || rest.length > 0) throw invalidPreview();
  // Compare the canonical base64url text, not decoded bytes: lenient decoding
  // accepts other spellings of the same signature, and each spelling would be
  // a different single-use consumption key.
  const expected = Buffer.from(previewSignature(payload), 'utf8');
  const received = Buffer.from(signature, 'utf8');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw invalidPreview();
  let decoded: z.infer<typeof previewPayloadSchema>;
  try {
    decoded = previewPayloadSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  } catch {
    throw invalidPreview();
  }
  const [tokenActorId, tokenProjectId, digest, expiresAt] = decoded;
  if (tokenActorId !== actorUserId || tokenProjectId !== projectId) throw invalidPreview();
  if (expiresAt <= now) {
    throw new AppError({
      code: 'mcp:preview_expired',
      message: 'The previewToken expired (it is valid for 10 minutes). Call preview_publish again and show the new summary before publishing.',
    });
  }
  return digest;
};

/**
 * Digest of everything the next publish would ship, plus the deployment
 * history it would extend. Page creation/update timestamps are left out (an
 * autosave that changes nothing must not invalidate a preview) and pages are
 * ordered by id (their query order is not stable across ties). Any change to
 * content, structure, settings, the OpenAPI document, the last READY version
 * or the newest deployment version (any status: a publish or rollback started
 * by anyone, including this key's own publish_changes) changes the digest.
 */
export const publishStateDigest = (snapshot: SiteSnapshot, baselineVersion: number | null, newestVersion: number | null) =>
  canonicalHash({
    baselineVersion,
    newestVersion,
    project: snapshot.project,
    openapi: snapshot.openapi ? { title: snapshot.openapi.title, path: snapshot.openapi.path, contentHash: snapshot.openapi.contentHash } : null,
    pages: [...snapshot.pages]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...page }) => page),
  });

const PROJECT_SETTING_FIELDS = ['name', 'slug', 'description', 'icon', 'languages', 'versions'] as const;

/** Site settings the next publish would change compared with the last READY
 *  snapshot: project fields and top-level `config` sections (theme, navigation
 *  and the like), which ship with a publish just like pages. Names only, never
 *  values. Empty for a first publish, where everything is new anyway. */
export const changedSiteSettings = (current: SnapshotProject, published: SnapshotProject | null | undefined): string[] => {
  if (!published) return [];
  const differs = (left: unknown, right: unknown) => canonicalHash(left ?? null) !== canonicalHash(right ?? null);
  const fields = PROJECT_SETTING_FIELDS.filter((field) => differs(current[field], published[field]));
  const config = current.config ?? {};
  const before = published.config ?? {};
  const sections = [...new Set([...Object.keys(config), ...Object.keys(before)])]
    .filter((key) => differs(config[key], before[key]))
    .sort()
    .map((key) => `config.${key}`);
  return [...fields, ...sections];
};

/** Read the publishable state once: the snapshot, the pending changes computed
 *  from that same snapshot, the site settings that differ, and its digest. */
export const readPublishState = async (
  projectId: string,
): Promise<{ pending: PendingChanges; settings: string[]; digest: string; snapshot: SiteSnapshot }> => {
  // Read the newest version BEFORE the snapshot: a deployment created in
  // between then makes a later recompute differ (fail closed), never match.
  const newestVersion = (await listDeployments(projectId))[0]?.version ?? null;
  const snapshot = await getCurrentSnapshot(projectId);
  const pending = await getPendingChanges(projectId, snapshot);
  const published = await prisma.deployment.findFirst({
    where: { projectId, status: 'READY' },
    orderBy: { version: 'desc' },
    select: { snapshot: true },
  });
  const settings = changedSiteSettings(snapshot.project, (published?.snapshot as unknown as SiteSnapshot | null)?.project);
  return { pending, settings, digest: publishStateDigest(snapshot, pending.lastVersion, newestVersion), snapshot };
};

/** Where readers see the site, resolved like the dashboard overview: a live
 *  custom domain (DNS and HTTPS working, primary first), else the free
 *  subdomain, else /sites/:id. */
export const publishedSiteUrl = async (projectId: string, projectSlug: string) => {
  const domain = await findLiveDomain(projectId);
  if (domain) return `https://${domain}`;
  const baseDomain = normalizeBaseDomain(env.SITE_BASE_DOMAIN);
  return baseDomain ? `https://${projectSlug}.${baseDomain}` : `${env.APP_URL.replace(/\/+$/, '')}/sites/${projectId}`;
};

/** Whether a publish would change anything. `changes` lists pages only, so a
 *  change that is only to navigation groups shows up as `upToDate: false`
 *  with no listed page. */
export const hasPublishableChanges = (pending: PendingChanges, settings: string[]): boolean =>
  pending.changes.length > 0 || settings.length > 0 || (pending.hasBaseline && !pending.upToDate);

/** The human-facing summary `preview_publish` returns (no diff lines or content). */
export const publishPreviewSummary = (pending: PendingChanges, settings: string[]) => {
  const count = (status: 'added' | 'modified' | 'removed') => pending.changes.filter((change) => change.status === status).length;
  return {
    counts: { total: pending.changes.length, added: count('added'), modified: count('modified'), removed: count('removed') },
    changes: pending.changes.slice(0, MAX_PREVIEW_CHANGES).map((change) => ({
      pageId: change.id,
      title: change.title,
      path: change.path,
      languageCode: change.languageCode,
      kind: change.kind,
      status: change.status,
      changedFields: change.fields,
      additions: change.additions,
      deletions: change.deletions,
    })),
    changesTruncated: pending.changes.length > MAX_PREVIEW_CHANGES,
    settings: { changed: settings.length > 0, changedFields: settings },
    redirectIssues: {
      count: pending.redirectIssues.length,
      blocking: pending.redirectIssues.length > 0,
      summary: pending.redirectIssues.length > 0 ? summarizeRedirectIssues(pending.redirectIssues) : null,
    },
    lastPublished: { version: pending.lastVersion, at: pending.lastPublishedAt },
  };
};
