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

const url = z.string().max(500);
const navLink = z.object({ label: z.string().max(80), href: url, external: z.boolean().optional() }).strict();
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
});
export type TrackEventBody = z.infer<typeof trackEventBody>;

// ─── Comments ────────────────────────────────────────────────────────────────

export const createCommentBody = z.object({
  body: z.string().min(1).max(4000),
  pageId: z.string().nullable().optional(),
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

export const updateWorkspaceSettingsBody = z
  .object({
    notifications: z.record(z.string(), z.boolean()).optional(),
    integrations: z.record(z.string(), z.unknown()).optional(),
    git: z.record(z.string(), z.unknown()).optional(),
    plan: z.string().optional(),
  })
  .strict();
export type UpdateWorkspaceSettingsBody = z.infer<typeof updateWorkspaceSettingsBody>;
