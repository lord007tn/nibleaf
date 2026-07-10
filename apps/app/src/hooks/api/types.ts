// UI-facing shapes for API responses. Dates arrive as ISO strings over JSON.

import type { LanguageConfig, PageConfig, ProjectConfig } from '@nibleaf/validators';

export type { AnalyticsRange, LanguageConfig, PageConfig, ProjectConfig } from '@nibleaf/validators';

export interface Language {
  id: string;
  projectId: string;
  code: string;
  config?: LanguageConfig | null;
  label: string;
  direction: 'LTR' | 'RTL';
  isDefault: boolean;
  position: number;
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

export type PageKind = 'PAGE' | 'GROUP';

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
export interface DeploymentIssue {
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

/** What the next publish will change, relative to the last READY deployment. */
export interface PendingChanges {
  hasBaseline: boolean;
  lastVersion: number | null;
  lastPublishedAt: string | null;
  changes: PendingChange[];
}

export interface DeploymentDiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DeploymentPageDiff {
  id: string;
  title: string;
  path: string;
  languageCode: string;
  kind: PageKind;
  status: 'added' | 'modified' | 'removed';
  fields: string[];
  additions: number;
  deletions: number;
  lines: DeploymentDiffLine[];
  truncated: boolean;
}

export interface DeploymentDiff {
  deployment: Deployment;
  previousDeployment: Deployment | null;
  changes: DeploymentPageDiff[];
}

/** Result of a one-way public Git → pages import. */
export interface GitImportSummary {
  files: number;
  imported: number;
  updated: number;
  skipped: number;
}

export interface DnsRecord {
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
  verificationToken: string;
  createdAt: string;
  verifiedAt: string | null;
  records?: DnsRecord[];
}

export interface ApiKey {
  id: string;
  name: string;
  lastFour: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  secret?: string;
}

export interface Member {
  id: string;
  role: string;
  createdAt: string;
  user: { id: string; name: string; email: string; image: string | null };
}

export interface Invitation {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string;
}

export interface Asset {
  id: string;
  key: string;
  url: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface AnalyticsOverview {
  range: string;
  totalViews: number;
  uniqueVisitors: number;
  timeseries: Array<{ date: string; views: number }>;
  topPages: Array<{ path: string; views: number }>;
  topSearches: Array<{ query: string; count: number }>;
  referrers: Array<{ referrer: string; views: number }>;
  languages: Array<{ language: string; views: number }>;
}

export interface WorkspaceAnalytics {
  range: string;
  totalViews: number;
  uniqueVisitors: number;
  timeseries: Array<{ date: string; views: number }>;
  byProject: Array<{ projectId: string; name: string; color: string; views: number }>;
  topPages: Array<{ path: string; project: string; views: number }>;
  referrers: Array<{ referrer: string; views: number }>;
  devices: Array<{ device: string; count: number }>;
  searches: { total: number; topTerms: Array<{ query: string; count: number }> };
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

export interface CommentAnchor {
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

export interface AiDraftResult {
  text: string;
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
  languages: Array<{ code: string; label: string; direction: 'LTR' | 'RTL'; isDefault: boolean }>;
  versions: Array<{ id: string; name: string; slug: string; isDefault: boolean }>;
  activeLanguage: string;
  activeVersion: string;
  version: number;
  generatedAt: string;
}

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

export interface SitePage {
  project: SiteShell['project'];
  page: {
    id: string;
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
  languageConfig: LanguageConfig | null;
  /** hreflang alternates: `path` is the page's URL in that language, or null
   *  when that language has no corresponding page (then it's omitted). */
  languages: Array<{ code: string; isDefault: boolean; path: string | null }>;
  breadcrumbs: Array<{ title: string; path: string }>;
  prev: { title: string; path: string } | null;
  next: { title: string; path: string } | null;
}

export interface SearchHit {
  id: string;
  title: string;
  path: string;
  description: string;
  icon?: string;
  snippet: string;
  score: number;
}
