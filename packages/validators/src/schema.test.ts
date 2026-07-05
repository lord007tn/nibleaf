import { describe, expect, it } from 'vitest';
import {
  addDomainBody,
  adminSetRoleBody,
  createLanguageBody,
  gitConfigSchema,
  paginationQuery,
  presignAssetBody,
  projectConfigSchema,
  transferOwnershipBody,
  updateProjectBody,
  waitlistSubmitBody,
} from './index';

describe('projectConfigSchema', () => {
  it('accepts a valid single-section patch', () => {
    expect(projectConfigSchema.safeParse({ styling: { primaryColor: '#5546e8', theme: 'dark' } }).success).toBe(true);
  });
  it('rejects unknown top-level keys (strict guards against prototype pollution)', () => {
    expect(projectConfigSchema.safeParse({ bogus: true }).success).toBe(false);
  });
  it('rejects unknown nested keys', () => {
    expect(projectConfigSchema.safeParse({ branding: { nope: 'x' } }).success).toBe(false);
  });
  it('bounds navbar links to 20', () => {
    const links = Array.from({ length: 21 }, (_, i) => ({ label: `L${i}`, href: '/x' }));
    expect(projectConfigSchema.safeParse({ navbar: { links } }).success).toBe(false);
  });
  it('validates hex colors (#abc and #5546e8 ok, #xyz rejected)', () => {
    expect(projectConfigSchema.safeParse({ styling: { primaryColor: '#abc' } }).success).toBe(true);
    expect(projectConfigSchema.safeParse({ styling: { primaryColor: '#xyz' } }).success).toBe(false);
  });
  it('accepts bounded add-on toggles and rejects unknown add-ons', () => {
    expect(
      projectConfigSchema.safeParse({
        addons: {
          feedback: true,
          editSuggestions: true,
          issueLinks: true,
          ciChecks: true,
          brokenLinks: true,
          grammarLinter: false,
          previewDeployments: true,
          editUrl: 'https://github.com/acme/docs/edit/main/{path}.mdx',
          issueUrl: 'https://github.com/acme/docs/issues/new?title=Docs%20feedback&body={url}',
        },
      }).success,
    ).toBe(true);
    expect(projectConfigSchema.safeParse({ addons: { advancedAiSearch: true } }).success).toBe(false);
  });
});

describe('createLanguageBody', () => {
  it('accepts BCP-47 codes', () => {
    expect(createLanguageBody.safeParse({ code: 'en', label: 'English' }).success).toBe(true);
    expect(createLanguageBody.safeParse({ code: 'pt-BR', label: 'Português' }).success).toBe(true);
  });
  it('rejects malformed codes', () => {
    expect(createLanguageBody.safeParse({ code: 'EN', label: 'x' }).success).toBe(false);
    expect(createLanguageBody.safeParse({ code: 'english', label: 'x' }).success).toBe(false);
  });
});

describe('updateProjectBody', () => {
  it('accepts a DNS-safe deployment slug', () => {
    expect(updateProjectBody.safeParse({ slug: 'docs-v2' }).success).toBe(true);
  });

  it('rejects deployment slugs that cannot be used as subdomains', () => {
    expect(updateProjectBody.safeParse({ slug: 'Docs' }).success).toBe(false);
    expect(updateProjectBody.safeParse({ slug: '-docs' }).success).toBe(false);
    expect(updateProjectBody.safeParse({ slug: 'docs.example' }).success).toBe(false);
  });
});

describe('addDomainBody', () => {
  it('accepts a hostname', () => {
    expect(addDomainBody.safeParse({ domain: 'docs.example.com' }).success).toBe(true);
  });

  it('normalizes hostnames before validation', () => {
    const parsed = addDomainBody.safeParse({ domain: ' Docs.Example.COM. ' });
    expect(parsed.success && parsed.data.domain).toBe('docs.example.com');
  });

  it('rejects non-domains', () => {
    expect(addDomainBody.safeParse({ domain: 'localhost' }).success).toBe(false);
    expect(addDomainBody.safeParse({ domain: '-bad.com' }).success).toBe(false);
    expect(addDomainBody.safeParse({ domain: 'bad-.example.com' }).success).toBe(false);
    expect(addDomainBody.safeParse({ domain: '*.example.com' }).success).toBe(false);
  });
});

describe('transferOwnershipBody', () => {
  it('requires a target member id', () => {
    expect(transferOwnershipBody.safeParse({ memberId: 'member_123' }).success).toBe(true);
    expect(transferOwnershipBody.safeParse({ memberId: '' }).success).toBe(false);
  });
});

describe('presignAssetBody', () => {
  it('enforces a positive size under the 50MB cap', () => {
    expect(presignAssetBody.safeParse({ filename: 'a.png', contentType: 'image/png', size: 1024 }).success).toBe(true);
    expect(presignAssetBody.safeParse({ filename: 'a.png', contentType: 'image/png', size: 0 }).success).toBe(false);
    expect(presignAssetBody.safeParse({ filename: 'a.png', contentType: 'image/png', size: 51 * 1024 * 1024 }).success).toBe(false);
  });
});

describe('gitConfigSchema', () => {
  it('accepts public GitHub and GitLab repository settings', () => {
    expect(
      gitConfigSchema.safeParse({
        provider: 'github',
        repo: 'acme/docs',
        branch: 'main',
        path: 'docs',
        importBranchId: 'branch_123',
        importLanguageId: 'lang_123',
      }).success,
    ).toBe(true);
    expect(
      gitConfigSchema.safeParse({
        provider: 'gitlab',
        repo: 'platform/docs/site',
        instanceUrl: 'https://gitlab.com',
        branch: 'main',
        path: 'docs',
      }).success,
    ).toBe(true);
    expect(
      gitConfigSchema.safeParse({
        provider: 'git',
        cloneUrl: 'https://git.example.com/acme/docs.git',
        branch: 'main',
        path: 'docs',
      }).success,
    ).toBe(true);
  });

  it('rejects repository paths without an owner or group', () => {
    expect(gitConfigSchema.safeParse({ provider: 'gitlab', repo: 'docs' }).success).toBe(false);
  });
});

describe('paginationQuery', () => {
  it('coerces numeric strings and bounds the limit to 1..200', () => {
    const ok = paginationQuery.safeParse({ limit: '50' });
    expect(ok.success && ok.data.limit).toBe(50);
    expect(paginationQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(paginationQuery.safeParse({ limit: '201' }).success).toBe(false);
  });
});

describe('waitlistSubmitBody', () => {
  it('normalizes the email (trim + lowercase) so upserts are idempotent', () => {
    const parsed = waitlistSubmitBody.safeParse({ email: '  Founder@Example.COM ' });
    expect(parsed.success && parsed.data.email).toBe('founder@example.com');
  });

  it('accepts optional source/locale and rejects unknown keys (strict)', () => {
    expect(waitlistSubmitBody.safeParse({ email: 'a@b.com', source: 'cloud-page', locale: 'ar' }).success).toBe(true);
    expect(waitlistSubmitBody.safeParse({ email: 'a@b.com', spam: true }).success).toBe(false);
  });

  it('rejects invalid emails and over-long fields', () => {
    expect(waitlistSubmitBody.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(waitlistSubmitBody.safeParse({ email: `${'x'.repeat(250)}@b.com` }).success).toBe(false);
    expect(waitlistSubmitBody.safeParse({ email: 'a@b.com', source: 'x'.repeat(65) }).success).toBe(false);
    expect(waitlistSubmitBody.safeParse({ email: 'a@b.com', locale: 'x'.repeat(9) }).success).toBe(false);
  });
});

describe('adminSetRoleBody', () => {
  it('accepts the two platform roles only', () => {
    expect(adminSetRoleBody.safeParse({ role: 'user' }).success).toBe(true);
    expect(adminSetRoleBody.safeParse({ role: 'admin' }).success).toBe(true);
  });

  it('rejects arbitrary roles and unknown keys (no privilege injection)', () => {
    expect(adminSetRoleBody.safeParse({ role: 'superadmin' }).success).toBe(false);
    expect(adminSetRoleBody.safeParse({ role: 'owner' }).success).toBe(false);
    expect(adminSetRoleBody.safeParse({ role: 'admin', extra: 1 }).success).toBe(false);
  });
});
