import { z } from 'zod';

// ─── Common ─────────────────────────────────────────────────────────────────

export const idParam = z.object({ id: z.string().min(1) });
export const projectIdParam = z.object({ projectId: z.string().min(1) });

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex color like #5546e8');

// Bounded, strict theme schema. Rejects unknown keys (prevents prototype-pollution
// and unbounded input) while still serializing cleanly to Prisma JSON.
const themeSchema = z
  .object({
    primaryColor: z
      .string()
      .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
      .optional(),
    font: z.string().max(60).optional(),
    layout: z.enum(['sidebar', 'centered']).optional(),
    accentColor: z.string().max(20).optional(),
  })
  .strict();

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
const redirectPair = z.object({ from: z.string().max(300), to: z.string().max(300) }).strict();
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
      })
      .strict()
      .optional(),
    footer: z
      .object({
        copyright: z.string().max(200).optional(),
        github: url.optional(),
        x: url.optional(),
        linkedin: url.optional(),
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
    redirects: z.array(redirectPair).max(100).optional(),
    variables: z.array(kvPair).max(100).optional(),
  })
  .strict();
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

// ─── Per-language config (SEO + behaviour overrides) ─────────────────────────

/** SEO defaults that apply to every page in one language, overriding the
 *  project-level SEO and overridden in turn by a page's own SEO. */
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
  })
  .strict();
export type LanguageConfig = z.infer<typeof languageConfigSchema>;

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
    /** Content width on the live site. */
    mode: pageModeEnum.optional(),
    /** Hide the right-hand "On this page" table of contents. */
    hideToc: z.boolean().optional(),
  })
  .strict();
export type PageConfig = z.infer<typeof pageConfigSchema>;

// ─── Project ──────────────────────────────────────────────────────────────—

export const createProjectBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  color: hexColor.optional(),
  icon: z.string().max(64).optional(),
});
export type CreateProjectBody = z.infer<typeof createProjectBody>;

export const updateProjectBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
  color: hexColor.optional(),
  logoUrl: z.string().nullable().optional(),
  faviconUrl: z.string().nullable().optional(),
  theme: themeSchema.nullable().optional(),
  config: projectConfigSchema.optional(),
});
export type UpdateProjectBody = z.infer<typeof updateProjectBody>;

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
});
export type CreateLanguageBody = z.infer<typeof createLanguageBody>;

export const updateLanguageBody = z.object({
  label: z.string().min(1).max(60).optional(),
  direction: textDirectionEnum.optional(),
  isDefault: z.boolean().optional(),
  position: z.number().int().optional(),
  config: languageConfigSchema.nullable().optional(),
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
    .min(3)
    .max(253)
    .regex(/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i, 'Enter a valid domain like docs.example.com'),
});
export type AddDomainBody = z.infer<typeof addDomainBody>;

// ─── Members & invitations ───────────────────────────────────────────────────

export const memberRoleEnum = z.enum(['owner', 'admin', 'member']);

export const inviteMemberBody = z.object({
  email: z.email(),
  role: memberRoleEnum.default('member'),
});
export type InviteMemberBody = z.infer<typeof inviteMemberBody>;

export const updateMemberRoleBody = z.object({ role: memberRoleEnum });
export type UpdateMemberRoleBody = z.infer<typeof updateMemberRoleBody>;

// ─── API keys ─────────────────────────────────────────────────────────────—

export const createApiKeyBody = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.string()).default(['*']),
});
export type CreateApiKeyBody = z.infer<typeof createApiKeyBody>;

// ─── Assets ──────────────────────────────────────────────────────────────—

export const presignAssetBody = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(150),
  size: z
    .number()
    .int()
    .min(1)
    .max(50 * 1024 * 1024),
});
export type PresignAssetBody = z.infer<typeof presignAssetBody>;

export const confirmAssetBody = z.object({
  key: z.string().min(1),
  contentType: z.string().min(1),
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
  type: z.enum(['pageview', 'search']).default('pageview'),
  path: z.string().max(512).optional(),
  referrer: z.string().max(512).optional(),
  query: z.string().max(200).optional(),
  sessionId: z.string().max(64).optional(),
  language: z.string().max(35).optional(),
});
export type TrackEventBody = z.infer<typeof trackEventBody>;

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

/** GitHub content source (one-way import). Only `github` is supported; the configured
 *  repo/branch/path are pulled into pages on demand. `connected` marks it as configured. */
export const gitConfigSchema = z.object({
  provider: z.enum(['github']).optional(),
  repo: z
    .string()
    .max(120)
    .regex(/^[\w.-]+\/[\w.-]+$/, 'Use the form owner/repo.')
    .optional(),
  branch: z.string().max(120).optional(),
  path: z.string().max(300).optional(),
  connected: z.boolean().optional(),
  lastImportedAt: z.string().max(40).optional(),
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
