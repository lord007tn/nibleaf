import { describe, expect, it } from 'vitest';
import {
  addDomainBody,
  adminSetRoleBody,
  confirmAssetBody,
  createExportBody,
  createExportScheduleBody,
  createLanguageBody,
  createPageBody,
  createProjectBody,
  gitConfigSchema,
  inferSafeInlineAssetContentType,
  inviteMemberBody,
  inviteReaderBody,
  jwtAccessConfigBody,
  languageConfigSchema,
  pageConfigSchema,
  paginationQuery,
  presignAssetBody,
  projectConfigSchema,
  resolveRedirectTarget,
  transferOwnershipBody,
  updateLanguageBody,
  updateMemberRoleBody,
  updatePageBody,
  updateProjectBody,
  upsertOpenApiBody,
} from './index';

describe('page translation keys', () => {
  it('allows absence or null and rejects blank values for creates and updates', () => {
    expect(createPageBody.safeParse({ title: 'Intro' }).success).toBe(true);
    expect(createPageBody.safeParse({ title: 'Intro', translationKey: null }).success).toBe(true);
    expect(createPageBody.safeParse({ title: 'Intro', translationKey: '   ' }).success).toBe(false);
    expect(createPageBody.parse({ title: 'Intro', translationKey: '  intro  ' }).translationKey).toBe('intro');
    expect(updatePageBody.safeParse({ translationKey: '   ' }).success).toBe(false);
  });
});

describe('project languages', () => {
  it('accepts and canonicalizes complete BCP-47 tags', () => {
    expect(createLanguageBody.parse({ code: 'zh-hans-cn', label: '简体中文' }).code).toBe('zh-Hans-CN');
    expect(createLanguageBody.parse({ code: 'pt-br', label: 'Português' }).code).toBe('pt-BR');
  });

  it('rejects malformed language tags', () => {
    expect(createLanguageBody.safeParse({ code: 'not_a_locale', label: 'Invalid' }).success).toBe(false);
  });
});

describe('upsertOpenApiBody', () => {
  const spec = '{"openapi":"3.1.0","info":{"title":"Pets","version":"1"},"paths":{}}';

  it('accepts upload, public URL, and repository sources', () => {
    expect(upsertOpenApiBody.safeParse({ title: 'API Reference', path: 'api-reference', source: { type: 'upload', content: spec } }).success).toBe(
      true,
    );
    expect(
      upsertOpenApiBody.safeParse({ title: 'API Reference', path: 'reference', source: { type: 'url', url: 'https://api.example.com/openapi.yaml' } })
        .success,
    ).toBe(true);
    expect(
      upsertOpenApiBody.safeParse({ title: 'API Reference', path: 'api-reference', source: { type: 'repository', path: 'docs/openapi.yaml' } })
        .success,
    ).toBe(true);
  });

  it('accepts a metadata-only edit for an existing document', () => {
    expect(upsertOpenApiBody.safeParse({ title: 'Renamed API', path: 'reference' }).success).toBe(true);
  });

  it('rejects credential-bearing URLs and unsafe or nested published paths', () => {
    expect(
      upsertOpenApiBody.safeParse({ title: 'API', path: 'api/reference', source: { type: 'url', url: 'https://token@example.com/openapi.json' } })
        .success,
    ).toBe(false);
    expect(
      upsertOpenApiBody.safeParse({ title: 'API', path: 'api-reference', source: { type: 'repository', path: '../openapi.yaml' } }).success,
    ).toBe(false);
  });
});

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

  it('rejects duplicate redirect sources, self redirects, and cycles', () => {
    expect(projectConfigSchema.safeParse({ redirects: [{ from: '/old', to: '/old' }] }).success).toBe(false);
    expect(
      projectConfigSchema.safeParse({
        redirects: [
          { from: '/old', to: '/new' },
          { from: 'old/', to: '/newer' },
        ],
      }).success,
    ).toBe(false);
    expect(
      projectConfigSchema.safeParse({
        redirects: [
          { from: '/a', to: '/b' },
          { from: '/b', to: '/a' },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects half-filled redirect rows but permits an untouched empty row', () => {
    expect(projectConfigSchema.safeParse({ redirects: [{ from: '/old', to: ' ' }] }).success).toBe(false);
    expect(projectConfigSchema.safeParse({ redirects: [{ from: ' ', to: '/new' }] }).success).toBe(false);
    expect(projectConfigSchema.safeParse({ redirects: [{ from: ' ', to: ' ' }] }).success).toBe(true);
  });

  it('accepts redirect chains and resolves them to one final hop', () => {
    const redirects = [
      { from: '/old', to: '/renamed' },
      { from: '/renamed', to: '/current' },
    ];
    expect(projectConfigSchema.safeParse({ redirects }).success).toBe(true);
    expect(resolveRedirectTarget(redirects, '/old')).toBe('/current');
    expect(resolveRedirectTarget([...redirects, { from: '/current', to: 'https://example.com/docs' }], '/old')).toBe('https://example.com/docs');
    expect(resolveRedirectTarget([{ from: '/', to: '/start' }], '/')).toBe('/start');
    expect(resolveRedirectTarget(redirects, '/missing')).toBeNull();
  });
});

describe('pageConfigSchema', () => {
  it('accepts a bounded imported taxonomy and rejects oversized tag sets', () => {
    expect(pageConfigSchema.safeParse({ tag: 'Guide', tags: ['Guide', 'First steps'] }).success).toBe(true);
    expect(pageConfigSchema.safeParse({ tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`) }).success).toBe(false);
  });
});

describe('project bodies', () => {
  it('rejects retired top-level appearance fields', () => {
    expect(createProjectBody.safeParse({ name: 'Docs', color: '#5546e8' }).success).toBe(false);
    expect(updateProjectBody.safeParse({ logoUrl: 'https://example.com/logo.svg' }).success).toBe(false);
    expect(updateProjectBody.safeParse({ faviconUrl: 'https://example.com/favicon.ico' }).success).toBe(false);
    expect(updateProjectBody.safeParse({ theme: { primaryColor: '#5546e8' } }).success).toBe(false);
  });
});

describe('createLanguageBody', () => {
  it('accepts BCP-47 codes', () => {
    expect(createLanguageBody.safeParse({ code: 'en', label: 'English' }).success).toBe(true);
    expect(createLanguageBody.safeParse({ code: 'pt-BR', label: 'Português' }).success).toBe(true);
  });
  it('rejects malformed codes', () => {
    expect(createLanguageBody.safeParse({ code: 'en--US', label: 'x' }).success).toBe(false);
    expect(createLanguageBody.safeParse({ code: 'not_a_tag', label: 'x' }).success).toBe(false);
  });
  it('accepts the enabled serving toggle', () => {
    expect(createLanguageBody.safeParse({ code: 'ar', label: 'العربية', enabled: false }).success).toBe(true);
    expect(updateLanguageBody.safeParse({ enabled: true }).success).toBe(true);
  });
});

describe('languageConfigSchema (per-language chrome overrides)', () => {
  it('accepts localized chrome sections mirroring the project config shapes', () => {
    expect(
      languageConfigSchema.safeParse({
        navbar: {
          ctaLabel: 'احجز عرضًا',
          links: [{ label: 'المستندات', href: '/ar/docs' }],
          tabs: [],
          anchors: [{ label: 'المجتمع', href: '/x', icon: 'users' }],
        },
        footer: { copyright: '© أكمي ٢٠٢٦' },
        banner: { enabled: true, message: 'الإصدار الثالث هنا', linkLabel: 'اقرأ المزيد', linkUrl: '/changelog', dismissible: true },
        search: { placeholder: 'ابحث في المستندات…' },
      }).success,
    ).toBe(true);
  });
  it('lets a PATCH clear a single chrome override with null', () => {
    expect(languageConfigSchema.safeParse({ navbar: null, footer: null, banner: null, search: null }).success).toBe(true);
  });
  it('stays strict: unknown keys and non-text project fields are rejected', () => {
    expect(languageConfigSchema.safeParse({ bogus: true }).success).toBe(false);
    expect(languageConfigSchema.safeParse({ name: 'Stored in ProjectTranslation' }).success).toBe(false);
    // CTA URL, search/changelog toggles and footer socials stay global.
    expect(languageConfigSchema.safeParse({ navbar: { ctaUrl: 'https://x.dev' } }).success).toBe(false);
    expect(languageConfigSchema.safeParse({ navbar: { showSearch: true } }).success).toBe(false);
    expect(languageConfigSchema.safeParse({ footer: { github: 'https://github.com/acme' } }).success).toBe(false);
    expect(languageConfigSchema.safeParse({ search: { hotkey: 'cmdk' } }).success).toBe(false);
  });
  it('keeps the same array caps as the project navbar', () => {
    const links = Array.from({ length: 21 }, (_, i) => ({ label: `L${i}`, href: '/x' }));
    expect(languageConfigSchema.safeParse({ navbar: { links } }).success).toBe(false);
  });
  it('rejects dangerous URL schemes in localized links', () => {
    expect(languageConfigSchema.safeParse({ banner: { linkUrl: 'javascript:alert(1)' } }).success).toBe(false);
  });
});

describe('project translation input', () => {
  it('accepts localized project identity through the language update body', () => {
    expect(updateLanguageBody.safeParse({ translation: { name: 'وثائق أكمي', description: 'دليل المنتج' } }).success).toBe(true);
    expect(updateLanguageBody.safeParse({ translation: null }).success).toBe(true);
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

describe('member role grants exclude owner at the schema level', () => {
  it('inviteMemberBody accepts admin/member but never owner', () => {
    expect(inviteMemberBody.safeParse({ email: 'a@b.co', role: 'admin' }).success).toBe(true);
    expect(inviteMemberBody.safeParse({ email: 'a@b.co', role: 'member' }).success).toBe(true);
    expect(inviteMemberBody.safeParse({ email: 'a@b.co', role: 'owner' }).success).toBe(false);
  });
  it('updateMemberRoleBody accepts admin/member but never owner', () => {
    expect(updateMemberRoleBody.safeParse({ role: 'admin' }).success).toBe(true);
    expect(updateMemberRoleBody.safeParse({ role: 'member' }).success).toBe(true);
    expect(updateMemberRoleBody.safeParse({ role: 'owner' }).success).toBe(false);
  });
});

describe('presignAssetBody', () => {
  it('enforces a positive size under the 50MB cap', () => {
    expect(presignAssetBody.safeParse({ filename: 'a.png', contentType: 'image/png', size: 1024 }).success).toBe(true);
    expect(presignAssetBody.safeParse({ filename: 'a.png', contentType: 'image/png', size: 0 }).success).toBe(false);
    expect(presignAssetBody.safeParse({ filename: 'a.png', contentType: 'image/png', size: 51 * 1024 * 1024 }).success).toBe(false);
  });

  it('accepts only inert raster image types and normalizes parameters', () => {
    const png = presignAssetBody.safeParse({ filename: 'a.png', contentType: 'IMAGE/PNG; charset=binary', size: 1024 });
    expect(png.success && png.data.contentType).toBe('image/png');
    expect(presignAssetBody.safeParse({ filename: 'payload.html', contentType: 'text/html', size: 1024 }).success).toBe(false);
    expect(presignAssetBody.safeParse({ filename: 'payload.svg', contentType: 'image/svg+xml', size: 1024 }).success).toBe(false);
    expect(confirmAssetBody.safeParse({ key: 'projects/a/assets/file', contentType: 'application/xhtml+xml', size: 1024 }).success).toBe(false);
    expect(inferSafeInlineAssetContentType('fallback.JPEG')).toBe('image/jpeg');
    expect(inferSafeInlineAssetContentType('payload.svg')).toBeUndefined();
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

  it('keeps imported content paths inside the repository', () => {
    expect(gitConfigSchema.safeParse({ provider: 'git', cloneUrl: 'https://git.example.com/acme/docs.git', path: 'docs/guides' }).success).toBe(true);
    for (const path of ['../../etc', 'docs/../private', '/etc', 'C:\\Windows']) {
      expect(gitConfigSchema.safeParse({ provider: 'git', cloneUrl: 'https://git.example.com/acme/docs.git', path }).success).toBe(false);
    }
  });

  it('rejects non-http repository and GitLab instance URLs', () => {
    expect(gitConfigSchema.safeParse({ provider: 'git', cloneUrl: 'file:///etc/passwd' }).success).toBe(false);
    expect(gitConfigSchema.safeParse({ provider: 'gitlab', repo: 'acme/docs', instanceUrl: 'file:///srv/gitlab' }).success).toBe(false);
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

describe('private reader validation', () => {
  it('requires a normalized email and at least one audience for invitations', () => {
    const parsed = inviteReaderBody.safeParse({ email: '  READER@Example.com ', audienceIds: ['audience'] });
    expect(parsed.success && parsed.data.email).toBe('reader@example.com');
    expect(inviteReaderBody.safeParse({ email: 'reader@example.com', audienceIds: [] }).success).toBe(false);
  });

  it('accepts exactly one asymmetric public-key source', () => {
    const base = {
      enabled: true,
      issuer: 'https://portal.example.com',
      audience: 'docs',
      claimMapping: { customers: 'audience' },
    };
    expect(jwtAccessConfigBody.safeParse({ ...base, jwksUrl: 'https://portal.example.com/.well-known/jwks.json' }).success).toBe(true);
    expect(jwtAccessConfigBody.safeParse({ ...base, publicJwks: { keys: [{ kty: 'RSA', kid: 'one', n: 'abc', e: 'AQAB' }] } }).success).toBe(true);
    expect(jwtAccessConfigBody.safeParse({ ...base }).success).toBe(false);
    expect(jwtAccessConfigBody.safeParse({ ...base, jwksUrl: 'http://portal.example.com/jwks', publicJwks: null }).success).toBe(false);
  });

  it('rejects private or symmetric key material so secrets cannot be persisted', () => {
    const base = { enabled: true, issuer: 'https://portal.example.com', audience: 'docs', claimMapping: { customers: 'audience' } };
    expect(
      jwtAccessConfigBody.safeParse({ ...base, publicJwks: { keys: [{ kty: 'RSA', kid: 'leak', n: 'abc', e: 'AQAB', d: 'private' }] } }).success,
    ).toBe(false);
    expect(jwtAccessConfigBody.safeParse({ ...base, publicJwks: { keys: [{ kty: 'AKP', kid: 'leak', pub: 'abc', priv: 'private' }] } }).success).toBe(
      false,
    );
    expect(jwtAccessConfigBody.safeParse({ ...base, publicJwks: { keys: [{ kty: 'oct', kid: 'shared', k: 'secret' }] } }).success).toBe(false);
  });
});

describe('export schemas', () => {
  it('deduplicates formats and rejects unsupported formats', () => {
    const parsed = createExportBody.parse({ formats: ['PDF', 'PDF', 'STATIC_HTML'] });
    expect(parsed.formats).toEqual(['PDF', 'STATIC_HTML']);
    expect(createExportBody.safeParse({ formats: ['DOCX'] }).success).toBe(false);
    expect(createExportBody.safeParse({ formats: [] }).success).toBe(false);
  });

  it('validates cadence-specific fields and IANA timezones', () => {
    const base = { name: 'Nightly', formats: ['MARKDOWN'], cadence: 'DAILY', timezone: 'Africa/Lagos', hour: 2, minute: 30 };
    expect(createExportScheduleBody.safeParse(base).success).toBe(true);
    expect(createExportScheduleBody.safeParse({ ...base, timezone: 'UTC+1' }).success).toBe(false);
    expect(createExportScheduleBody.safeParse({ ...base, cadence: 'WEEKLY' }).success).toBe(false);
    expect(createExportScheduleBody.safeParse({ ...base, cadence: 'WEEKLY', weekday: 1 }).success).toBe(true);
    expect(createExportScheduleBody.safeParse({ ...base, cadence: 'MONTHLY', monthday: 31 }).success).toBe(true);
  });

  it('bounds retention and wall-clock values', () => {
    const base = { name: 'Archive', formats: ['PDF'], cadence: 'DAILY', timezone: 'UTC', hour: 0, minute: 0 };
    expect(createExportScheduleBody.safeParse({ ...base, retentionCount: 0 }).success).toBe(false);
    expect(createExportScheduleBody.safeParse({ ...base, retentionDays: 3651 }).success).toBe(false);
    expect(createExportScheduleBody.safeParse({ ...base, hour: 24 }).success).toBe(false);
  });
});
