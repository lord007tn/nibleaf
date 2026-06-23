// UI-facing shapes for API responses. Dates arrive as ISO strings over JSON.

import type { ProjectConfig } from '@plume/validators';

export type { ProjectConfig } from '@plume/validators';

export interface Language {
  id: string;
  projectId: string;
  code: string;
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
  color: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  theme: Record<string, unknown> | null;
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

export interface Deployment {
  id: string;
  version: number;
  status: DeploymentStatus;
  pagesCount: number;
  commitMessage: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
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

export interface Comment {
  id: string;
  body: string;
  resolved: boolean;
  createdAt: string;
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
  children: NavNode[];
}

export interface SiteShell {
  project: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    color: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    config: Record<string, unknown> | null;
  };
  nav: NavNode[];
  languages: Array<{ code: string; label: string; direction: 'LTR' | 'RTL'; isDefault: boolean }>;
  activeLanguage: string;
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
  page: { id: string; title: string; description: string; icon: string | null; path: string; content: string; headings: Heading[] };
  languages?: Array<{ code: string; isDefault: boolean }>;
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
