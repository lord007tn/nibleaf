import { describe, expect, it } from 'vitest';
import { addDomainBody, createLanguageBody, gitConfigSchema, paginationQuery, presignAssetBody, projectConfigSchema } from './index';

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

describe('addDomainBody', () => {
  it('accepts a hostname', () => {
    expect(addDomainBody.safeParse({ domain: 'docs.example.com' }).success).toBe(true);
  });
  it('rejects non-domains', () => {
    expect(addDomainBody.safeParse({ domain: 'localhost' }).success).toBe(false);
    expect(addDomainBody.safeParse({ domain: '-bad.com' }).success).toBe(false);
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
    expect(gitConfigSchema.safeParse({ provider: 'github', repo: 'acme/docs', branch: 'main', path: 'docs' }).success).toBe(true);
    expect(
      gitConfigSchema.safeParse({
        provider: 'gitlab',
        repo: 'platform/docs/site',
        instanceUrl: 'https://gitlab.com',
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
