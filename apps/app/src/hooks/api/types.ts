// UI-facing shapes for API responses. Dates arrive as ISO strings over JSON.

import type { AddonAvailabilityState, AddonGroup, AddonId } from '@nibleaf/shared/addons';
import type { LanguageConfig, PageConfig, ProjectConfig } from '@nibleaf/validators';

export type { AnalyticsRange, LanguageConfig, PageConfig, ProjectConfig } from '@nibleaf/validators';

type PublishedLanguageConfig = LanguageConfig & { name?: string; description?: string };

export interface Language {
  id: string;
  projectId: string;
  code: string;
  config?: LanguageConfig | null;
  translation?: { id: string; projectId: string; languageId: string; name: string | null; description: string | null } | null;
  label: string;
  direction: 'LTR' | 'RTL';
  isDefault: boolean;
  /** Serving toggle: disabled languages stay editable but are hidden from the
   *  published site. Optional for rows fetched before the flag existed. */
  enabled?: boolean;
  position: number;
  /** Default-branch PAGE coverage compared with the default language. */
  coverage?: {
    pageCount: number;
    sourcePageCount: number;
    matchedPages: number;
    missingPages: number;
    extraPages: number;
    percentage: number | null;
  };
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  config: ProjectConfig | null;
  languages?: Language[];
  createdAt: string;
  updatedAt: string;
  _count?: { pages: number; deployments: number; domains?: number };
  /** Sites list only: how many publishes on this site went live, by any member
   *  (the sign-up starter site's automatic first publish isn't counted). */
  livePublishes?: number;
  /** Sites list only: a publish is queued or being prepared right now. */
  publishing?: boolean;
  /** One site only: a publish went live and kept its site copy (so it can be
   *  exported), however long ago — the sign-up starter's first publish included. */
  hasPublishedVersion?: boolean;
}

/** The newest MCP audit event of a key or connected app. `operation` is the
 *  tool or resource name and `errorCode` the audit code when it failed; the
 *  dashboard turns both into one plain sentence. */
export interface McpActivity {
  operation: string;
  outcome: string;
  errorCode?: string | null;
  at: string;
}

export interface ApiKey {
  createdBy: { id: string; name: string; email: string } | null;
  preset: 'read_only' | 'support_writer' | 'full_admin' | 'custom';
  lastActivity: McpActivity | null;
  /** Present on list responses: whether the signed-in user created this key
   *  (only owners may rotate a key, because rotation re-issues it as the caller). */
  ownedByViewer?: boolean;
  id: string;
  name: string;
  lastFour: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  rotatedFromId: string | null;
  legacy: boolean;
  state: 'active' | 'expired' | 'revoked' | 'rotation_required';
}

export interface ApiKeySecret extends ApiKey {
  secret: string;
}

/** The personal-key list plus what the instance offers (MCP on/off, endpoint, sign-in connections). */
export interface ApiKeyList {
  data: ApiKey[];
  meta: { mcpEnabled: boolean; mcpEndpoint: string; mcpOAuthEnabled?: boolean };
}

/** One AI app connected to a project by signing in (an OAuth connection). */
export interface ConnectedApp {
  id: string;
  name: string;
  uri: string | null;
  preset: 'read_only' | 'support_writer' | 'full_admin';
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  connectedBy: { id: string; name: string; email: string };
  ownedByViewer: boolean;
  lastActivity: McpActivity | null;
}

export interface OpenApiConfiguration {
  title: string;
  path: string;
  contentHash: string;
  updatedAt: string;
  source: { type: 'upload' } | { type: 'url'; url: string } | { type: 'repository'; path: string };
}

interface PublishedOpenApi {
  title: string;
  path: string;
  contentHash: string;
  updatedAt: string;
}

type PageKind = 'PAGE' | 'GROUP';

export interface PageNode {
  id: string;
  parentId: string | null;
  /** The docs version (branch) the page belongs to; the API always returns it. */
  branchId?: string;
  languageId: string;
  kind: PageKind;
  title: string;
  slug: string;
  path: string;
  icon: string | null;
  description: string | null;
  config?: PageConfig | null;
  translationKey?: string | null;
  position: number;
  hidden: boolean;
  updatedAt: string;
}

export interface Page extends PageNode {
  content: string;
  projectId: string;
  createdAt: string;
}

export interface Branch {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  /** When the version was copied from main; null on older versions. */
  forkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A page on main that changed since a version was created. */
interface BranchChangedOnMainPage {
  pageId: string;
  title: string;
  path: string;
  languageCode: string;
  /** `conflict`: two pages would share an address (`renamed`), or the moves
   *  on both sides would put pages inside each other (`blocked`). For a
   *  conflict, `pageId`/`title` are the page concerned, which may be one of
   *  the version's pages. */
  change: 'modified' | 'added' | 'deleted' | 'conflict';
  /** What promote does with it: keep main's page, replace it with the
   *  version's, remove it, bring the version's copy back, give it a numbered
   *  address (`newPath`), move it because its parent goes away
   *  (`newParentPath`, null for the top level), or refuse (`blocked`: promote
   *  answers 409 branch:promote_blocked even when confirmed). */
  onPromote: 'kept' | 'replaced' | 'removed' | 'restored' | 'renamed' | 'moved' | 'blocked';
  newPath?: string;
  newParentPath?: string | null;
  updatedAt: string;
}

/** GET …/branches/:id/merge-preview, and the `details` of a 409
 *  `branch:main_changed` from promote. `baselineComplete` is false for versions
 *  created before fork tracking: deletions on main can't be listed for them. */
export interface BranchMergePreview {
  changedOnMainSinceFork: BranchChangedOnMainPage[];
  baselineComplete: boolean;
}

export type DeploymentStatus = 'PENDING' | 'BUILDING' | 'READY' | 'FAILED';

/** Structured publish-check failure (Deployment.errorDetails). */
interface DeploymentIssue {
  type: 'broken-link' | 'grammar';
  pageTitle: string;
  pagePath: string;
  detail: string;
}

export interface Deployment {
  id: string;
  version: number;
  status: DeploymentStatus;
  pagesCount: number;
  commitMessage: string | null;
  error: string | null;
  /** Per-page publish-check failures on FAILED deployments. */
  errorDetails?: DeploymentIssue[] | null;
  createdAt: string;
  completedAt: string | null;
}

/** A single page's status in the publish diff (vs. the last published snapshot). */
export interface PendingChange {
  id: string;
  title: string;
  path: string;
  languageCode: string;
  kind: 'PAGE' | 'GROUP';
  status: 'added' | 'modified' | 'removed';
  fields: string[];
  additions: number;
  deletions: number;
  lines: DeploymentDiffLine[];
  truncated: boolean;
}

interface DeploymentDiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: number;
}

export interface Domain {
  id: string;
  domain: string;
  verified: boolean;
  isPrimary: boolean;
  dnsStatus: 'PENDING' | 'VERIFIED' | 'ERROR';
  sslStatus: 'PENDING' | 'PROVISIONING' | 'ACTIVE' | 'ERROR';
  verificationToken: string;
  createdAt: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  records?: DnsRecord[];
}

export interface Asset {
  id: string;
  key: string;
  url: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface WorkspaceSettings {
  plan: string;
  notifications: Record<string, boolean>;
  integrations: Record<string, unknown>;
  git: Record<string, unknown>;
  name: string;
  slug: string | null;
  projectCount: number;
  memberCount: number;
  [key: string]: unknown;
}

export interface ProjectAddon {
  id: AddonId;
  group: AddonGroup;
  enabled: boolean;
  config: Record<string, unknown>;
  revision: number;
  updatedAt: string | null;
  status: 'active' | 'inactive' | 'needs_configuration' | 'unavailable';
  availability: {
    state: AddonAvailabilityState;
    plans: readonly string[];
    entitlement: `addons.${AddonId}`;
    available: boolean;
    schemaVersion: 1;
    projectId: string;
    capabilityKey: string;
    availability: 'complete' | 'unavailable';
    decision: 'enabled' | 'disabled' | 'unknown';
    planKey: string | null;
    source: 'plan' | 'compatibility' | null;
    limit: string | null;
    meterKey: string | null;
    behavior: 'observe' | 'warn' | 'block';
    enforcement: 'advisory';
  };
}

interface CommentAnchor {
  /** The anchored text — the durable locator (re-found on load). */
  quote: string;
  /** Creation-time ProseMirror position hints. */
  from?: number;
  to?: number;
}

export interface Comment {
  id: string;
  body: string;
  resolved: boolean;
  createdAt: string;
  /** Figma-style anchor to a block/selection on the page (null = page-level). */
  anchor?: CommentAnchor | null;
  user: { id: string; name: string; image: string | null };
}

export interface ChangelogEntry {
  version: number;
  date: string | null;
  title: string;
  pages: number;
}

// ─── Notifications (bell inbox) ──────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  projectId: string | null;
  type: string;
  title: string;
  body: string | null;
  /** Dashboard-relative link opened when the notification is clicked. */
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

/** One inbox page, newest first. `nextCursor` is null on the last page. */
export interface NotificationList {
  items: NotificationItem[];
  nextCursor: string | null;
}

// ─── Public site (live preview) ─────────────────────────────────────────────

export interface NavNode {
  id: string;
  kind: PageKind;
  title: string;
  path: string;
  icon: string | null;
  tag: string | null;
  children: NavNode[];
}

export interface SiteShell {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    config: ProjectConfig | null;
    /** Verified primary custom domain — canonical/301 consolidation target. */
    primaryDomain: string | null;
  };
  nav: NavNode[];
  /** Only ENABLED languages — the server filters disabled ones out. */
  languages: Array<{ code: string; label: string; direction: 'LTR' | 'RTL'; isDefault: boolean; enabled?: boolean }>;
  versions: Array<{ id: string; name: string; slug: string; isDefault: boolean }>;
  activeLanguage: string;
  activeVersion: string;
  /** The ACTIVE language's config (localized site name/description + SEO
   *  defaults) — lets the chrome and site-level head localize the brand. */
  languageConfig: PublishedLanguageConfig | null;
  version: number;
  generatedAt: string;
  /** Validated OpenAPI document metadata frozen in the current deployment. */
  openapi?: PublishedOpenApi | null;
  /** `answer`: the site enables AI answers and the instance can serve them.
   *  Optional because a response from an older API omits it; treat as off. */
  capabilities?: { answer: boolean };
}

interface Heading {
  depth: number;
  text: string;
  id: string;
}

export interface SitePage {
  project: SiteShell['project'];
  page: {
    id: string;
    createdAt: string;
    updatedAt: string;
    title: string;
    /** Author-written summary — the visible lede. null when none was set. */
    description: string | null;
    /** Summary derived from the body: SEO/social fallback only, never a lede. */
    excerpt: string;
    icon: string | null;
    path: string;
    content: string;
    headings: Heading[];
    config: PageConfig | null;
  };
  /** The language the page actually resolved in (drives canonical/og/hreflang). */
  activeLanguage: string;
  /** The docs version the page resolved in. */
  activeVersion: string;
  versions: SiteShell['versions'];
  /** SEO defaults of the page's language (layered under the page's own SEO). */
  languageConfig: PublishedLanguageConfig | null;
  /** hreflang alternates: `path` is the page's URL in that language, or null
   *  when that language has no corresponding page (then it's omitted). */
  languages: Array<{ code: string; isDefault: boolean; path: string | null }>;
  breadcrumbs: Array<{ title: string; path: string }>;
  prev: { title: string; path: string } | null;
  next: { title: string; path: string } | null;
}

export interface SiteSearchHit {
  id: string;
  title: string;
  path: string;
  description: string;
  icon?: string;
  snippet: string;
  score: number;
  /** Language of the matched published page; used to build its localized URL. */
  language: string;
  /** The heading whose section matched the query, when the match is inside a
   * section rather than the page title. `id` is the heading's DOM anchor. */
  section?: { id: string; title: string };
  /** The search that returned this hit, so a click is attributed to it in analytics. */
  searchId?: string;
}
