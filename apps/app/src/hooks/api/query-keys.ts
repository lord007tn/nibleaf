import type { AnalyticsInsightsQuery, AnalyticsRange } from '@nibleaf/validators';

/** Insights endpoints under /app/projects/:projectId/analytics/insights. */
type InsightsEndpoint = 'overview' | 'pages' | 'page' | 'search' | 'feedback' | 'ai' | 'performance';

export const queryKeys = {
  projects: {
    all: () => ['projects'] as const,
    detail: (projectId: string) => ['projects', projectId] as const,
  },
  addons: {
    all: (projectId: string) => ['addons', projectId] as const,
    detail: (projectId: string, addonId: string) => ['addons', projectId, addonId] as const,
    audit: (projectId: string) => ['addons', projectId, 'audit'] as const,
  },
  pages: {
    all: (projectId: string, languageId?: string, branchId?: string) => ['pages', projectId, languageId ?? null, branchId ?? null] as const,
    /** Broad prefix matching every language/branch scope — use for invalidation. */
    allForProject: (projectId: string) => ['pages', projectId] as const,
    detail: (projectId: string, pageId: string) => ['pages', projectId, pageId] as const,
  },
  languages: {
    all: (projectId: string) => ['languages', projectId] as const,
  },
  branches: {
    all: (projectId: string) => ['branches', projectId] as const,
    mergePreview: (projectId: string, branchId: string) => ['branches', projectId, branchId, 'merge-preview'] as const,
  },
  deployments: {
    all: (projectId: string) => ['deployments', projectId] as const,
    latest: (projectId: string) => ['deployments', projectId, 'latest'] as const,
    changes: (projectId: string) => ['deployments', projectId, 'changes'] as const,
    detail: (projectId: string, id: string) => ['deployments', projectId, id] as const,
    diff: (projectId: string, id: string) => ['deployments', projectId, id, 'diff'] as const,
  },
  domains: {
    all: (projectId: string) => ['domains', projectId] as const,
  },
  apiKeys: {
    all: (projectId: string) => ['api-keys', projectId] as const,
  },
  connectedApps: {
    all: (projectId: string) => ['connected-apps', projectId] as const,
  },
  mcpOAuth: {
    authorization: (oauthQuery: string) => ['mcp-oauth', 'authorization', oauthQuery] as const,
  },
  assets: {
    all: (projectId: string) => ['assets', projectId] as const,
  },
  openapi: {
    detail: (projectId: string) => ['openapi', projectId] as const,
  },
  usage: {
    /** Per-site usage counters for the settings Usage tab. */
    forProject: (projectId: string) => ['usage', projectId] as const,
  },
  /** The workspace's own AI provider, model and search index (settings → Smart AI). */
  workspaceAi: {
    detail: (projectId: string) => ['workspace-ai', projectId] as const,
    /** Whether the editor can draft with AI for this site, from any connection. */
    draftCapability: (projectId: string) => ['workspace-ai', projectId, 'draft-capability'] as const,
  },
  projectSearch: {
    configuration: (projectId: string) => ['projects', projectId, 'search', 'configuration'] as const,
    index: (projectId: string, cursor?: string, limit?: number) => ['projects', projectId, 'search', 'index', cursor ?? null, limit ?? null] as const,
    allIndex: (projectId: string) => ['projects', projectId, 'search', 'index'] as const,
  },
  comments: {
    all: (projectId: string, pageId?: string) => ['comments', projectId, pageId ?? null] as const,
    /** Broad prefix matching the site-wide and every per-page comment list — use for invalidation. */
    allForProject: (projectId: string) => ['comments', projectId] as const,
  },
  workspace: {
    settings: () => ['workspace', 'settings'] as const,
    projectSettings: (projectId: string) => ['workspace', 'settings', projectId] as const,
  },
  members: {
    all: () => ['members'] as const,
    /** Per-site members + invitations (each site owns its own member list). */
    forProject: (projectId: string) => ['members', projectId] as const,
    joinLinks: (projectId: string) => ['members', projectId, 'join-links'] as const,
    suggestions: (projectId: string, query: string) => ['members', projectId, 'suggestions', query] as const,
    /** Everyone on the sites the signed-in person administers (the People page). */
    people: () => ['members', 'people'] as const,
  },
  readerAccess: {
    detail: (projectId: string) => ['reader-access', projectId] as const,
  },
  notifications: {
    list: (organizationId?: string) => (organizationId ? (['notifications', 'organization', organizationId] as const) : (['notifications'] as const)),
    unreadCount: () => ['notifications', 'unread-count'] as const,
  },
  exports: {
    all: (projectId: string) => ['projects', projectId, 'exports'] as const,
    runs: (projectId: string) => ['projects', projectId, 'exports', 'runs'] as const,
    schedules: (projectId: string) => ['projects', projectId, 'exports', 'schedules'] as const,
  },
  gitWorkflow: {
    detail: (projectId: string) => ['git-workflow', projectId] as const,
  },
  integrations: {
    all: (projectId: string) => ['integrations', projectId] as const,
  },
  public: {
    meta: () => ['public', 'meta'] as const,
    invitation: (invitationId: string) => ['public', 'invitations', invitationId] as const,
    joinLink: (token: string) => ['public', 'join', token] as const,
  },
  site: {
    shell: (id: string, lang?: string, version?: string) => ['site', id, lang ?? null, version ?? null] as const,
    page: (id: string, path: string, lang?: string, version?: string) => ['site', id, 'page', path, lang ?? null, version ?? null] as const,
    search: (id: string, q: string, lang?: string, version?: string, limit?: number, prefer?: string) =>
      ['site', id, 'search', q, lang ?? null, version ?? null, limit ?? null, prefer ?? null] as const,
    /** Prefix of every reader search for one site, for invalidation. */
    allSearch: (id: string) => ['site', id, 'search'] as const,
    changelog: (id: string) => ['site', id, 'changelog'] as const,
  },
  analytics: {
    /** Project home: page views and trend for one site. */
    project: (projectId: string, range: AnalyticsRange, timezone: string) => ['analytics', 'project', projectId, range, timezone] as const,
    /** Workspace home and workspace analytics: every site the person can reach. */
    workspace: (range: AnalyticsRange, timezone: string) => ['analytics', 'workspace', range, timezone] as const,
    /** Broad prefix matching every insights query of one site (all endpoints and filters) — use for invalidation. */
    insightsForProject: (projectId: string) => ['analytics', 'insights', projectId] as const,
    /** Every filter value is part of the key, so a range/compare/timezone change is a new cache entry. */
    insights: (projectId: string, endpoint: InsightsEndpoint, query: AnalyticsInsightsQuery, path?: string) =>
      [
        'analytics',
        'insights',
        projectId,
        endpoint,
        query.range,
        query.from ?? '',
        query.to ?? '',
        query.compare,
        query.timezone,
        ...(path === undefined ? [] : [path]),
      ] as const,
  },
} as const;
