import { z } from 'zod';

import { isSafeInlineAssetContentType, normalizeAssetContentType } from './assets';

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
export type RedirectPair = { from: string; to: string };

const cleanRedirectPath = (path: string): string => path.trim().replace(/^\/+|\/+$/g, '');
const isExternalRedirect = (target: string): boolean => /^https?:\/\//i.test(target);

/**
 * Resolve an internal redirect chain to one final target. Returning `null`
 * means no rule matched or the stored rules contain a cycle. Keeping this
 * helper in the shared validator package makes save-time validation and the
 * public-site redirect behavior follow exactly the same path semantics.
 */
export const resolveRedirectTarget = (redirects: readonly RedirectPair[], path: string): string | null => {
  const rules = new Map<string, string>();
  for (const rule of redirects) {
    const from = cleanRedirectPath(rule.from);
    const to = rule.to.trim();
    if (rule.from.trim() && to && !rules.has(from)) {
      rules.set(from, to);
    }
  }

  let current = cleanRedirectPath(path);
  const first = current;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(current)) {
      return null;
    }
    visited.add(current);

    const target = rules.get(current);
    if (!target) {
      return current === first ? null : `/${current}`;
    }
    if (isExternalRedirect(target)) {
      return target;
    }
    current = cleanRedirectPath(target);
  }
};

const redirectsSchema = z
  .array(z.object({ from: z.string().max(300), to: z.string().max(300) }).strict())
  .max(100)
  .superRefine((redirects, ctx) => {
    const seen = new Map<string, number>();
    for (const [index, rule] of redirects.entries()) {
      const from = cleanRedirectPath(rule.from);
      const to = rule.to.trim();
      if (!rule.from.trim() || !to) {
        continue;
      }
      const duplicate = seen.get(from);
      if (duplicate !== undefined) {
        ctx.addIssue({ code: 'custom', message: `Duplicate redirect source (also used in row ${duplicate + 1}).`, path: [index, 'from'] });
      } else {
        seen.set(from, index);
      }
      if (!isExternalRedirect(to) && cleanRedirectPath(to) === from) {
        ctx.addIssue({ code: 'custom', message: 'A redirect cannot point to itself.', path: [index, 'to'] });
      }
    }

    for (const [index, rule] of redirects.entries()) {
      if (rule.from.trim() && rule.to.trim() && resolveRedirectTarget(redirects, rule.from) === null) {
        ctx.addIssue({ code: 'custom', message: 'Redirect cycle detected.', path: [index, 'to'] });
      }
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
