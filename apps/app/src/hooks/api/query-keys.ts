export const queryKeys = {
  projects: {
    all: () => ['projects'] as const,
    detail: (projectId: string) => ['projects', projectId] as const,
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
  assets: {
    all: (projectId: string) => ['assets', projectId] as const,
  },
  analytics: {
    overview: (projectId: string, range: string) => ['analytics', projectId, range] as const,
  },
  usage: {
    /** Per-site usage counters for the settings Usage tab. */
    forProject: (projectId: string) => ['usage', projectId] as const,
  },
  comments: {
    all: (projectId: string, pageId?: string) => ['comments', projectId, pageId ?? null] as const,
  },
  workspace: {
    analytics: (range: string) => ['workspace', 'analytics', range] as const,
    settings: () => ['workspace', 'settings'] as const,
    projectSettings: (projectId: string) => ['workspace', 'settings', projectId] as const,
  },
  members: {
    all: () => ['members'] as const,
    /** Per-site members + invitations (each site owns its own member list). */
    forProject: (projectId: string) => ['members', projectId] as const,
  },
  notifications: {
    list: () => ['notifications'] as const,
    unreadCount: () => ['notifications', 'unread-count'] as const,
  },
  site: {
    shell: (id: string, lang?: string, version?: string) => ['site', id, lang ?? null, version ?? null] as const,
    page: (id: string, path: string, lang?: string, version?: string) => ['site', id, 'page', path, lang ?? null, version ?? null] as const,
    search: (id: string, q: string, lang?: string, version?: string, limit?: number) =>
      ['site', id, 'search', q, lang ?? null, version ?? null, limit ?? null] as const,
    changelog: (id: string) => ['site', id, 'changelog'] as const,
  },
} as const;
