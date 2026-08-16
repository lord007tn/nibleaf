import { MAX_REDIRECT_RULES, validateRedirectGraph } from '@nibleaf/shared/redirects';
import { z } from 'zod';

import { isSafeInlineAssetContentType, normalizeAssetContentType } from './assets';

export {
  MAX_REDIRECT_CHAIN_LENGTH,
  MAX_REDIRECT_RULES,
  normalizeRedirectPath,
  type RedirectPair,
  type RedirectValidationIssue,
  resolveRedirectTarget,
  validateRedirectGraph,
} from '@nibleaf/shared/redirects';
export {
  inferSafeInlineAssetContentType,
  isSafeInlineAssetContentType,
  normalizeAssetContentType,
  SAFE_INLINE_ASSET_CONTENT_TYPES,
  safeInlineAssetContentType,
} from './assets';

// ─── Common ─────────────────────────────────────────────────────────────────

export const idParam = z.object({ id: z.string().min(1) });
export const projectIdParam = z.object({ projectId: z.string().min(1) });

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex color like #5546e8');

// Reject dangerous URL schemes so config URLs that render as clickable links
// (navbar/footer/banner/CTA) can't carry a javascript:/data:/vbscript: payload.
// A blocklist (not an allowlist) keeps http(s)/relative/mailto/tel values valid
// and existing configs from failing validation on their next save.
const url = z
  .string()
  .max(500)
  .refine((v) => !/^\s*(?:javascript|data|vbscript):/i.test(v), { message: 'Unsupported URL scheme.' });
const navLink = z.object({ label: z.string().max(80), href: url, external: z.boolean().optional() }).strict();
const navAnchor = z.object({ label: z.string().max(80), href: url, icon: z.string().max(40).optional(), external: z.boolean().optional() }).strict();

const redirectsSchema = z
  .array(z.object({ from: z.string().max(300), to: z.string().max(300) }).strict())
  .max(MAX_REDIRECT_RULES)
  .superRefine((redirects, ctx) => {
    for (const graphIssue of validateRedirectGraph(redirects).issues) {
      const index = graphIssue.rowIndexes[0] ?? 0;
      ctx.addIssue({ code: 'custom', message: graphIssue.message, path: [index, graphIssue.field ?? 'to'] });
    }
  });
const kvPair = z.object({ key: z.string().max(80), value: z.string().max(500) }).strict();

/**
 * Full per-project site configuration. Every section is optional so the client
 * can PATCH one section at a time; the server deep-merges into Project.config.
 * Bounded + strict to keep the JSON blob safe and small.
 */
export const projectConfigSchema = z
  .object({
    visibility: z.enum(['public', 'private']).optional(),
    branding: z
      .object({
        logoLight: url.nullable().optional(),
        logoDark: url.nullable().optional(),
        favicon: url.nullable().optional(),
        logoHref: url.nullable().optional(),
      })
      .strict()
      .optional(),
    styling: z
      .object({
        primaryColor: hexColor.optional(),
        theme: z.enum(['light', 'dark', 'system']).optional(),
        radius: z.enum(['sharp', 'rounded', 'pill']).optional(),
      })
      .strict()
      .optional(),
    typography: z
      .object({
        headingFont: z.string().max(60).optional(),
        bodyFont: z.string().max(60).optional(),
        codeFont: z.string().max(60).optional(),
        baseSize: z.enum(['14', '15', '16', '17', '18']).optional(),
        // Reading rhythm (shadcn typeset): line height and block spacing for
        // rendered doc content. Discrete steps keep every combination readable.
        leading: z.enum(['1.5', '1.6', '1.75', '1.9', '2']).optional(),
        flow: z.enum(['0.75', '1', '1.25', '1.5', '2']).optional(),
      })
      .strict()
      .optional(),
    navbar: z
      .object({
        ctaLabel: z.string().max(60).optional(),
        ctaUrl: url.optional(),
        links: z.array(navLink).max(20).optional(),
        // Top-level tabs (a secondary nav row) and pinned sidebar anchors —
        // Mintlify-style IA primitives for larger docs.
        tabs: z.array(navLink).max(10).optional(),
        anchors: z.array(navAnchor).max(12).optional(),
        showSearch: z.boolean().optional(),
        // Opt-in built-in "Changelog" navbar link (localized label, links to the
        // auto-generated releases page). Off by default — not every product
        // wants a public changelog.
        changelog: z.boolean().optional(),
      })
      .strict()
      .optional(),
    footer: z
      .object({
        copyright: z.string().max(200).optional(),
        github: url.optional(),
        x: url.optional(),
        linkedin: url.optional(),
        // "Made with Nibleaf" badge on published sites — default ON; explicit
        // false hides it (free during beta; may become a paid perk later).
        madeWithBadge: z.boolean().optional(),
      })
      .strict()
      .optional(),
    banner: z
      .object({
        enabled: z.boolean().optional(),
        message: z.string().max(300).optional(),
        linkLabel: z.string().max(80).optional(),
        linkUrl: url.optional(),
        dismissible: z.boolean().optional(),
      })
      .strict()
      .optional(),
    seo: z
      .object({
        metaTitle: z.string().max(160).optional(),
        metaDescription: z.string().max(320).optional(),
        socialImage: url.optional(),
        allowIndex: z.boolean().optional(),
      })
      .strict()
      .optional(),
    search: z
      .object({
        provider: z.enum(['builtin', 'algolia', 'typesense']).optional(),
        placeholder: z.string().max(80).optional(),
        hotkey: z.enum(['cmdk', 'slash']).optional(),
        maxResults: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
    addons: z
      .object({
        feedback: z.boolean().optional(),
        editSuggestions: z.boolean().optional(),
        issueLinks: z.boolean().optional(),
        ciChecks: z.boolean().optional(),
        brokenLinks: z.boolean().optional(),
        grammarLinter: z.boolean().optional(),
        previewDeployments: z.boolean().optional(),
        editUrl: z.string().max(500).optional(),
        issueUrl: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
    analytics: z
      .object({
        ga4: z.string().max(40).optional(),
        plausible: z.string().max(120).optional(),
        cookieConsent: z.boolean().optional(),
      })
      .strict()
      .optional(),
    redirects: redirectsSchema.optional(),
    variables: z.array(kvPair).max(100).optional(),
  })
  .strict();
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

// ─── Per-language config (SEO + behaviour overrides) ─────────────────────────

/** Per-language site chrome + SEO defaults. Project name/description live in
 *  ProjectTranslation; `seo` applies to
 *  every page in the language, overriding the project-level SEO and overridden
 *  in turn by a page's own SEO. The chrome sections (`navbar`/`footer`/`banner`/
 *  `search`) mirror the text-bearing parts of `projectConfigSchema` and override
 *  it per language on the published site: object sections merge one level deep
 *  (a language value wins per key), arrays replace wholesale when the language
 *  defines them. Each chrome section is nullable so a PATCH can clear one
 *  override without touching the language's other config. */
export const languageConfigSchema = z
  .object({
    seo: z
      .object({
        metaTitle: z.string().max(160).optional(),
        metaDescription: z.string().max(320).optional(),
        socialImage: url.optional(),
        allowIndex: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** Localized navbar labels/links (CTA URL, search + changelog toggles stay global). */
    navbar: z
      .object({
        ctaLabel: z.string().max(60).optional(),
        links: z.array(navLink).max(20).optional(),
        tabs: z.array(navLink).max(10).optional(),
        anchors: z.array(navAnchor).max(12).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    /** Localized footer copy (social URLs and the badge stay global). */
    footer: z
      .object({
        copyright: z.string().max(200).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    /** Localized announcement banner. */
    banner: z
      .object({
        enabled: z.boolean().optional(),
        message: z.string().max(300).optional(),
        linkLabel: z.string().max(80).optional(),
        linkUrl: url.optional(),
        dismissible: z.boolean().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    /** Localized search field copy (provider/hotkey/limits stay global). */
    search: z
      .object({
        placeholder: z.string().max(80).optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type LanguageConfig = z.infer<typeof languageConfigSchema>;

export const projectTranslationSchema = z
  .object({
    name: z.string().max(120).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .strict();
export type ProjectTranslationInput = z.infer<typeof projectTranslationSchema>;

// ─── Per-page config (SEO override + behaviour) ──────────────────────────────

export const pageModeEnum = z.enum(['default', 'wide', 'center']);
export type PageMode = z.infer<typeof pageModeEnum>;

/** A single page's overrides: SEO (highest precedence) + layout behaviour. */
export const pageConfigSchema = z
  .object({
    seo: z
      .object({
        metaTitle: z.string().max(160).optional(),
        metaDescription: z.string().max(320).optional(),
        ogImage: url.optional(),
        canonicalUrl: url.optional(),
        noindex: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** Short label shown in the sidebar nav instead of the full title. */
    sidebarTitle: z.string().max(120).optional(),
    /** A short badge shown next to the nav label (Mintlify `tag`, e.g. "New", "Beta"). */
    tag: z.string().max(20).optional(),
    /** Source taxonomy retained by importers and shown on the article. */
    tags: z.array(z.string().min(1).max(40)).max(10).optional(),
    /** Virtual navigation section. Groups sibling pages without changing URLs. */
    category: z.string().max(80).optional(),
    /** Optional icon shown on the virtual category in the published sidebar. */
    categoryIcon: z.string().max(64).optional(),
    /** Stable ordering for virtual categories (lower values appear first). */
    categoryOrder: z.number().int().min(0).max(999).optional(),
    /** Content width on the live site. */
    mode: pageModeEnum.optional(),
    /** Hide the right-hand "On this page" table of contents. */
    hideToc: z.boolean().optional(),
  })
  .strict();
export type PageConfig = z.infer<typeof pageConfigSchema>;

// ─── Project ──────────────────────────────────────────────────────────────—

export const createProjectBody = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    icon: z.string().max(64).optional(),
  })
  .strict();
export type CreateProjectBody = z.infer<typeof createProjectBody>;

export const updateProjectBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    slug: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Use lowercase letters, numbers, and hyphens.')
      .optional(),
    description: z.string().max(500).nullable().optional(),
    icon: z.string().max(64).nullable().optional(),
    config: projectConfigSchema.optional(),
  })
  .strict();
export type UpdateProjectBody = z.infer<typeof updateProjectBody>;

// ─── OpenAPI reference ──────────────────────────────────────────────────────

const repositoryFilePath = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => {
    const slashPath = value.trim().replace(/\\/g, '/');
    const parts = slashPath.split('/').filter(Boolean);
    return !slashPath.startsWith('/') && !/^[A-Za-z]:/.test(slashPath) && parts.every((part) => part !== '.' && part !== '..');
  }, 'OpenAPI file path must stay inside the repository.');

export const openApiSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('upload'), content: z.string().min(1).max(5_000_000) }).strict(),
  z
    .object({
      type: z.literal('url'),
      url: z
        .url()
        .max(1_000)
        .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'OpenAPI URL must use http(s).')
        .refine((value) => {
          const parsed = new URL(value);
          return !(parsed.username || parsed.password);
        }, 'OpenAPI URL must not include embedded credentials.'),
    })
    .strict(),
  z.object({ type: z.literal('repository'), path: repositoryFilePath }).strict(),
]);
export type OpenApiSourceInput = z.infer<typeof openApiSourceSchema>;

/** Replace the draft API reference after the server has fetched and validated
 *  its source. `path` is a single stable site segment so it cannot shadow page
 *  trees or machine endpoints. */
export const upsertOpenApiBody = z
  .object({
    title: z.string().trim().min(1).max(120),
    path: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers, and hyphens.'),
    source: openApiSourceSchema.optional(),
  })
  .strict();
export type UpsertOpenApiBody = z.infer<typeof upsertOpenApiBody>;

// ─── Languages ───────────────────────────────────────────────────────────────

export const textDirectionEnum = z.enum(['LTR', 'RTL']);
export type TextDirection = z.infer<typeof textDirectionEnum>;

export const createLanguageBody = z.object({
  code: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/, 'Use a BCP-47 code like "en" or "pt-BR"'),
  label: z.string().min(1).max(60),
  direction: textDirectionEnum.optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
});
export type CreateLanguageBody = z.infer<typeof createLanguageBody>;

export const updateLanguageBody = z.object({
  label: z.string().min(1).max(60).optional(),
  direction: textDirectionEnum.optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().optional(),
  config: languageConfigSchema.nullable().optional(),
  translation: projectTranslationSchema.nullable().optional(),
});
export type UpdateLanguageBody = z.infer<typeof updateLanguageBody>;

// ─── Page ─────────────────────────────────────────────────────────────────—

export const pageKindEnum = z.enum(['PAGE', 'GROUP']);

export const createPageBody = z.object({
  parentId: z.string().nullable().optional(),
  languageId: z.string().optional(),
  branchId: z.string().optional(),
  kind: pageKindEnum.optional(),
  title: z.string().min(1).max(200),
  slug: z.string().max(200).optional(),
  icon: z.string().max(64).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  content: z.string().optional(),
  config: pageConfigSchema.nullable().optional(),
  position: z.number().int().optional(),
});
export type CreatePageBody = z.infer<typeof createPageBody>;

export const listPagesQuery = z.object({ languageId: z.string().optional(), branchId: z.string().optional() });
export type ListPagesQuery = z.infer<typeof listPagesQuery>;

// ─── Branch ──────────────────────────────────────────────────────────────────

export const createBranchBody = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9._/-]+$/, 'Use letters, numbers, and . _ / -'),
  fromBranchId: z.string().optional(),
});
export type CreateBranchBody = z.infer<typeof createBranchBody>;

export const updatePageBody = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  slug: z.string().max(200).optional(),
  icon: z.string().max(64).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  content: z.string().optional(),
  config: pageConfigSchema.nullable().optional(),
  translationKey: z.string().max(120).nullable().optional(),
  hidden: z.boolean().optional(),
});
export type UpdatePageBody = z.infer<typeof updatePageBody>;

export const reorderPagesBody = z.object({
  items: z.array(z.object({ id: z.string(), parentId: z.string().nullable(), position: z.number().int() })),
});
export type ReorderPagesBody = z.infer<typeof reorderPagesBody>;

// ─── Deployment (publish) ────────────────────────────────────────────────────

export const createDeploymentBody = z.object({
  message: z.string().max(300).optional(),
});
export type CreateDeploymentBody = z.infer<typeof createDeploymentBody>;

// ─── Domain ──────────────────────────────────────────────────────────────—

export const addDomainBody = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value.replace(/\.$/, ''))
    .pipe(
      z
        .string()
        .min(3)
        .max(253)
        .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Enter a valid domain like docs.example.com'),
    ),
});
export type AddDomainBody = z.infer<typeof addDomainBody>;

// ─── Members & invitations ───────────────────────────────────────────────────

/** Every role a member can HOLD (display, filters). Do not use for grants. */
export const memberRoleEnum = z.enum(['owner', 'admin', 'member']);

/** Roles that can be GRANTED via invites and role changes. `owner` is
 *  deliberately excluded at the schema level: a workspace has exactly one
 *  owner, and ownership moves only through the transfer-ownership endpoint. */
export const assignableMemberRoleEnum = z.enum(['admin', 'member']);

export const inviteMemberBody = z.object({
  email: z.email(),
  // Invitations can never carry the owner role — see assignableMemberRoleEnum.
  role: assignableMemberRoleEnum.default('member'),
});
export type InviteMemberBody = z.infer<typeof inviteMemberBody>;

// Role changes can never grant owner — see assignableMemberRoleEnum.
export const updateMemberRoleBody = z.object({ role: assignableMemberRoleEnum });
export type UpdateMemberRoleBody = z.infer<typeof updateMemberRoleBody>;

/** The ONLY path to the owner role: an owner-guarded transfer that atomically
 *  promotes the target admin and demotes the previous owner(s) to admin. */
export const transferOwnershipBody = z.object({ memberId: z.string().min(1) });
export type TransferOwnershipBody = z.infer<typeof transferOwnershipBody>;

// ─── API keys ─────────────────────────────────────────────────────────────—

export const createApiKeyBody = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.string()).default(['*']),
});
export type CreateApiKeyBody = z.infer<typeof createApiKeyBody>;

// ─── Assets ──────────────────────────────────────────────────────────────—

export const presignAssetBody = z.object({
  filename: z.string().min(1).max(255),
  // Assets are served from the dashboard's own origin. Keep the upload surface
  // deliberately small: HTML/SVG served inline here would become stored XSS.
  contentType: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .transform((value) => normalizeAssetContentType(value))
    .refine((value) => isSafeInlineAssetContentType(value), { message: 'Only PNG, JPEG, GIF, WebP, AVIF, and ICO images can be uploaded.' }),
  size: z
    .number()
    .int()
    .min(1)
    .max(50 * 1024 * 1024),
});
export type PresignAssetBody = z.infer<typeof presignAssetBody>;

export const confirmAssetBody = z.object({
  key: z.string().min(1),
  contentType: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .transform((value) => normalizeAssetContentType(value))
    .refine((value) => isSafeInlineAssetContentType(value), { message: 'Only PNG, JPEG, GIF, WebP, AVIF, and ICO images can be uploaded.' }),
  size: z.number().int().min(1),
});
export type ConfirmAssetBody = z.infer<typeof confirmAssetBody>;

// ─── Search & analytics ──────────────────────────────────────────────────────

export const searchQuery = z.object({
  q: z.string().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type SearchQuery = z.infer<typeof searchQuery>;

export const analyticsRangeEnum = z.enum(['24h', '7d', '30d', '90d']);
export type AnalyticsRange = z.infer<typeof analyticsRangeEnum>;
export const analyticsQuery = z.object({ range: analyticsRangeEnum.default('7d') });
export type AnalyticsQuery = z.infer<typeof analyticsQuery>;

export const trackEventBody = z.object({
  type: z.enum(['pageview', 'search', 'feedback']).default('pageview'),
  path: z.string().max(512).optional(),
  referrer: z.string().max(512).optional(),
  query: z.string().max(200).optional(),
  sessionId: z.string().max(64).optional(),
  language: z.string().max(35).optional(),
});
export type TrackEventBody = z.infer<typeof trackEventBody>;

// ─── Dedicated private-reader access ────────────────────────────────────────

export const projectAccessModeBody = z.object({ mode: z.enum(['PUBLIC', 'WORKSPACE', 'READERS']) }).strict();
export type ProjectAccessModeBody = z.infer<typeof projectAccessModeBody>;

export const createAudienceBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    /** Empty/null page scope means the entire site. */
    pageIds: z.array(z.string().min(1)).max(500).optional(),
  })
  .strict();
export type CreateAudienceBody = z.infer<typeof createAudienceBody>;

export const updateAudienceBody = createAudienceBody.partial();
export type UpdateAudienceBody = z.infer<typeof updateAudienceBody>;

export const inviteReaderBody = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    name: z.string().trim().min(1).max(120).optional(),
    audienceIds: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict();
export type InviteReaderBody = z.infer<typeof inviteReaderBody>;

export const updateReaderBody = z
  .object({
    name: z.string().trim().min(1).max(120).nullable().optional(),
    audienceIds: z.array(z.string().min(1)).min(1).max(100).optional(),
  })
  .strict();
export type UpdateReaderBody = z.infer<typeof updateReaderBody>;

const publicJwk = z
  .object({
    kty: z.string().min(1),
    kid: z.string().min(1).optional(),
    use: z.string().optional(),
    alg: z.string().optional(),
  })
  .passthrough()
  .refine((key) => !['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'priv', 'k'].some((field) => field in key), 'JWKS must contain public keys only');

export const jwtAccessConfigBody = z
  .object({
    enabled: z.boolean(),
    issuer: z.string().trim().url().max(2048),
    audience: z.string().trim().min(1).max(500),
    jwksUrl: z.string().trim().url().max(2048).nullable().optional(),
    publicJwks: z
      .object({ keys: z.array(publicJwk).min(1).max(20) })
      .strict()
      .nullable()
      .optional(),
    subjectClaim: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,80}$/)
      .default('sub'),
    emailClaim: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,80}$/)
      .default('email'),
    nameClaim: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,80}$/)
      .default('name'),
    groupsClaim: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,80}$/)
      .default('groups'),
    /** Maps an IdP claim value to an audience id. */
    claimMapping: z.record(z.string().min(1).max(200), z.string().min(1)).default({}),
    sessionTtlMinutes: z.number().int().min(5).max(43_200).default(480),
    maxTokenAgeSeconds: z.number().int().min(30).max(3600).default(300),
    clockToleranceSecs: z.number().int().min(0).max(300).default(30),
  })
  .strict()
  .refine((value) => Boolean(value.jwksUrl) !== Boolean(value.publicJwks), 'Provide exactly one of jwksUrl or publicJwks')
  .refine((value) => !value.jwksUrl || new URL(value.jwksUrl).protocol === 'https:', 'JWKS URL must use HTTPS');
export type JwtAccessConfigBody = z.infer<typeof jwtAccessConfigBody>;

export const readerActivationQuery = z.object({ token: z.string().min(32).max(512) }).strict();
export const readerJwtHandoffBody = z.object({ token: z.string().min(32).max(32_768), redirect: z.string().max(2048).optional() }).strict();

// ─── Comments ────────────────────────────────────────────────────────────────

/** Figma-style anchor: the block/selection a comment is attached to. `quote` (the
 *  anchored text) is the durable locator; from/to are creation-time position hints. */
export const commentAnchor = z
  .object({
    quote: z.string().max(2000),
    from: z.number().int().nonnegative().optional(),
    to: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CommentAnchor = z.infer<typeof commentAnchor>;

export const createCommentBody = z.object({
  body: z.string().min(1).max(4000),
  pageId: z.string().nullable().optional(),
  anchor: commentAnchor.nullable().optional(),
});
export type CreateCommentBody = z.infer<typeof createCommentBody>;

export const resolveCommentBody = z.object({ resolved: z.boolean() });
export type ResolveCommentBody = z.infer<typeof resolveCommentBody>;

export const listCommentsQuery = z.object({ pageId: z.string().optional() });
export type ListCommentsQuery = z.infer<typeof listCommentsQuery>;

// ─── AI drafting assistant ─────────────────────────────────────────────────—

export const aiDraftBody = z.object({
  mode: z.enum(['continue', 'rephrase', 'outline', 'summarize']),
  content: z.string().default(''),
  instruction: z.string().max(500).optional(),
});
export type AiDraftBody = z.infer<typeof aiDraftBody>;

// ─── Workspace settings ────────────────────────────────────────────────────—

// Bounded records (key length + count) so the metadata blob stays small even
// though values are free-form. ADMIN-gated, but defense-in-depth all the same.
const boundedRecord = <V extends z.ZodTypeAny>(value: V) =>
  z.record(z.string().max(64), value).refine((r) => Object.keys(r).length <= 50, { message: 'Too many keys.' });

/** Git content source (one-way import). Public GitHub and GitLab repositories are
 *  pulled into pages on demand. `connected` marks it as configured. */
export const gitConfigSchema = z.object({
  provider: z.enum(['github', 'gitlab', 'git']).optional(),
  repo: z
    .string()
    .max(120)
    .regex(/^[\w.-]+(?:\/[\w.-]+)+$/, 'Use the form owner/repo or group/project.')
    .optional(),
  cloneUrl: z
    .url()
    .max(500)
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Clone URL must use http(s).')
    .optional(),
  instanceUrl: z
    .url()
    .max(200)
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'GitLab instance URL must use http(s).')
    .optional(),
  branch: z.string().max(120).optional(),
  path: z
    .string()
    .max(300)
    .refine((value) => {
      const slashPath = value.trim().replace(/\\/g, '/');
      const parts = slashPath.split('/').filter(Boolean);
      return !slashPath.startsWith('/') && !/^[A-Za-z]:/.test(slashPath) && parts.every((part) => part !== '.' && part !== '..');
    }, 'Content path must stay inside the repository.')
    .optional(),
  importBranchId: z.string().max(120).optional(),
  importLanguageId: z.string().max(120).optional(),
  connected: z.boolean().optional(),
  lastImportedAt: z.string().max(40).optional(),
  /** Publish a new deployment automatically after a push-webhook import. */
  autoPublish: z.boolean().optional(),
});
export type GitConfig = z.infer<typeof gitConfigSchema>;

export const updateWorkspaceSettingsBody = z
  .object({
    notifications: boundedRecord(z.boolean()).optional(),
    integrations: boundedRecord(z.unknown()).optional(),
    git: gitConfigSchema.optional(),
    plan: z.string().max(40).optional(),
  })
  .strict();
export type UpdateWorkspaceSettingsBody = z.infer<typeof updateWorkspaceSettingsBody>;

// ─── Notifications (in-app bell inbox) ───────────────────────────────────────

/** Cursor pagination for the notification inbox (`cursor` = last row id). */
export const notificationsListQuery = z.object({ cursor: z.string().max(64).optional() });
export type NotificationsListQuery = z.infer<typeof notificationsListQuery>;

/** Mark specific notifications read (`ids`) or the whole inbox (`all: true`). */
export const markNotificationsReadBody = z
  .object({
    ids: z.array(z.string().max(64)).max(100).optional(),
    all: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.all === true || (value.ids?.length ?? 0) > 0, { message: 'Provide notification ids or all: true.' });
export type MarkNotificationsReadBody = z.infer<typeof markNotificationsReadBody>;

// ─── Published export jobs & archival schedules ────────────────────────────

export const exportFormat = z.enum(['MARKDOWN', 'PDF', 'STATIC_HTML']);
export type ExportFormatInput = z.infer<typeof exportFormat>;

export const createExportBody = z
  .object({
    formats: z
      .array(exportFormat)
      .min(1)
      .max(3)
      .transform((formats) => [...new Set(formats)]),
  })
  .strict();
export type CreateExportBody = z.infer<typeof createExportBody>;

export const createExportScheduleBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    formats: z
      .array(exportFormat)
      .min(1)
      .max(3)
      .transform((formats) => [...new Set(formats)]),
    cadence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
    timezone: z
      .string()
      .min(1)
      .max(80)
      .refine((timezone) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
          return true;
        } catch {
          return false;
        }
      }, 'Use a valid IANA timezone, for example Africa/Lagos.'),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    weekday: z.number().int().min(0).max(6).optional(),
    monthday: z.number().int().min(1).max(31).optional(),
    retentionCount: z.number().int().min(1).max(100).default(12),
    retentionDays: z.number().int().min(1).max(3650).default(90),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.cadence === 'WEEKLY' && value.weekday === undefined) {
      ctx.addIssue({ code: 'custom', path: ['weekday'], message: 'weekday is required for weekly schedules.' });
    }
    if (value.cadence === 'MONTHLY' && value.monthday === undefined) {
      ctx.addIssue({ code: 'custom', path: ['monthday'], message: 'monthday is required for monthly schedules.' });
    }
  });
export type CreateExportScheduleBody = z.infer<typeof createExportScheduleBody>;

export const updateExportScheduleBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
    retentionCount: z.number().int().min(1).max(100).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();
export type UpdateExportScheduleBody = z.infer<typeof updateExportScheduleBody>;

// ─── Admin panel ────────────────────────────────────────────────────────────

/** Set a user's platform role from the internal admin panel. */
export const adminSetRoleBody = z.object({ role: z.enum(['user', 'admin']) }).strict();
export type AdminSetRoleBody = z.infer<typeof adminSetRoleBody>;

// ─── Content importers ───────────────────────────────────────────────────────
// One-way imports from other documentation systems into a project's pages.
// Each importer source gets its own request schema here; the import summaries
// they return are plain server responses (not validated request bodies).

/** Import a public Mintlify docs repo from GitHub (docs.json or legacy mint.json). */
export const mintlifyImportBody = z
  .object({
    repo: z
      .string()
      .max(120)
      .regex(/^[\w.-]+\/[\w.-]+$/, 'Use the form owner/repo.'),
    branch: z.string().max(120).optional(),
  })
  .strict();
export type MintlifyImportBody = z.infer<typeof mintlifyImportBody>;

/** A Ghost JSON export posted as the request body. The export is a large,
 *  loosely-versioned document (`db[0].data.posts` …), so only "is a JSON
 *  object" is enforced here; the importer validates the actual shape. */
export const ghostImportBody = z.record(z.string(), z.unknown());
export type GhostImportBody = z.infer<typeof ghostImportBody>;

// ─── Git push-to-deploy webhook ──────────────────────────────────────────────
// Public endpoint: POST /api/public/git/webhook/:projectId. GitHub requests are
// verified via `X-Hub-Signature-256` (HMAC-SHA256 of the raw body), GitLab via
// the `X-Gitlab-Token` secret header. The secret and sync bookkeeping live in
// the org metadata `git` blob NEXT TO the client-editable GitConfig, but are
// deliberately absent from `gitConfigSchema` so a settings PATCH can never set
// or clear them — the admin-only rotate endpoint and the webhook sync runner
// are the only writers.

export const gitWebhookParams = z.object({ projectId: z.string().min(1).max(120) });
export type GitWebhookParams = z.infer<typeof gitWebhookParams>;

export type GitSyncStatus = 'ok' | 'failed';

/** Full stored shape of `metadata.git`: client-editable fields + server-managed
 *  webhook fields. */
export interface GitConfigStored extends GitConfig {
  /** Hex secret used to verify webhook deliveries. Server-generated only. */
  webhookSecret?: string;
  /** Last push-webhook sync attempt (set on success AND failure). */
  lastSyncAt?: string;
  lastSyncStatus?: GitSyncStatus;
  /** Present only when the last push sync failed. */
  lastSyncError?: string;
}
