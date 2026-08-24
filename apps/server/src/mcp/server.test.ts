import { InMemoryTransport, type JSONRPCMessage, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { MCP_SCOPES } from '@nibleaf/shared/mcp';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { createNibleafMcpServer } from './server';
import type { McpPrincipal } from './types';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  getProject: vi.fn(),
  listPages: vi.fn(),
  getPage: vi.fn(),
  listLanguages: vi.fn(),
  listBranches: vi.fn(),
  getAnalyticsOverview: vi.fn(),
  getProjectSearchConfiguration: vi.fn(),
  getProjectSearchIndexDiagnostics: vi.fn(),
  getProjectUsageSummary: vi.fn(),
  getProjectEntitlements: vi.fn(),
  checkProjectEntitlement: vi.fn(),
  listProjectAddons: vi.fn(),
  getProjectAddon: vi.fn(),
  listProjectAddonAuditEvents: vi.fn(),
  exportProjectTheme: vi.fn(),
  getProjectThemeCatalog: vi.fn(),
  importProjectTheme: vi.fn(),
  listExports: vi.fn(),
  getExport: vi.fn(),
  listDeployments: vi.fn(),
  getDeployment: vi.fn(),
  getPendingChanges: vi.fn(),
  getGitWorkspaceStatus: vi.fn(),
  listProjectIntegrations: vi.fn(),
  getProjectIntegration: vi.fn(),
}));

vi.mock('./audit', () => ({ recordMcpAudit: mocks.audit }));
vi.mock('@/actions/projects', () => ({ getProject: mocks.getProject }));
vi.mock('@/actions/pages', () => ({ listPages: mocks.listPages, getPage: mocks.getPage }));
vi.mock('@/actions/languages', () => ({ listLanguages: mocks.listLanguages }));
vi.mock('@/actions/branches', () => ({ listBranches: mocks.listBranches }));
vi.mock('@/actions/analytics', () => ({ getAnalyticsOverview: mocks.getAnalyticsOverview }));
vi.mock('@/actions/search', () => ({
  getProjectSearchConfiguration: mocks.getProjectSearchConfiguration,
  getProjectSearchIndexDiagnostics: mocks.getProjectSearchIndexDiagnostics,
}));
vi.mock('@/actions/usage', () => ({
  getProjectUsageSummary: mocks.getProjectUsageSummary,
  getProjectEntitlements: mocks.getProjectEntitlements,
  checkProjectEntitlement: mocks.checkProjectEntitlement,
}));
vi.mock('@/actions/addons', () => ({
  listProjectAddons: mocks.listProjectAddons,
  getProjectAddon: mocks.getProjectAddon,
  listProjectAddonAuditEvents: mocks.listProjectAddonAuditEvents,
}));
vi.mock('@/actions/themes', () => ({
  exportProjectTheme: mocks.exportProjectTheme,
  getProjectThemeCatalog: mocks.getProjectThemeCatalog,
  importProjectTheme: mocks.importProjectTheme,
}));
vi.mock('@/actions/exports', () => ({ listExports: mocks.listExports, getExport: mocks.getExport }));
vi.mock('@/actions/deployments', () => ({
  listDeployments: mocks.listDeployments,
  getDeployment: mocks.getDeployment,
  getPendingChanges: mocks.getPendingChanges,
}));
vi.mock('@/actions/git/workflow', () => ({ getGitWorkspaceStatus: mocks.getGitWorkspaceStatus }));
vi.mock('@/actions/integrations', () => ({
  listProjectIntegrations: mocks.listProjectIntegrations,
  getProjectIntegration: mocks.getProjectIntegration,
}));

const principal = {
  apiKey: { id: 'key-1', name: 'test', scopes: [...MCP_SCOPES], expiresAt: new Date('2030-01-01T00:00:00.000Z') },
  project: { id: 'project-1', name: 'Docs', organizationId: 'org-1' },
};

const createProtocolClient = async (currentPrincipal: McpPrincipal = principal) => {
  const app = new Hono<HonoEnv>();
  let setup: Promise<ReturnType<typeof createNibleafMcpServer>> | undefined;
  app.get('/', async (ctx) => {
    ctx.set('requestId', 'request-1');
    const server = createNibleafMcpServer(ctx, currentPrincipal);
    setup = Promise.resolve(server);
    return ctx.text('ok');
  });
  await app.request('/');
  const server = await setup;
  if (!server) throw new Error('MCP test server was not created.');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();
  let nextId = 1;
  const waiting = new Map<number, (message: JSONRPCMessage) => void>();
  clientTransport.onmessage = (message) => {
    if ('id' in message && typeof message.id === 'number') waiting.get(message.id)?.(message);
  };
  const request = async <T>(method: string, params?: Record<string, unknown>) => {
    const id = nextId++;
    const response = new Promise<JSONRPCMessage>((resolve) => waiting.set(id, resolve));
    await clientTransport.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) } as JSONRPCMessage);
    const message = await response;
    waiting.delete(id);
    return message as JSONRPCMessage & { result?: T; error?: { code: number; message: string; data?: unknown } };
  };
  await request('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'nibleaf-test', version: '1.0.0' },
  });
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage);
  return { server, clientTransport, request };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.audit.mockResolvedValue({ id: 'audit-1' });
  mocks.getProject.mockResolvedValue({
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: { private: 'excluded' },
    _count: { pages: 1, deployments: 1, domains: 0 },
    languages: [],
    createdAt: new Date('2026-08-01T01:02:03.000Z'),
    updatedAt: new Date('2026-08-02T01:02:03.000Z'),
  });
  mocks.listPages.mockResolvedValue([
    {
      id: 'page-1',
      parentId: null,
      branchId: 'version-1',
      languageId: 'language-1',
      kind: 'PAGE',
      title: 'Intro',
      slug: 'intro',
      path: 'intro',
      icon: null,
      description: null,
      config: { private: 'excluded' },
      translationKey: null,
      position: 0,
      hidden: false,
      updatedAt: new Date('2026-08-02T01:02:03.000Z'),
    },
  ]);
  mocks.getPage.mockResolvedValue({
    id: 'page-1',
    projectId: 'project-1',
    parentId: null,
    branchId: 'version-1',
    languageId: 'language-1',
    kind: 'PAGE',
    title: 'Intro',
    slug: 'intro',
    path: 'intro',
    icon: null,
    description: null,
    content: '# Intro',
    config: { private: 'excluded' },
    translationKey: null,
    position: 0,
    hidden: false,
    createdAt: new Date('2026-08-01T01:02:03.000Z'),
    updatedAt: new Date('2026-08-02T01:02:03.000Z'),
  });
  mocks.listLanguages.mockResolvedValue([]);
  mocks.listBranches.mockResolvedValue([]);
  mocks.listExports.mockResolvedValue([]);
  mocks.listDeployments.mockResolvedValue([]);
  mocks.getPendingChanges.mockResolvedValue({ hasBaseline: false, lastVersion: null, lastPublishedAt: null, changes: [], redirectIssues: [] });
  mocks.getGitWorkspaceStatus.mockResolvedValue(null);
  mocks.getProjectSearchConfiguration.mockResolvedValue({
    configuration: {
      maxResults: 12,
      filtersEnabled: true,
      versionFilterEnabled: true,
      aiAnswers: false,
      hotkey: 'cmdk',
      placeholder: null,
    },
    constraints: { maxResults: { default: 12, min: 1, max: 50 } },
  });
  mocks.getProjectSearchIndexDiagnostics.mockResolvedValue({
    availability: { configured: false, reason: 'not_configured' },
    health: 'unavailable',
    runtime: 'shadow',
    index: {
      logicalId: 'nibleaf-hybrid-search',
      schemaVersion: 'v1',
      revisionId: null,
      deploymentVersion: null,
      embeddingModel: 'text-embedding-3-small',
      vectorSize: 1536,
    },
    corpus: { chunks: null, pages: null, languages: [], versions: [], distributionTruncated: { languages: false, versions: false } },
    latestRun: null,
    samples: { items: [], nextCursor: null, hasMore: false },
    issues: { staleCount: 0, failedCount: 0, items: [] },
  });
  mocks.getProjectUsageSummary.mockResolvedValue({
    schemaVersion: 1,
    projectId: 'project-1',
    period: { start: '2026-08-01T00:00:00.000Z', endExclusive: '2026-09-01T00:00:00.000Z', timezone: 'UTC' },
    availability: 'partial',
    plan: { key: 'starter', status: 'active' },
    meters: [
      {
        key: 'search_query',
        meterKey: 'search_query',
        unit: 'count',
        quantity: '9007199254740993',
        limit: null,
        availability: 'partial',
        behavior: 'block',
        enforcement: 'advisory',
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEndExclusive: '2026-09-01T00:00:00.000Z',
        state: 'unknown',
        ratio: null,
        allowed: true,
      },
    ],
    generatedAt: '2026-08-24T00:00:00.000Z',
  });
  mocks.getProjectEntitlements.mockResolvedValue({
    schemaVersion: 1,
    projectId: 'project-1',
    planKey: 'starter',
    availability: 'complete',
    entitlements: [
      {
        capabilityKey: 'addons.feedback',
        enabled: true,
        availability: 'complete',
        limit: null,
        meterKey: null,
        behavior: 'observe',
        enforcement: 'advisory',
      },
    ],
  });
  mocks.checkProjectEntitlement.mockResolvedValue({
    capabilityKey: 'addons.feedback',
    enabled: true,
    availability: 'complete',
    limit: null,
    meterKey: null,
    behavior: 'observe',
    enforcement: 'advisory',
  });
  const addon = {
    id: 'feedback',
    group: 'engagement',
    enabled: true,
    config: { placement: 'after-content', presentation: 'compact' },
    revision: 1,
    updatedAt: '2026-08-24T00:00:00.000Z',
    status: 'active',
    availability: {
      state: 'available',
      entitlement: 'addons.feedback',
      plans: ['starter'],
      schemaVersion: 1,
      projectId: 'project-1',
      capabilityKey: 'addons.feedback',
      decision: 'enabled',
      planKey: 'starter',
      source: 'plan',
      resolution: 'configured',
      behavior: 'observe',
      enforcement: 'advisory',
      available: true,
    },
  };
  mocks.listProjectAddons.mockResolvedValue([addon]);
  mocks.getProjectAddon.mockResolvedValue(addon);
  mocks.listProjectAddonAuditEvents.mockResolvedValue({ items: [], nextCursor: null });
  mocks.exportProjectTheme.mockResolvedValue({ template: { version: 1, kind: 'nibleaf-theme-template' }, json: '{}' });
  mocks.getProjectThemeCatalog.mockResolvedValue({
    schemaVersion: 1,
    repositorySchemaVersion: 1,
    runtimeContractVersion: 1,
    componentSchemaVersion: 1,
    current: { id: 'harbor', repositoryMetadata: {}, layout: {}, components: {} },
    presets: [],
    authoring: [],
  });
  const integration = {
    id: 'github',
    category: 'source_control',
    capabilities: ['read'],
    ownership: 'project',
    authKind: 'secret',
    lifecycle: 'adapter',
    supportsActivation: false,
    supportsCredentialFreeUpdate: false,
    supportsDelete: false,
    supportsPassiveVerification: true,
    verificationSideEffect: false,
    navigation: { settingsSection: 'git', documentation: { en: '/reference/integrations-engine', ar: '/ar/reference/integrations-engine' } },
    configFields: [{ key: 'secret', kind: 'secret', required: true, secret: true }],
    availability: 'available',
    connection: {
      id: 'git-1',
      providerId: 'github',
      category: 'source_control',
      ownership: 'project',
      status: 'active',
      health: { status: 'healthy', checkedAt: '2026-08-24T00:00:00.000Z', code: null },
      credential: { configured: true },
      config: { providerId: 'github', repository: 'org/docs', baseBranch: 'main', headBranch: 'nibleaf', contentPath: 'docs' },
      revision: 1,
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
      encryptedCredential: 'must-not-leak',
      rawProviderPayload: { token: 'must-not-leak' },
    },
  };
  mocks.listProjectIntegrations.mockResolvedValue([integration]);
  mocks.getProjectIntegration.mockResolvedValue(integration);
});

afterEach(() => vi.restoreAllMocks());

describe('Nibleaf MCP protocol surface', () => {
  it.each([
    ['mcp:connect', ['get_capabilities']],
    ['projects:read', ['get_capabilities', 'get_project']],
    ['pages:read', ['get_capabilities', 'get_page', 'list_pages']],
    ['languages:read', ['get_capabilities', 'list_languages']],
    ['versions:read', ['get_capabilities', 'list_versions']],
    ['analytics:read', ['get_analytics_overview', 'get_capabilities']],
    ['search:read', ['get_capabilities', 'get_search_configuration', 'get_search_index_diagnostics']],
    ['usage:read', ['get_capabilities', 'get_usage_summary']],
    ['entitlements:read', ['check_entitlement', 'get_capabilities', 'get_entitlements']],
    ['addons:read', ['get_addon', 'get_capabilities', 'list_addon_audit_events', 'list_addons']],
    ['themes:read', ['get_capabilities', 'get_theme_catalog', 'get_theme_template', 'preview_theme_import']],
    ['exports:read', ['get_capabilities', 'get_export', 'list_exports']],
    ['deployments:read', ['get_capabilities', 'get_deployment', 'get_pending_changes', 'list_deployments']],
    ['integrations:read', ['get_capabilities', 'get_git_integration_status', 'get_integration', 'list_integrations']],
  ] as const)('registers only the tools granted by %s', async (scope, expectedTools) => {
    const scopedPrincipal: McpPrincipal = {
      ...principal,
      apiKey: { ...principal.apiKey, scopes: scope === 'mcp:connect' ? ['mcp:connect'] : ['mcp:connect', scope] },
    };
    const { server, clientTransport, request } = await createProtocolClient(scopedPrincipal);
    const tools = await request<{ tools: Array<{ name: string }> }>('tools/list');
    expect(tools.result?.tools.map(({ name }) => name).sort()).toEqual([...expectedTools].sort());
    await clientTransport.close();
    await server.close();
  });

  it('keeps capability discovery aligned with protocol tool and resource lists', async () => {
    const { server, clientTransport, request } = await createProtocolClient();
    const tools = await request<{ tools: Array<{ name: string }> }>('tools/list');
    const resources = await request<{ resources: Array<{ uri: string }> }>('resources/list');
    const templates = await request<{ resourceTemplates: Array<{ uriTemplate: string }> }>('resources/templates/list');
    const capabilityCall = await request<{ structuredContent: { data: { tools: Array<{ name: string }>; resources: Array<{ uri: string }> } } }>(
      'tools/call',
      { name: 'get_capabilities', arguments: {} },
    );
    const discoveredTools = capabilityCall.result?.structuredContent.data.tools.map(({ name }) => name).sort();
    const listedTools = tools.result?.tools.map(({ name }) => name).sort();
    expect(discoveredTools).toEqual(listedTools);
    const listedResources = [
      ...(resources.result?.resources.map(({ uri }) => uri) ?? []),
      ...(templates.result?.resourceTemplates.map(({ uriTemplate }) => uriTemplate.replace('{projectId}', 'project-1')) ?? []),
    ].sort();
    expect(capabilityCall.result?.structuredContent.data.resources.map(({ uri }) => uri).sort()).toEqual(listedResources);
    await clientTransport.close();
    await server.close();
  });

  it('returns protocol content plus structured content with ISO dates and redacted fields', async () => {
    const { server, clientTransport, request } = await createProtocolClient();
    const response = await request<{
      content: Array<{ text: string }>;
      structuredContent: { ok: true; data: { createdAt: string; config?: unknown } };
      isError?: boolean;
    }>('tools/call', { name: 'get_project', arguments: {} });
    expect(response.result?.isError).not.toBe(true);
    expect(response.result?.content[0]?.text).toContain('2026-08-01T01:02:03.000Z');
    expect(response.result?.structuredContent.data.createdAt).toBe('2026-08-01T01:02:03.000Z');
    expect(response.result?.structuredContent.data).not.toHaveProperty('config');
    await clientTransport.close();
    await server.close();
  });

  it('maps a different-project page URI to protocol resource not-found without disclosure', async () => {
    const { server, clientTransport, request } = await createProtocolClient();
    const response = await request('resources/read', { uri: 'nibleaf://projects/project-2/pages/page-1' });
    expect(response.error?.code).toBe(-32_602);
    expect(response.error?.data).toEqual({ uri: 'nibleaf://projects/project-2/pages/page-1' });
    expect(mocks.getPage).not.toHaveBeenCalled();
    await clientTransport.close();
    await server.close();
  });

  it('scopes a page resource lookup to the bound project', async () => {
    const { server, clientTransport, request } = await createProtocolClient();
    const response = await request<{ contents: Array<{ text: string }> }>('resources/read', {
      uri: 'nibleaf://projects/project-1/pages/page-1',
    });
    expect(response.error).toBeUndefined();
    expect(mocks.getPage).toHaveBeenCalledWith('project-1', 'page-1');
    expect(response.result?.contents[0]?.text).toContain('"versionId":"version-1"');
    await clientTransport.close();
    await server.close();
  });

  it('redacts search terms, preview bearer URLs, storage internals, snapshots, and raw errors', async () => {
    mocks.getAnalyticsOverview.mockResolvedValue({
      availability: 'complete',
      source: 'relational',
      range: '7d',
      timezone: 'UTC',
      totalViews: 12,
      uniqueVisitors: 4,
      timeseries: [],
      topPages: [],
      languages: [],
      devices: [],
      engagement: { engagedViews: null, averageEngagementMs: null },
      searches: {
        total: 3,
        zeroResults: 1,
        clickedResults: 2,
        averageLatencyMs: 14,
        topTerms: [{ query: 'private customer search', count: 3 }],
        queryTerms: 'legacy',
      },
      ai: { answersCompleted: null, answersFailed: null, promptTokens: null, completionTokens: null, costMicros: null, averageLatencyMs: null },
      noAnswerReasons: [],
    });
    mocks.getGitWorkspaceStatus.mockResolvedValue({
      id: 'git-1',
      provider: 'github',
      repository: 'org/docs',
      baseBranch: 'main',
      headBranch: 'nibleaf',
      importBranchId: 'version-1',
      importLanguageId: 'language-1',
      contentPath: 'private/docs',
      lastSyncStatus: 'READY',
      lastSyncError: 'provider secret error',
      lastSyncedAt: new Date('2026-08-02T01:02:03.000Z'),
      credentialConfigured: true,
      webhookConfigured: true,
      operations: [],
      pullRequests: [
        {
          id: 'pr-1',
          number: 7,
          url: 'https://github.com/org/docs/pull/7',
          title: 'Docs',
          state: 'OPEN',
          draft: false,
          baseBranch: 'main',
          headBranch: 'docs',
          headSha: 'abc123',
          previews: [
            {
              url: '/git-preview/bearer-preview-token',
              status: 'READY',
              error: 'storage secret error',
              createdAt: new Date('2026-08-02T01:02:03.000Z'),
              completedAt: new Date('2026-08-02T01:03:03.000Z'),
            },
          ],
          updatedAt: new Date('2026-08-02T01:02:03.000Z'),
        },
      ],
      auditEvents: [],
      createdAt: new Date('2026-08-01T01:02:03.000Z'),
      updatedAt: new Date('2026-08-02T01:02:03.000Z'),
    });
    mocks.listExports.mockResolvedValue([
      {
        id: 'export-1',
        formats: ['HTML'],
        status: 'READY',
        trigger: 'MANUAL',
        attempts: 1,
        error: 'raw export failure',
        snapshot: {
          deploymentVersion: 2,
          pagesCount: 3,
          createdAt: new Date('2026-08-01T01:02:03.000Z'),
          content: 'private immutable snapshot',
        },
        schedule: null,
        artifacts: [
          {
            id: 'artifact-1',
            format: 'HTML',
            fileName: 'docs.zip',
            contentType: 'application/zip',
            size: 10,
            storageKey: 'private/storage/key',
            checksum: 'private-checksum',
            createdAt: new Date('2026-08-02T01:02:03.000Z'),
          },
        ],
        createdAt: new Date('2026-08-01T01:02:03.000Z'),
        startedAt: new Date('2026-08-01T01:02:04.000Z'),
        completedAt: new Date('2026-08-01T01:02:05.000Z'),
        expiresAt: new Date('2026-09-01T01:02:05.000Z'),
      },
    ]);

    const { server, clientTransport, request } = await createProtocolClient();
    const analytics = await request('tools/call', { name: 'get_analytics_overview', arguments: { range: '7d' } });
    const git = await request('tools/call', { name: 'get_git_integration_status', arguments: {} });
    const exports = await request('tools/call', { name: 'list_exports', arguments: {} });
    const serialized = JSON.stringify([analytics.result, git.result, exports.result]);
    expect(serialized).not.toContain('private customer search');
    expect(serialized).not.toContain('topTerms');
    expect(serialized).not.toContain('queryTerms');
    expect(serialized).not.toContain('bearer-preview-token');
    expect(serialized).not.toContain('private/docs');
    expect(serialized).not.toContain('provider secret error');
    expect(serialized).not.toContain('private/storage/key');
    expect(serialized).not.toContain('private-checksum');
    expect(serialized).not.toContain('private immutable snapshot');
    expect(serialized).not.toContain('raw export failure');
    expect(serialized).toContain('"available":true');
    expect(serialized).toContain('"errorCode":"export_failed"');
    await clientTransport.close();
    await server.close();
  });

  it('normalizes the baseline relational search aggregate without exposing top terms', async () => {
    mocks.getAnalyticsOverview.mockResolvedValue({
      availability: 'complete',
      source: 'relational',
      range: '7d',
      timezone: 'UTC',
      totalViews: 0,
      uniqueVisitors: 0,
      timeseries: [],
      topPages: [],
      languages: [],
      devices: [],
      engagement: { engagedViews: null, averageEngagementMs: null },
      searches: { total: 2, topTerms: [{ query: 'must stay private', count: 2 }] },
      ai: { answersCompleted: null, answersFailed: null, promptTokens: null, completionTokens: null, costMicros: null, averageLatencyMs: null },
      noAnswerReasons: [],
    });
    const { server, clientTransport, request } = await createProtocolClient();
    const response = await request<{
      isError?: boolean;
      structuredContent: {
        data: { searches: { total: number; zeroResults: number | null; clickedResults: number | null; averageLatencyMs: number | null } };
      };
    }>('tools/call', { name: 'get_analytics_overview', arguments: { range: '7d' } });
    expect(response.result?.isError).not.toBe(true);
    expect(response.result?.structuredContent.data.searches).toEqual({
      total: 2,
      zeroResults: null,
      clickedResults: null,
      averageLatencyMs: null,
    });
    expect(JSON.stringify(response.result)).not.toContain('must stay private');
    expect(JSON.stringify(response.result)).not.toContain('topTerms');
    await clientTransport.close();
    await server.close();
  });

  it('returns only approved search diagnostics fields and excludes physical/provider data', async () => {
    mocks.getProjectSearchIndexDiagnostics.mockResolvedValueOnce({
      availability: { configured: true, reason: null },
      health: 'ready',
      runtime: 'hybrid',
      index: {
        logicalId: 'nibleaf-hybrid-search',
        schemaVersion: 'v1',
        revisionId: 'deployment-1',
        deploymentVersion: 3,
        embeddingModel: 'text-embedding-3-small',
        vectorSize: 1536,
        alias: 'private-alias',
        collection: 'physical-collection',
      },
      corpus: { chunks: 3, pages: 1, languages: [], versions: [], distributionTruncated: { languages: false, versions: false } },
      latestRun: null,
      samples: { items: [], nextCursor: null, hasMore: false },
      issues: { staleCount: 0, failedCount: 0, items: [] },
      content: 'private authored content',
      vector: [0.1, 0.2],
      hash: 'private-hash',
      providerPayload: { raw: 'private-provider-payload' },
    });
    const { server, clientTransport, request } = await createProtocolClient();
    const response = await request<{ isError?: boolean; structuredContent: { data: { index: { logicalId: string } } } }>('tools/call', {
      name: 'get_search_index_diagnostics',
      arguments: { limit: 10 },
    });
    expect(response.result?.isError).not.toBe(true);
    expect(response.result?.structuredContent.data.index.logicalId).toBe('nibleaf-hybrid-search');
    const serialized = JSON.stringify(response.result);
    expect(serialized).not.toContain('private-alias');
    expect(serialized).not.toContain('physical-collection');
    expect(serialized).not.toContain('private authored content');
    expect(serialized).not.toContain('private-hash');
    expect(serialized).not.toContain('private-provider-payload');
    expect(serialized).not.toContain('[0.1,0.2]');
    await clientTransport.close();
    await server.close();
  });

  it('preserves exact usage decimals and advisory unknown states', async () => {
    const { server, clientTransport, request } = await createProtocolClient();
    const response = await request<{
      isError?: boolean;
      structuredContent: { data: { meters: Array<{ quantity: string | null; limit: string | null; enforcement: string }> } };
    }>('tools/call', { name: 'get_usage_summary', arguments: {} });
    expect(response.result?.isError).not.toBe(true);
    expect(response.result?.structuredContent.data.meters[0]).toMatchObject({
      quantity: '9007199254740993',
      limit: null,
      enforcement: 'advisory',
    });
    await clientTransport.close();
    await server.close();
  });

  it('removes integration credentials, raw payloads, and secret manifest fields', async () => {
    const { server, clientTransport, request } = await createProtocolClient();
    const response = await request('tools/call', { name: 'list_integrations', arguments: {} });
    const serialized = JSON.stringify(response.result);
    expect(serialized).toContain('"configured":true');
    expect(serialized).not.toContain('encryptedCredential');
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).not.toContain('rawProviderPayload');
    expect(serialized).not.toContain('configFields');
    await clientTransport.close();
    await server.close();
  });

  it('maps unexpected action failures to a stable error without leaking the original message', async () => {
    mocks.getProject.mockRejectedValueOnce(new Error('private database connection detail'));
    const { server, clientTransport, request } = await createProtocolClient();
    const response = await request<{ isError: boolean; structuredContent: { error: { code: string } }; content: Array<{ text: string }> }>(
      'tools/call',
      { name: 'get_project', arguments: {} },
    );
    expect(response.result?.isError).toBe(true);
    expect(response.result?.structuredContent.error.code).toBe('http:internal');
    expect(JSON.stringify(response.result)).not.toContain('private database connection detail');
    await clientTransport.close();
    await server.close();
  });

  it('does not report success when the append-only audit cannot be persisted', async () => {
    mocks.audit.mockRejectedValueOnce(new AppError({ code: 'storage:error', message: 'audit unavailable' }));
    const { server, clientTransport, request } = await createProtocolClient();
    const response = await request<{ isError: boolean; structuredContent: { error: { code: string } }; content: Array<{ text: string }> }>(
      'tools/call',
      {
        name: 'get_project',
        arguments: {},
      },
    );
    expect(response.result?.isError).toBe(true);
    expect(response.result?.structuredContent.error.code).toBe('storage:error');
    expect(response.result?.content[0]?.text).toContain('storage:error');
    await clientTransport.close();
    await server.close();
  });
});
