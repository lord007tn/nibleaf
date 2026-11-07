import type { SiteSnapshot } from '@nibleaf/shared/site';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
    APP_URL: 'https://app.nibleaf.test/',
    SITE_BASE_DOMAIN: undefined as string | undefined,
  },
  findDomains: vi.fn(),
}));

vi.mock('@/env', () => ({ env: mocks.env }));
vi.mock('@nibleaf/database', () => ({ prisma: { domain: { findMany: mocks.findDomains } } }));
vi.mock('@/actions/deployments', () => ({}));

import {
  changedSiteSettings,
  createPublishPreviewToken,
  PREVIEW_TOKEN_TTL_MS,
  publishedSiteUrl,
  publishStateDigest,
  readPublishPreviewToken,
} from './publish';

const pageEntry = (id: string, content: string, updatedAt = '2026-11-02T00:00:00.000Z') => ({
  id,
  parentId: null,
  versionId: 'version-1',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt,
  languageCode: 'en',
  kind: 'PAGE' as const,
  title: id,
  slug: id,
  path: id,
  icon: null,
  description: null,
  content,
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
});

const snapshot = (pages: SiteSnapshot['pages']): SiteSnapshot => ({
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: { theme: 'harbor' },
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, config: null }],
    versions: [{ id: 'version-1', name: 'main', slug: 'main', isDefault: true }],
  },
  pages,
  openapi: null,
  generatedAt: '2026-11-06T00:00:00.000Z',
});

describe('MCP publish preview token', () => {
  it('round-trips the digest for the same key and project until it expires', () => {
    const now = Date.UTC(2026, 10, 6);
    const { token, expiresAt } = createPublishPreviewToken('user-1', 'project-1', 'digest-1', now);
    expect(expiresAt).toBe(now + PREVIEW_TOKEN_TTL_MS);
    expect(readPublishPreviewToken(token, 'user-1', 'project-1', now + PREVIEW_TOKEN_TTL_MS - 1)).toBe('digest-1');
    expect(() => readPublishPreviewToken(token, 'user-1', 'project-1', now + PREVIEW_TOKEN_TTL_MS)).toThrow(
      expect.objectContaining({ code: 'mcp:preview_expired' }),
    );
  });

  it('rejects tokens for another person or project, tampered payloads, and garbage as invalid', () => {
    const now = Date.UTC(2026, 10, 6);
    const { token } = createPublishPreviewToken('user-1', 'project-1', 'digest-1', now);
    const [version, payload, signature] = token.split('.');
    const swapped = Buffer.from(JSON.stringify(['user-1', 'project-1', 'digest-2', now + PREVIEW_TOKEN_TTL_MS])).toString('base64url');
    for (const [candidate, actorId, projectId] of [
      [token, 'user-2', 'project-1'],
      [token, 'user-1', 'project-2'],
      [`${version}.${swapped}.${signature}`, 'user-1', 'project-1'],
      [`v2.${payload}.${signature}`, 'user-1', 'project-1'],
      [`${token}.extra`, 'user-1', 'project-1'],
      ['', 'user-1', 'project-1'],
    ] as const) {
      expect(() => readPublishPreviewToken(candidate, actorId, projectId, now)).toThrow(expect.objectContaining({ code: 'mcp:preview_invalid' }));
    }
    // Another spelling of the same signature bytes is a different single-use key, so it is refused.
    const padded = Buffer.from(signature ?? '', 'base64url').toString('base64');
    expect(padded).not.toBe(signature);
    expect(() => readPublishPreviewToken(`${version}.${payload}.${padded}`, 'user-1', 'project-1', now)).toThrow(
      expect.objectContaining({ code: 'mcp:preview_invalid' }),
    );
    // An expired forgery is still reported as invalid, never as merely expired.
    expect(() => readPublishPreviewToken(`${version}.${swapped}.${signature}`, 'user-1', 'project-1', now + 2 * PREVIEW_TOKEN_TTL_MS)).toThrow(
      expect.objectContaining({ code: 'mcp:preview_invalid' }),
    );
  });
});

describe('MCP pending site settings', () => {
  const project = snapshot([]).project;
  it('names changed project fields and config sections, never their values', () => {
    const changed = changedSiteSettings(
      { ...project, name: 'Docs v2', config: { theme: 'nightfall', navigation: { links: [] } } },
      { ...project, config: { theme: 'harbor', footer: 'x' } },
    );
    expect(changed).toEqual(['name', 'config.footer', 'config.navigation', 'config.theme']);
    expect(JSON.stringify(changed)).not.toContain('nightfall');
  });
  it('is empty when nothing changed or nothing was published yet', () => {
    expect(changedSiteSettings(project, structuredClone(project))).toEqual([]);
    expect(changedSiteSettings(project, null)).toEqual([]);
  });
});

describe('MCP publish state digest', () => {
  const base = publishStateDigest(snapshot([pageEntry('a', 'A'), pageEntry('b', 'B')]), 3, 4);

  it('ignores page order, timestamps, and the snapshot generation time', () => {
    const reordered = snapshot([pageEntry('b', 'B', '2026-11-05T00:00:00.000Z'), pageEntry('a', 'A')]);
    expect(publishStateDigest({ ...reordered, generatedAt: '2030-01-01T00:00:00.000Z' }, 3, 4)).toBe(base);
  });

  it('changes with content, settings, the baseline, or any newer deployment', () => {
    expect(publishStateDigest(snapshot([pageEntry('a', 'A!'), pageEntry('b', 'B')]), 3, 4)).not.toBe(base);
    const settings = snapshot([pageEntry('a', 'A'), pageEntry('b', 'B')]);
    settings.project.config = { theme: 'atlas' };
    expect(publishStateDigest(settings, 3, 4)).not.toBe(base);
    expect(publishStateDigest(snapshot([pageEntry('a', 'A'), pageEntry('b', 'B')]), 4, 4)).not.toBe(base);
    expect(publishStateDigest(snapshot([pageEntry('a', 'A'), pageEntry('b', 'B')]), 3, 5)).not.toBe(base);
    expect(publishStateDigest(snapshot([pageEntry('a', 'A')]), 3, 4)).not.toBe(base);
  });
});

describe('publishedSiteUrl', () => {
  const domain = (name: string, patch: Record<string, unknown> = {}) => ({
    domain: name,
    verified: true,
    isPrimary: false,
    dnsStatus: 'VERIFIED',
    sslStatus: 'ACTIVE',
    ...patch,
  });

  it('links the live primary domain first', async () => {
    mocks.findDomains.mockResolvedValue([domain('old.example.com'), domain('docs.example.com', { isPrimary: true })]);
    await expect(publishedSiteUrl('site-1', 'acme')).resolves.toBe('https://docs.example.com');
    // Creation order, so "oldest live domain" is the fallback when no primary is live.
    expect(mocks.findDomains).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'site-1', verified: true }, orderBy: { createdAt: 'asc' } }),
    );
  });

  it('never links a domain whose ownership is verified but whose DNS or HTTPS does not work yet', async () => {
    mocks.findDomains.mockResolvedValue([
      domain('broken.example.com', { isPrimary: true, dnsStatus: 'ERROR' }),
      domain('securing.example.com', { sslStatus: 'PROVISIONING' }),
      domain('working.example.com'),
    ]);
    await expect(publishedSiteUrl('site-1', 'acme')).resolves.toBe('https://working.example.com');
  });

  it('falls back to the free subdomain, then to /sites/:id, when no domain is live', async () => {
    mocks.findDomains.mockResolvedValue([domain('securing.example.com', { isPrimary: true, sslStatus: 'PROVISIONING' })]);
    mocks.env.SITE_BASE_DOMAIN = '*.docs.nibleaf.test.';
    await expect(publishedSiteUrl('site-1', 'acme')).resolves.toBe('https://acme.docs.nibleaf.test');
    mocks.env.SITE_BASE_DOMAIN = undefined;
    await expect(publishedSiteUrl('site-1', 'acme')).resolves.toBe('https://app.nibleaf.test/sites/site-1');
  });
});
