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
}

export interface ApiKey {
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
  createdAt: string;
  updatedAt: string;
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
    description: string;
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

interface SearchCitation {
  id: string;
  pageId: string;
  title: string;
  path: string;
  heading?: string;
  snippet: string;
  direction: 'ltr' | 'rtl';
}

export interface SearchAnswer {
  status: 'answered' | 'no_answer';
  answer: string;
  confidence: number;
  citations: SearchCitation[];
  model?: string;
  cacheHit: boolean;
  quotaRemaining: number;
}
