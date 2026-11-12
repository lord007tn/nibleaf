import { InMemoryTransport, type JSONRPCMessage, LATEST_PROTOCOL_VERSION, McpServer } from '@modelcontextprotocol/server';
import type { MemberRole } from '@nibleaf/shared/constants';
import { MCP_SCOPES, type McpScope } from '@nibleaf/shared/mcp';
import { MAX_PAGE_CONTENT_BYTES } from '@nibleaf/shared/page-limits';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { registerContentSurface } from './content';
import { nearIdenticalTitles, registerContentWriteSurface } from './content-write';
import { MAX_MCP_MARKDOWN_BYTES } from './markdown';
import type { McpPrincipal } from './types';

type PageRow = {
  id: string;
  projectId: string;
  parentId: string | null;
  branchId: string;
  languageId: string;
  kind: 'PAGE' | 'GROUP';
  title: string;
  slug: string;
  path: string;
  icon: string | null;
  description: string | null;
  content: string;
  config: null;
  translationKey: string | null;
  position: number;
  hidden: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type IdempotencyRow = {
  id: string;
  projectId: string;
  apiKeyId: string;
  operation: string;
  clientRequestId: string;
  argsHash: string;
  status: string;
  result: unknown;
  expiresAt: Date;
};

const state = vi.hoisted(() => ({
  pages: [] as PageRow[],
  records: new Map<string, IdempotencyRow>(),
  deployments: [] as Array<{ id: string; version: number; status: string; commitMessage: string | null; createdAt?: Date }>,
  redirectIssues: [] as Array<{ code: string; message: string; sequence: string[]; rowIndexes: number[] }>,
  /** Project settings in the last READY snapshot; null means nothing was published yet. */
  publishedProject: null as Record<string, unknown> | null,
  tick: 0,
  sequence: 0,
}));

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  auditBegin: vi.fn(),
  auditSettle: vi.fn(),
  getPage: vi.fn(),
  createPage: vi.fn(),
  updatePage: vi.fn(),
  reorderPages: vi.fn(),
  getCurrentSnapshot: vi.fn(),
  getPendingChanges: vi.fn(),
  createDeployment: vi.fn(),
  listDeployments: vi.fn(),
  assertLanguageInProject: vi.fn(),
  assertBranchInProject: vi.fn(),
  getDefaultBranch: vi.fn(),
  pageFindMany: vi.fn(),
  queryRaw: vi.fn(),
  pageUpdateMany: vi.fn(),
  deploymentFindFirst: vi.fn(),
  domainFindMany: vi.fn(),
  idempotency: { deleteMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  env: {
    MCP_RATE_LIMIT_PER_MIN: 120,
    MCP_WRITE_RATE_LIMIT_PER_MIN: 50,
    MCP_PUBLISH_RATE_LIMIT_PER_HOUR: 6,
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
    SITE_BASE_DOMAIN: 'docs.example.test',
    APP_URL: 'https://app.example.test',
  },
}));

vi.mock('@/env', () => ({ env: mocks.env }));
vi.mock('./audit', () => ({ recordMcpAudit: mocks.audit, beginMcpWriteAudit: mocks.auditBegin, settleMcpWriteAudit: mocks.auditSettle }));
vi.mock('@nibleaf/database', () => ({
  prisma: {
    page: { findMany: mocks.pageFindMany, updateMany: mocks.pageUpdateMany },
    deployment: { findFirst: mocks.deploymentFindFirst },
    domain: { findMany: mocks.domainFindMany },
    mcpIdempotencyRecord: mocks.idempotency,
    // Batch transactions resolve their queries; interactive ones run against the
    // same page client and roll the in-memory pages back when they throw.
    $transaction: async (work: unknown) => {
      if (typeof work !== 'function') return Promise.all(work as Promise<unknown>[]);
      const before = structuredClone(state.pages);
      try {
        return await (work as (tx: unknown) => Promise<unknown>)({
          $queryRaw: mocks.queryRaw,
          page: { findMany: mocks.pageFindMany, updateMany: mocks.pageUpdateMany },
        });
      } catch (error) {
        state.pages = before;
        throw error;
      }
    },
  },
}));
vi.mock('@/actions/pages', () => ({
  getPage: mocks.getPage,
  createPage: mocks.createPage,
  updatePage: mocks.updatePage,
  reorderPages: mocks.reorderPages,
}));
vi.mock('@/actions/deployments', () => ({
  getCurrentSnapshot: mocks.getCurrentSnapshot,
  getPendingChanges: mocks.getPendingChanges,
  createDeployment: mocks.createDeployment,
  listDeployments: mocks.listDeployments,
}));
vi.mock('@/actions/languages', () => ({ assertLanguageInProject: mocks.assertLanguageInProject }));
vi.mock('@/actions/branches', () => ({ assertBranchInProject: mocks.assertBranchInProject, getDefaultBranch: mocks.getDefaultBranch }));
vi.mock('@/actions/projects', () => ({}));
vi.mock('@/actions/exports', () => ({}));

const nextDate = () => new Date(Date.UTC(2026, 10, 6, 9, 0, 0, state.tick++));
const iso = (date: Date) => date.toISOString();
const languageCode = (languageId: string) => (languageId === 'lang-ar' ? 'ar' : 'en');

const page = (overrides: Partial<PageRow> = {}): PageRow => ({
  id: 'page-1',
  projectId: 'project-1',
  parentId: null,
  branchId: 'version-1',
  languageId: 'lang-en',
  kind: 'PAGE',
  title: 'Install guide',
  slug: 'install-guide',
  path: 'install-guide',
  icon: null,
  description: null,
  content: '# Install',
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-02T00:00:00.000Z'),
  ...overrides,
});

const pathOf = (row: PageRow): string => {
  const parent = row.parentId ? state.pages.find((candidate) => candidate.id === row.parentId) : undefined;
  return parent ? `${pathOf(parent)}/${row.slug}` : row.slug;
};

const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Record<string, unknown>[]).some((option) => matches(row, option));
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const operator = condition as Record<string, unknown>;
      if ('not' in operator) return row[key] !== operator.not;
      if ('notIn' in operator) return !(operator.notIn as unknown[]).includes(row[key]);
      if ('contains' in operator)
        return String(row[key] ?? '')
          .toLowerCase()
          .includes(String(operator.contains).toLowerCase());
      if ('lte' in operator) return (row[key] as Date) <= (operator.lte as Date);
      return true;
    }
    return row[key] === condition;
  });

const snapshot = () => ({
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: null,
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, config: null }],
    versions: [{ id: 'version-1', name: 'main', slug: 'main', isDefault: true }],
  },
  pages: state.pages.map(({ projectId: _projectId, branchId, languageId, createdAt, updatedAt, ...row }) => ({
    ...row,
    versionId: branchId,
    languageCode: languageCode(languageId),
    createdAt: iso(createdAt),
    updatedAt: iso(updatedAt),
  })),
  openapi: null,
  generatedAt: new Date().toISOString(),
});

let principalSequence = 0;
const makePrincipal = (overrides: { scopes?: McpScope[]; actor?: McpPrincipal['actor'] } = {}): McpPrincipal => ({
  credential: {
    kind: 'api_key',
    id: `key-${++principalSequence}`,
    name: 'Support bot',
    scopes: overrides.scopes ?? [...MCP_SCOPES],
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  },
  project: { id: 'project-1', name: 'Docs', organizationId: 'org-1' },
  actor: overrides.actor === undefined ? { userId: 'user-1', role: 'member' as MemberRole } : overrides.actor,
});

type ToolResponse = {
  isError?: boolean;
  structuredContent: {
    ok: boolean;
    data: Record<string, unknown> & { page?: Record<string, unknown> };
    meta?: { replayed?: boolean };
    error?: { code: string; message: string; retryable: boolean; data?: Record<string, unknown> };
  };
};

const connect = async (principal: McpPrincipal) => {
  const app = new Hono<HonoEnv>();
  let server: McpServer | undefined;
  app.get('/', (ctx) => {
    ctx.set('requestId', 'request-1');
    ctx.set('locale', 'en');
    server = new McpServer({ name: 'nibleaf-test', version: '0.0.0' });
    registerContentSurface(server, ctx, principal);
    registerContentWriteSurface(server, ctx, principal);
    return ctx.text('ok');
  });
  await app.request('/');
  if (!server) throw new Error('server not created');
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
    const message = (await response) as JSONRPCMessage & { result?: T; error?: { code: number; message: string } };
    waiting.delete(id);
    return message;
  };
  await request('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } });
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await request<ToolResponse>('tools/call', { name, arguments: args });
    if (!response.result) throw new Error(`no result for ${name}: ${JSON.stringify(response.error)}`);
    return response.result;
  };
  const close = async () => {
    await clientTransport.close();
    await server?.close();
  };
  return { request, call, close };
};

const lastAudit = () => mocks.audit.mock.calls.at(-1)?.[2] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryRaw.mockResolvedValue([]);
  state.pages = [page()];
  state.records = new Map();
  state.deployments = [];
  state.redirectIssues = [];
  state.publishedProject = null;
  state.tick = 0;
  state.sequence = 0;
  mocks.env.MCP_WRITE_RATE_LIMIT_PER_MIN = 50;
  mocks.env.MCP_PUBLISH_RATE_LIMIT_PER_HOUR = 6;
  mocks.audit.mockResolvedValue({ id: 'audit-row' });
  // A write's audit row is recorded before it runs and settled after; the test
  // sees the settled event as one `mocks.audit` call, as with a single insert.
  const begun = new Map<string, { principal: unknown; event: Record<string, unknown> }>();
  mocks.auditBegin.mockImplementation(async (_ctx: unknown, principal: unknown, event: Record<string, unknown>) => {
    const id = `audit-${begun.size + 1}`;
    begun.set(id, { principal, event });
    return id;
  });
  mocks.auditSettle.mockImplementation(async (ctx: unknown, id: string, settled: Record<string, unknown>) => {
    const row = begun.get(id);
    await mocks.audit(ctx, row?.principal, { ...row?.event, ...settled, target: settled.target ?? row?.event.target });
  });
  mocks.domainFindMany.mockResolvedValue([]);
  mocks.assertLanguageInProject.mockImplementation(async (_projectId: string, languageId: string) => {
    if (!['lang-en', 'lang-ar'].includes(languageId)) throw new AppError({ code: 'database:not_found', message: 'language not found' });
    return { id: languageId };
  });
  mocks.assertBranchInProject.mockImplementation(async (_projectId: string, branchId: string) => ({ id: branchId }));
  mocks.getDefaultBranch.mockResolvedValue({ id: 'version-1' });
  mocks.pageFindMany.mockImplementation(async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
    state.pages
      .filter((row) => matches(row, where))
      .slice(0, take ?? Number.POSITIVE_INFINITY)
      .map((row) => ({ ...row, language: { code: languageCode(row.languageId) } })),
  );
  mocks.getPage.mockImplementation(async (_projectId: string, id: string) => {
    const row = state.pages.find((candidate) => candidate.id === id);
    if (!row) throw new AppError({ code: 'database:not_found', message: 'page not found' });
    return { ...row };
  });
  mocks.createPage.mockImplementation(
    async (
      _projectId: string,
      body: { title: string; slug?: string; parentId?: string | null; languageId?: string; branchId?: string } & Partial<PageRow>,
    ) => {
      const parent = body.parentId ? state.pages.find((candidate) => candidate.id === body.parentId) : undefined;
      const languageId = parent?.languageId ?? body.languageId ?? 'lang-en';
      const branchId = parent?.branchId ?? body.branchId ?? 'version-1';
      const siblings = state.pages.filter((row) => row.parentId === (body.parentId ?? null) && row.languageId === languageId);
      const created = page({
        id: `page-new-${++state.sequence}`,
        parentId: body.parentId ?? null,
        branchId,
        languageId,
        kind: body.kind ?? 'PAGE',
        title: body.title,
        slug: body.slug ?? body.title.toLowerCase().replace(/\s+/g, '-'),
        icon: body.icon ?? null,
        description: body.description ?? null,
        content: body.content ?? '',
        translationKey: body.translationKey ?? null,
        position: siblings.length,
        createdAt: nextDate(),
        updatedAt: nextDate(),
      });
      created.path = pathOf(created);
      state.pages.push(created);
      return { ...created };
    },
  );
  mocks.updatePage.mockImplementation(
    async (_projectId: string, id: string, body: Partial<PageRow>, _userId: string, options?: { expectedUpdatedAt?: Date }) => {
      const row = state.pages.find((candidate) => candidate.id === id);
      if (!row) throw new AppError({ code: 'database:not_found', message: 'page not found' });
      if (options?.expectedUpdatedAt && row.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()) {
        throw new AppError({ code: 'database:conflict', message: 'changed', details: { id, reason: 'revision_conflict' } });
      }
      Object.assign(row, body, { updatedAt: nextDate() });
      row.path = pathOf(row);
      return { ...row };
    },
  );
  mocks.reorderPages.mockImplementation(
    async (_projectId: string, body: { items: Array<{ id: string; parentId: string | null; position: number }> }) => {
      for (const item of body.items) {
        const row = state.pages.find((candidate) => candidate.id === item.id);
        if (row) Object.assign(row, { parentId: item.parentId, position: item.position, updatedAt: nextDate() });
      }
      return [];
    },
  );
  mocks.pageUpdateMany.mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Partial<PageRow> }) => {
    const rows = state.pages.filter((row) => matches(row, where));
    for (const row of rows) Object.assign(row, data, { updatedAt: nextDate() });
    return { count: rows.length };
  });
  mocks.deploymentFindFirst.mockImplementation(async (query?: { where?: { status?: unknown } }) =>
    query?.where?.status === 'READY'
      ? state.publishedProject && { snapshot: { ...snapshot(), project: state.publishedProject } }
      : (state.deployments.find((deployment) => deployment.status === 'PENDING' || deployment.status === 'BUILDING') ?? null),
  );
  mocks.getCurrentSnapshot.mockImplementation(async () => snapshot());
  mocks.getPendingChanges.mockImplementation(async (_projectId: string, current: ReturnType<typeof snapshot>) => ({
    hasBaseline: false,
    lastVersion: null,
    lastPublishedAt: null,
    changes: current.pages.map((row) => ({
      id: row.id,
      title: row.title,
      path: row.path,
      languageCode: row.languageCode,
      kind: row.kind,
      status: 'added',
      fields: ['content'],
      additions: 1,
      deletions: 0,
      lines: [{ type: 'added', text: row.content, oldLine: null, newLine: 1 }],
      truncated: false,
    })),
    redirectIssues: state.redirectIssues,
  }));
  mocks.listDeployments.mockImplementation(async (_projectId: string, filter?: { status?: string }) =>
    [...state.deployments].filter((item) => !filter?.status || item.status === filter.status).sort((left, right) => right.version - left.version),
  );
  mocks.createDeployment.mockImplementation(async (_organizationId: string, _projectId: string, _userId: string, body: { message?: string }) => {
    const deployment = {
      id: `deployment-${state.deployments.length + 1}`,
      version: state.deployments.length + 1,
      status: 'PENDING',
      commitMessage: body.message ?? null,
    };
    state.deployments.push(deployment);
    return deployment;
  });
  mocks.idempotency.deleteMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    let count = 0;
    for (const [id, record] of state.records) {
      if (matches(record, where)) {
        state.records.delete(id);
        count += 1;
      }
    }
    return { count };
  });
  mocks.idempotency.create.mockImplementation(async ({ data }: { data: Omit<IdempotencyRow, 'id' | 'result'> }) => {
    for (const record of state.records.values()) {
      if (record.apiKeyId === data.apiKeyId && record.operation === data.operation && record.clientRequestId === data.clientRequestId) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
    }
    const id = `record-${state.records.size + 1}-${data.clientRequestId}`;
    state.records.set(id, { ...data, id, result: null });
    return { id };
  });
  mocks.idempotency.findUnique.mockImplementation(
    async ({ where }: { where: { apiKeyId_operation_clientRequestId: { apiKeyId: string; operation: string; clientRequestId: string } } }) => {
      const key = where.apiKeyId_operation_clientRequestId;
      return (
        [...state.records.values()].find(
          (record) => record.apiKeyId === key.apiKeyId && record.operation === key.operation && record.clientRequestId === key.clientRequestId,
        ) ?? null
      );
    },
  );
  mocks.idempotency.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<IdempotencyRow> }) => {
    const record = state.records.get(where.id);
    if (record) Object.assign(record, data);
    return { id: where.id };
  });
});

afterEach(() => vi.restoreAllMocks());

const WRITE_TOOLS = ['create_page_draft', 'move_page', 'set_page_visibility', 'translate_page', 'update_page'];
const PUBLISH_TOOLS = ['preview_publish', 'publish_changes'];

describe('MCP write tool registration', () => {
  it.each([
    [['mcp:connect'], []],
    [
      ['mcp:connect', 'pages:read'],
      ['get_page', 'list_pages', 'search_pages'],
    ],
    [['mcp:connect', 'pages:write'], WRITE_TOOLS],
    [['mcp:connect', 'deployments:publish'], PUBLISH_TOOLS],
  ] as const)('registers only the tools granted by %j', async (scopes, expected) => {
    const client = await connect(makePrincipal({ scopes: [...scopes] }));
    const tools = await client.request<{ tools: Array<{ name: string }> }>('tools/list');
    expect((tools.result?.tools ?? []).map(({ name }) => name).sort()).toEqual([...expected].sort());
    await client.close();
  });

  it('does not run a write tool whose scope is missing', async () => {
    const client = await connect(makePrincipal({ scopes: ['mcp:connect', 'pages:read'] }));
    const response = await client.request('tools/call', { name: 'update_page', arguments: { pageId: 'page-1' } });
    expect(JSON.stringify(response)).toContain('not found');
    expect(mocks.updatePage).not.toHaveBeenCalled();
    await client.close();
  });

  it('lists the real argument schema and annotations for write tools', async () => {
    const client = await connect(makePrincipal());
    const tools = await client.request<{
      tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown>; required?: string[] }; annotations: Record<string, boolean> }>;
    }>('tools/list');
    const byName = new Map(tools.result?.tools.map((tool) => [tool.name, tool]));
    expect(Object.keys(byName.get('update_page')?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['pageId', 'expectedRevision', 'markdown', 'clientRequestId']),
    );
    expect(byName.get('update_page')?.inputSchema.required).toEqual(expect.arrayContaining(['pageId', 'expectedRevision']));
    expect(byName.get('publish_changes')?.inputSchema.required).toEqual(expect.arrayContaining(['confirm', 'previewToken']));
    expect(byName.get('publish_changes')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(byName.get('create_page_draft')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(byName.get('preview_publish')?.annotations).toMatchObject({ readOnlyHint: true });
    for (const tool of tools.result?.tools ?? []) {
      expect(tool.annotations.readOnlyHint).toBe(!(WRITE_TOOLS.includes(tool.name) || tool.name === 'publish_changes'));
    }
    await client.close();
  });
});

describe('MCP write authorization', () => {
  it('refuses every write for a key without a live actor and audits the attempt', async () => {
    const client = await connect(makePrincipal({ actor: null }));
    for (const name of [...WRITE_TOOLS, ...PUBLISH_TOOLS]) {
      const response = await client.call(name, { pageId: 'page-1' });
      expect(response.structuredContent.error?.code).toBe('mcp:actor_required');
    }
    expect(mocks.createPage).not.toHaveBeenCalled();
    expect(mocks.updatePage).not.toHaveBeenCalled();
    expect(mocks.createDeployment).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledTimes(WRITE_TOOLS.length + PUBLISH_TOOLS.length);
    expect(lastAudit()).toMatchObject({ outcome: 'failed', errorCode: 'mcp:actor_required' });
    await client.close();
  });

  it('refuses a creator whose current role is below MEMBER', async () => {
    const client = await connect(makePrincipal({ actor: { userId: 'user-1', role: 'viewer' as MemberRole } }));
    const response = await client.call('set_page_visibility', {
      pageId: 'page-1',
      expectedRevision: iso(state.pages[0]?.updatedAt as Date),
      hidden: true,
    });
    expect(response.structuredContent.error?.code).toBe('auth:insufficient_role');
    expect(mocks.updatePage).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ operation: 'set_page_visibility', outcome: 'failed', target: { type: 'page', id: 'page-1' } });
    await client.close();
  });

  it('audits malformed arguments with the target taken from the raw call', async () => {
    const client = await connect(makePrincipal());
    const response = await client.call('update_page', {
      pageId: 'page-1',
      expectedRevision: 'yesterday',
      clientRequestId: 'retry-0001',
      bogus: true,
    });
    expect(response.isError).toBe(true);
    expect(response.structuredContent.error?.code).toBe('validation:failed');
    expect(response.structuredContent.error?.message).toContain('expectedRevision');
    expect(mocks.updatePage).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(lastAudit()).toEqual({
      kind: 'tool',
      operation: 'update_page',
      capability: 'pages:write',
      outcome: 'failed',
      errorCode: 'validation:failed',
      target: { type: 'page', id: 'page-1' },
      clientRequestId: 'retry-0001',
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('yesterday');
    await client.close();
  });

  it('enforces the per-key write budget, audits the rejection, and keeps other keys independent', async () => {
    mocks.env.MCP_WRITE_RATE_LIMIT_PER_MIN = 2;
    const principal = makePrincipal();
    const client = await connect(principal);
    const revision = () => iso(state.pages[0]?.updatedAt as Date);
    expect((await client.call('set_page_visibility', { pageId: 'page-1', expectedRevision: revision(), hidden: true })).isError).not.toBe(true);
    expect((await client.call('set_page_visibility', { pageId: 'page-1', expectedRevision: revision(), hidden: false })).isError).not.toBe(true);
    const limited = await client.call('set_page_visibility', { pageId: 'page-1', expectedRevision: revision(), hidden: true });
    expect(limited.structuredContent.error).toMatchObject({
      code: 'http:rate_limited',
      retryable: true,
      data: { retryAfterSeconds: expect.any(Number) },
    });
    expect(mocks.updatePage).toHaveBeenCalledTimes(2);
    expect(lastAudit()).toMatchObject({ outcome: 'failed', errorCode: 'http:rate_limited', target: { type: 'page', id: 'page-1' } });
    const other = await connect(makePrincipal());
    expect((await other.call('set_page_visibility', { pageId: 'page-1', expectedRevision: revision(), hidden: true })).isError).not.toBe(true);
    await client.close();
    await other.close();
  });
});

describe('write audit durability', () => {
  it('runs no write when its audit row cannot be recorded first', async () => {
    mocks.auditBegin.mockRejectedValueOnce(Object.assign(new Error('audit down'), { code: 'storage:error' }));
    const client = await connect(makePrincipal());
    const response = await client.call('create_page_draft', { title: 'Refund policy', markdown: 'Body' });
    expect(response.isError).toBe(true);
    expect(mocks.createPage).not.toHaveBeenCalled();
    await client.close();
  });

  it('keeps the started audit row when settling it fails after the write', async () => {
    mocks.auditSettle.mockRejectedValueOnce(new Error('audit down'));
    const client = await connect(makePrincipal());
    const response = await client.call('create_page_draft', { title: 'Refund policy', markdown: 'Body' });
    expect(mocks.createPage).toHaveBeenCalledOnce();
    expect(mocks.auditBegin).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ operation: 'create_page_draft', capability: 'pages:write' }),
    );
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({ ok: true, meta: { auditPending: true } });
    await client.close();
  });
});

describe('create_page_draft', () => {
  it('creates an unpublished draft from frontmatter Markdown with explicit arguments winning', async () => {
    const client = await connect(makePrincipal());
    const markdown =
      '---\r\ntitle: "From frontmatter"\r\ndescription: "Front description"\r\nicon: "book"\r\n---\r\n\r\n# Body\u0000\u0007\r\nLine\ttwo\r\n';
    const response = await client.call('create_page_draft', { title: 'Explicit title', markdown });
    expect(response.isError).not.toBe(true);
    expect(mocks.createPage).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        kind: 'PAGE',
        title: 'Explicit title',
        description: 'Front description',
        icon: 'book',
        content: '\n# Body\nLine\ttwo\n',
        parentId: null,
      }),
      'user-1',
    );
    const data = response.structuredContent.data;
    expect(data.page).toMatchObject({ id: 'page-new-1', title: 'Explicit title', revision: expect.any(String) });
    expect(data.publishState).toBe('unpublished');
    expect(String(data.note)).toContain('publish_changes');
    expect(lastAudit()).toMatchObject({ operation: 'create_page_draft', outcome: 'succeeded', target: { type: 'page', id: 'page-new-1' } });
    await client.close();
  });

  it('reports near-identical titles in the same language as possible duplicates', async () => {
    state.pages.push(page({ id: 'page-2', title: 'Billing FAQ', slug: 'billing-faq', path: 'billing-faq', position: 1 }));
    state.pages.push(page({ id: 'page-3', title: 'Billing FAQ', slug: 'billing-faq', path: 'billing-faq', languageId: 'lang-ar' }));
    const client = await connect(makePrincipal());
    const response = await client.call('create_page_draft', { title: 'Billing FAQs', markdown: 'Answers' });
    expect(response.structuredContent.data.possibleDuplicates).toEqual([expect.objectContaining({ id: 'page-2', title: 'Billing FAQ' })]);
    await client.close();
  });

  it('places the draft at an exact sibling position by renumbering siblings', async () => {
    state.pages.push(page({ id: 'page-2', slug: 'b', path: 'b', title: 'B', position: 1 }));
    const client = await connect(makePrincipal());
    const response = await client.call('create_page_draft', { title: 'First', markdown: '', position: 0 });
    // Positions only, each guarded by the expected parent: a concurrent move is never reverted.
    const guard = { projectId: 'project-1', branchId: 'version-1', languageId: 'lang-en', parentId: null };
    expect(mocks.pageUpdateMany.mock.calls.map(([call]) => call)).toEqual([
      { where: { ...guard, id: 'page-new-1', position: expect.any(Number) }, data: { position: 0 } },
      { where: { ...guard, id: 'page-1', position: 0 }, data: { position: 1 } },
      { where: { ...guard, id: 'page-2', position: 1 }, data: { position: 2 } },
    ]);
    expect(response.structuredContent.data.page).toMatchObject({ position: 0 });
    await client.close();
  });

  it('keeps a committed draft when the follow-up duplicate check fails', async () => {
    const client = await connect(makePrincipal());
    mocks.pageFindMany.mockRejectedValueOnce(new Error('database hiccup'));
    const response = await client.call('create_page_draft', { title: 'Webhooks', markdown: '# Webhooks', clientRequestId: 'draft-webhooks-1' });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent.data).toMatchObject({ possibleDuplicates: null, possibleDuplicatesUnavailable: true });
    const replay = await client.call('create_page_draft', { title: 'Webhooks', markdown: '# Webhooks', clientRequestId: 'draft-webhooks-1' });
    expect(replay.structuredContent.meta?.replayed).toBe(true);
    // The retry is told the duplicate check didn't run, as the first answer was.
    expect(replay.structuredContent.data).toMatchObject({ replayed: true, possibleDuplicatesUnavailable: true });
    expect(replay.structuredContent.data).not.toHaveProperty('possibleDuplicateIds');
    expect(mocks.createPage).toHaveBeenCalledOnce();
    await client.close();
  });

  it('requires a title and rejects markdown for groups and oversized documents', async () => {
    const client = await connect(makePrincipal());
    expect((await client.call('create_page_draft', { markdown: 'No title here' })).structuredContent.error?.code).toBe('validation:failed');
    expect((await client.call('create_page_draft', { title: 'Section', kind: 'GROUP', markdown: 'x' })).structuredContent.error?.code).toBe(
      'validation:failed',
    );
    const oversized = await client.call('create_page_draft', { title: 'Big', markdown: 'é'.repeat(70 * 1024) });
    expect(oversized.structuredContent.error).toMatchObject({ code: 'validation:failed' });
    expect(oversized.structuredContent.error?.message).toContain('128 KiB');
    expect(mocks.createPage).not.toHaveBeenCalled();
    const group = await client.call('create_page_draft', { title: 'Section', kind: 'GROUP' });
    expect(group.isError).not.toBe(true);
    expect(mocks.createPage).toHaveBeenCalledWith('project-1', expect.objectContaining({ kind: 'GROUP', content: '' }), 'user-1');
    await client.close();
  });

  it('rejects a languageId that contradicts the parent', async () => {
    const client = await connect(makePrincipal());
    const response = await client.call('create_page_draft', { title: 'Child', markdown: '', parentId: 'page-1', languageId: 'lang-ar' });
    expect(response.structuredContent.error?.code).toBe('http:bad_request');
    expect(mocks.createPage).not.toHaveBeenCalled();
    await client.close();
  });
});

describe('clientRequestId idempotency', () => {
  it('replays an identical retry without writing twice', async () => {
    const client = await connect(makePrincipal());
    const args = { title: 'Refunds', markdown: 'How refunds work', clientRequestId: 'draft-refunds-1' };
    const first = await client.call('create_page_draft', args);
    const second = await client.call('create_page_draft', { markdown: 'How refunds work', clientRequestId: 'draft-refunds-1', title: 'Refunds' });
    expect(mocks.createPage).toHaveBeenCalledOnce();
    expect(second.structuredContent.meta?.replayed).toBe(true);
    expect(second.structuredContent.data).toMatchObject({
      replayed: true,
      pageId: (first.structuredContent.data.page as { id: string }).id,
      revision: (first.structuredContent.data.page as { revision: string }).revision,
      status: 'created',
    });
    // Both answers link to the page in the editor: rebuilt from the bound website, token-free.
    const reviewUrl = 'https://app.example.test/app/projects/project-1/editor?page=page-new-1';
    expect(first.structuredContent.data.reviewUrl).toBe(reviewUrl);
    expect(second.structuredContent.data.reviewUrl).toBe(reviewUrl);
    // The stored replay record is compact: no title, content or links.
    const stored = JSON.stringify([...state.records.values()].map((record) => record.result));
    expect(stored).not.toContain('Refunds');
    expect(stored).not.toContain('How refunds work');
    expect(stored).not.toContain('reviewUrl');
    expect(stored).not.toContain('https://');
    expect(lastAudit()).toMatchObject({ outcome: 'replayed', clientRequestId: 'draft-refunds-1', target: { type: 'page', id: 'page-new-1' } });
    await client.close();
  });

  // Everything that says what happened or what to do next must survive a
  // replay; only the page's own details (and the caller's publish message)
  // are left to get_page / get_deployment.
  const expectReplayParity = (first: { structuredContent: { data: unknown } }, second: { structuredContent: { data: unknown } }) => {
    const firstData = first.structuredContent.data as Record<string, unknown>;
    const replay = second.structuredContent.data as Record<string, unknown>;
    expect(replay.replayed).toBe(true);
    for (const [key, value] of Object.entries(firstData)) {
      if (key === 'page' || key === 'possibleDuplicates' || key === 'message') continue;
      expect(replay[key], `replayed ${key}`).toEqual(value);
    }
  };

  it('replays a partial move with its placement warning and recovery step', async () => {
    state.pages.push(page({ id: 'group-1', kind: 'GROUP', title: 'Guides', slug: 'guides', path: 'guides', content: '', position: 1 }));
    state.pages.push(page({ id: 'child-1', parentId: 'group-1', title: 'A', slug: 'a', path: 'guides/a', position: 0 }));
    const original = mocks.pageFindMany.getMockImplementation();
    mocks.pageFindMany.mockImplementationOnce(async (...args: unknown[]) => {
      const rows = await original?.(...(args as Parameters<NonNullable<typeof original>>));
      Object.assign(state.pages.find((row) => row.id === 'child-1') as PageRow, { position: 5 });
      return rows;
    });
    const client = await connect(makePrincipal());
    const args = {
      pageId: 'page-1',
      expectedRevision: '2026-11-02T00:00:00.000Z',
      parentId: 'group-1',
      position: 0,
      clientRequestId: 'move-partial-0001',
    };
    const first = await client.call('move_page', args);
    expect(first.structuredContent.data).toMatchObject({ placed: false });
    // The client lost the first answer and retries the identical call.
    const second = await client.call('move_page', args);
    expect(mocks.updatePage).toHaveBeenCalledOnce();
    expect(second.structuredContent.data).toMatchObject({ replayed: true, status: 'moved', changed: true, placed: false });
    expect(String(second.structuredContent.data.note)).toContain('its position among the new siblings was not set');
    expect(String(second.structuredContent.data.note)).toContain('call move_page with position');
    expectReplayParity(first, second);
    await client.close();
  });

  it.each([
    [
      'create_page_draft',
      () => {
        // Placement fails after the page is committed, so the answer carries a placement warning.
        mocks.pageUpdateMany.mockRejectedValueOnce(new Error('placement write failed'));
        return { title: 'Refunds', markdown: 'How refunds work', position: 0, clientRequestId: 'parity-create-01' };
      },
    ],
    [
      'update_page',
      () => ({ pageId: 'page-1', expectedRevision: '2026-11-02T00:00:00.000Z', title: 'Installing', clientRequestId: 'parity-update-01' }),
    ],
    [
      'set_page_visibility',
      () => ({ pageId: 'page-1', expectedRevision: '2026-11-02T00:00:00.000Z', hidden: true, clientRequestId: 'parity-hide-0001' }),
    ],
    [
      'translate_page',
      () => {
        // The source's parent has no Arabic counterpart, so the answer carries a parentNote.
        state.pages = [
          page({ id: 'group-en', kind: 'GROUP', title: 'Guides', slug: 'guides', path: 'guides', content: '', translationKey: 'guides' }),
          page({ id: 'page-1', parentId: 'group-en', path: 'guides/install-guide' }),
        ];
        return {
          sourcePageId: 'page-1',
          sourceRevision: '2026-11-02T00:00:00.000Z',
          targetLanguageId: 'lang-ar',
          title: 'دليل التثبيت',
          markdown: 'نص',
          clientRequestId: 'parity-translate-1',
        };
      },
    ],
  ] as const)('replays %s with the same flags, warnings and next steps', async (tool, setup) => {
    const args = setup();
    const client = await connect(makePrincipal());
    const first = await client.call(tool, args);
    expect(first.isError).not.toBe(true);
    const second = await client.call(tool, args);
    expectReplayParity(first, second);
    if (tool === 'translate_page') expect(String(second.structuredContent.data.parentNote)).toContain('top level');
    if (tool === 'create_page_draft') {
      expect(first.structuredContent.data).toMatchObject({ placement: 'failed' });
      expect(second.structuredContent.data).toMatchObject({ placement: 'failed', placementNote: expect.stringContaining('use move_page') });
    }
    await client.close();
  });

  it('replays publish_changes with the same polling step', async () => {
    const client = await connect(makePrincipal());
    const preview = (await client.call('preview_publish')).structuredContent.data as { previewToken: string };
    const args = { confirm: true, previewToken: preview.previewToken, message: 'Refund policy', clientRequestId: 'parity-publish-01' };
    const first = await client.call('publish_changes', args);
    const second = await client.call('publish_changes', args);
    expect(mocks.createDeployment).toHaveBeenCalledOnce();
    expect(second.structuredContent.data).toMatchObject({ poll: { tool: 'get_deployment' } });
    expectReplayParity(first, second);
    // The caller's own message is not kept in the replay cache.
    expect(JSON.stringify([...state.records.values()].map((record) => record.result))).not.toContain('Refund policy');
    await client.close();
  });

  it('refuses the same clientRequestId with different arguments', async () => {
    const client = await connect(makePrincipal());
    await client.call('create_page_draft', { title: 'Refunds', markdown: 'A', clientRequestId: 'draft-refunds-1' });
    const conflict = await client.call('create_page_draft', { title: 'Refunds', markdown: 'B', clientRequestId: 'draft-refunds-1' });
    expect(conflict.structuredContent.error).toMatchObject({ code: 'mcp:idempotency_conflict', retryable: false });
    expect(mocks.createPage).toHaveBeenCalledOnce();
    expect(lastAudit()).toMatchObject({ outcome: 'failed', errorCode: 'mcp:idempotency_conflict' });
    await client.close();
  });

  it('reports a concurrent duplicate as in progress instead of writing', async () => {
    const principal = makePrincipal();
    state.records.set('record-race', {
      id: 'record-race',
      projectId: 'project-1',
      apiKeyId: principal.credential.id,
      operation: 'create_page_draft',
      clientRequestId: 'draft-refunds-1',
      argsHash: 'unknown-yet',
      status: 'pending',
      result: null,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    const client = await connect(principal);
    const response = await client.call('create_page_draft', { title: 'Refunds', markdown: 'A', clientRequestId: 'draft-refunds-1' });
    // Different hash than the pending winner: a conflict, never a second write.
    expect(response.structuredContent.error?.code).toBe('mcp:idempotency_conflict');
    const record = state.records.get('record-race');
    if (record) record.argsHash = (await import('./idempotency')).hashMcpArguments({ title: 'Refunds', markdown: 'A', kind: 'PAGE' });
    const pending = await client.call('create_page_draft', { title: 'Refunds', markdown: 'A', clientRequestId: 'draft-refunds-1' });
    expect(pending.structuredContent.error).toMatchObject({ code: 'mcp:idempotency_in_progress', retryable: true });
    expect(mocks.createPage).not.toHaveBeenCalled();
    await client.close();
  });

  it('releases the id when the write fails so a corrected retry runs', async () => {
    const client = await connect(makePrincipal());
    mocks.createPage.mockRejectedValueOnce(new AppError({ code: 'http:bad_request', message: 'nope' }));
    const failed = await client.call('create_page_draft', { title: 'Refunds', markdown: 'A', clientRequestId: 'draft-refunds-1' });
    expect(failed.structuredContent.error?.code).toBe('http:bad_request');
    expect(state.records.size).toBe(0);
    const retried = await client.call('create_page_draft', { title: 'Refunds', markdown: 'A', clientRequestId: 'draft-refunds-1' });
    expect(retried.isError).not.toBe(true);
    expect(mocks.createPage).toHaveBeenCalledTimes(2);
    await client.close();
  });

  it('prunes expired replay records lazily', async () => {
    const principal = makePrincipal();
    state.records.set('record-old', {
      id: 'record-old',
      projectId: 'project-1',
      apiKeyId: principal.credential.id,
      operation: 'create_page_draft',
      clientRequestId: 'draft-refunds-1',
      argsHash: 'other',
      status: 'completed',
      result: { pageId: 'page-old' },
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    const client = await connect(principal);
    const response = await client.call('create_page_draft', { title: 'Refunds', markdown: 'A', clientRequestId: 'draft-refunds-1' });
    expect(response.isError).not.toBe(true);
    expect(state.records.has('record-old')).toBe(false);
    expect(mocks.createPage).toHaveBeenCalledOnce();
    await client.close();
  });
});

describe('update_page', () => {
  it('requires the current revision and reports conflicts with the current revision', async () => {
    const client = await connect(makePrincipal());
    const response = await client.call('update_page', { pageId: 'page-1', expectedRevision: '2026-01-01T00:00:00.000Z', markdown: 'New' });
    expect(response.structuredContent.error).toMatchObject({
      code: 'mcp:revision_conflict',
      retryable: false,
      data: { pageId: 'page-1', currentRevision: '2026-11-02T00:00:00.000Z', expectedRevision: '2026-01-01T00:00:00.000Z' },
    });
    expect(response.structuredContent.error?.message).toContain('get_page');
    expect(mocks.updatePage).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ errorCode: 'mcp:revision_conflict', target: { type: 'page', id: 'page-1' } });
    const missing = await client.call('update_page', { pageId: 'page-1', markdown: 'New' });
    expect(missing.structuredContent.error?.code).toBe('validation:failed');
    await client.close();
  });

  it('turns an edit that lands between read and write into a revision conflict', async () => {
    const client = await connect(makePrincipal());
    mocks.updatePage.mockImplementationOnce(async () => {
      const row = state.pages[0] as PageRow;
      row.updatedAt = new Date('2026-11-03T00:00:00.000Z');
      throw new AppError({ code: 'database:conflict', message: 'changed', details: { id: 'page-1', reason: 'revision_conflict' } });
    });
    const response = await client.call('update_page', { pageId: 'page-1', expectedRevision: '2026-11-02T00:00:00.000Z', markdown: 'New' });
    expect(response.structuredContent.error).toMatchObject({ code: 'mcp:revision_conflict', data: { currentRevision: '2026-11-03T00:00:00.000Z' } });
    await client.close();
  });

  it('council: REST page conflicts retain the MCP revision-conflict contract', async () => {
    const client = await connect(makePrincipal());
    mocks.updatePage.mockImplementationOnce(async () => {
      const row = state.pages[0] as PageRow;
      row.updatedAt = new Date('2026-11-03T00:00:00.000Z');
      throw new AppError({ code: 'page:revision_conflict', message: 'changed', details: { id: 'page-1', reason: 'revision_conflict' } });
    });
    const response = await client.call('update_page', { pageId: 'page-1', expectedRevision: '2026-11-02T00:00:00.000Z', markdown: 'New' });
    expect(response.structuredContent.error).toMatchObject({ code: 'mcp:revision_conflict', data: { currentRevision: '2026-11-03T00:00:00.000Z' } });
    await client.close();
  });

  it('applies only changed fields through the conditional write', async () => {
    const client = await connect(makePrincipal());
    const response = await client.call('update_page', {
      pageId: 'page-1',
      expectedRevision: '2026-11-02T00:00:00.000Z',
      markdown: '---\ntitle: Install the app\n---\n# Install\r\nStep one',
      description: 'How to install',
    });
    expect(response.isError).not.toBe(true);
    expect(mocks.updatePage).toHaveBeenCalledWith(
      'project-1',
      'page-1',
      { title: 'Install the app', description: 'How to install', content: '# Install\nStep one' },
      'user-1',
      { expectedUpdatedAt: new Date('2026-11-02T00:00:00.000Z') },
    );
    expect(response.structuredContent.data).toMatchObject({ changed: true, changedFields: ['title', 'description', 'content'] });
    expect(response.structuredContent.data.page?.revision).not.toBe('2026-11-02T00:00:00.000Z');
    const unchanged = await client.call('update_page', {
      pageId: 'page-1',
      expectedRevision: response.structuredContent.data.page?.revision,
      title: 'Install the app',
    });
    expect(unchanged.structuredContent.data).toMatchObject({ changed: false });
    expect(mocks.updatePage).toHaveBeenCalledOnce();
    await client.close();
  });
});

describe('page content size cap through MCP', () => {
  const tooLarge = () =>
    new AppError({
      code: 'page:too_large',
      message: 'This page is too large (2 MB maximum). Split it into smaller pages.',
      details: { bytes: MAX_PAGE_CONTENT_BYTES + 1, limit: MAX_PAGE_CONTENT_BYTES },
    });

  it('never sends a body over the page cap: its own Markdown limit is far below it', () => {
    expect(MAX_MCP_MARKDOWN_BYTES).toBeLessThan(MAX_PAGE_CONTENT_BYTES);
  });

  it('writes a draft as a create and an edit as an update, so the cap rules apply to each', async () => {
    const client = await connect(makePrincipal());
    await client.call('create_page_draft', { title: 'New', markdown: 'Body' });
    expect(mocks.createPage).toHaveBeenCalledWith('project-1', expect.objectContaining({ content: 'Body' }), 'user-1');
    // A page stored over the cap (before the cap existed) can be shrunk through MCP:
    // the update is measured against the stored body, not refused for its size.
    (state.pages[0] as PageRow).content = 'x'.repeat(3 * 1024 * 1024);
    const shrink = await client.call('update_page', { pageId: 'page-1', expectedRevision: '2026-11-02T00:00:00.000Z', markdown: 'Short' });
    expect(shrink.isError).not.toBe(true);
    expect(mocks.updatePage).toHaveBeenCalledWith('project-1', 'page-1', { content: 'Short' }, 'user-1', expect.anything());
    expect(mocks.createPage).toHaveBeenCalledOnce();
    await client.close();
  });

  it('reports a refused write as page:too_large, not retryable', async () => {
    const client = await connect(makePrincipal());
    mocks.createPage.mockRejectedValueOnce(tooLarge());
    const created = await client.call('create_page_draft', { title: 'New', markdown: 'Body' });
    expect(created.structuredContent.error).toMatchObject({ code: 'page:too_large', retryable: false, message: expect.stringContaining('2 MB') });
    mocks.updatePage.mockRejectedValueOnce(tooLarge());
    const updated = await client.call('update_page', { pageId: 'page-1', expectedRevision: '2026-11-02T00:00:00.000Z', markdown: 'More' });
    expect(updated.structuredContent.error).toMatchObject({ code: 'page:too_large', retryable: false });
    expect(lastAudit()).toMatchObject({ outcome: 'failed', errorCode: 'page:too_large' });
    await client.close();
  });
});

describe('move_page', () => {
  it('reparents through the conditional write and renumbers siblings to the exact position', async () => {
    state.pages.push(page({ id: 'group-1', kind: 'GROUP', title: 'Guides', slug: 'guides', path: 'guides', content: '', position: 1 }));
    state.pages.push(page({ id: 'child-1', parentId: 'group-1', title: 'A', slug: 'a', path: 'guides/a', position: 0 }));
    state.pages.push(page({ id: 'child-2', parentId: 'group-1', title: 'B', slug: 'b', path: 'guides/b', position: 1 }));
    const client = await connect(makePrincipal());
    const response = await client.call('move_page', {
      pageId: 'page-1',
      expectedRevision: '2026-11-02T00:00:00.000Z',
      parentId: 'group-1',
      position: 1,
    });
    expect(response.isError).not.toBe(true);
    expect(mocks.updatePage).toHaveBeenCalledWith('project-1', 'page-1', { parentId: 'group-1' }, 'user-1', {
      expectedUpdatedAt: new Date('2026-11-02T00:00:00.000Z'),
    });
    const locks = mocks.queryRaw.mock.calls.map(([parts]) => parts.join('?'));
    expect(locks[0]).toContain('FROM "project" WHERE id =');
    expect(locks[0]).toContain('FOR NO KEY UPDATE');
    expect(locks[1]).toContain('ORDER BY id FOR NO KEY UPDATE');
    expect(mocks.queryRaw.mock.invocationCallOrder[1]).toBeLessThan(mocks.pageFindMany.mock.invocationCallOrder[0] ?? 0);
    const guard = { projectId: 'project-1', branchId: 'version-1', languageId: 'lang-en', parentId: 'group-1' };
    // Each write is a compare-and-set on the position that was read.
    expect(mocks.pageUpdateMany.mock.calls.map(([call]) => call)).toEqual([
      { where: { ...guard, id: 'page-1', position: 0 }, data: { position: 1 } },
      { where: { ...guard, id: 'child-2', position: 1 }, data: { position: 2 } },
    ]);
    expect(response.structuredContent.data.page).toMatchObject({ parentId: 'group-1', position: 1, path: 'guides/install-guide' });
    expect(lastAudit()).toMatchObject({ operation: 'move_page', outcome: 'succeeded', target: { type: 'page', id: 'page-1' } });
    await client.close();
  });

  it('preserves a competing page placement committed before the project lock', async () => {
    state.pages.push(page({ id: 'child-1', title: 'A', slug: 'a', path: 'a', position: 1 }));
    state.pages.push(page({ id: 'child-2', title: 'B', slug: 'b', path: 'b', position: 2 }));
    const original = mocks.updatePage.getMockImplementation();
    mocks.updatePage.mockImplementationOnce(async (...args: unknown[]) => {
      const rows = await original?.(...(args as Parameters<NonNullable<typeof original>>));
      // Another structural writer commits before placement takes the project lock.
      Object.assign(state.pages.find((row) => row.id === 'page-1') as PageRow, { position: 7 });
      return rows;
    });
    const client = await connect(makePrincipal());
    const response = await client.call('move_page', { pageId: 'page-1', expectedRevision: '2026-11-02T00:00:00.000Z', parentId: null, position: 2 });
    expect(response.structuredContent.error?.code).toBe('mcp:revision_conflict');
    expect(state.pages.map((row) => [row.id, row.position])).toEqual([
      ['page-1', 7],
      ['child-1', 1],
      ['child-2', 2],
    ]);
    await client.close();
  });

  it('reports a saved reparent whose position could not be set, instead of an error', async () => {
    state.pages.push(page({ id: 'group-1', kind: 'GROUP', title: 'Guides', slug: 'guides', path: 'guides', content: '', position: 1 }));
    state.pages.push(page({ id: 'child-1', parentId: 'group-1', title: 'A', slug: 'a', path: 'guides/a', position: 0 }));
    const original = mocks.pageFindMany.getMockImplementation();
    mocks.pageFindMany.mockImplementationOnce(async (...args: unknown[]) => {
      const rows = await original?.(...(args as Parameters<NonNullable<typeof original>>));
      Object.assign(state.pages.find((row) => row.id === 'child-1') as PageRow, { position: 5 });
      return rows;
    });
    const client = await connect(makePrincipal());
    const response = await client.call('move_page', {
      pageId: 'page-1',
      expectedRevision: '2026-11-02T00:00:00.000Z',
      parentId: 'group-1',
      position: 0,
      clientRequestId: 'move-retry-0001',
    });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent.data).toMatchObject({ changed: true, placed: false, page: { parentId: 'group-1' } });
    expect(String(response.structuredContent.data.note)).toContain('someone reordered them meanwhile');
    await client.close();
  });

  it('reports a conflict instead of undoing a move someone made between the move and the placement', async () => {
    state.pages.push(page({ id: 'group-1', kind: 'GROUP', title: 'Guides', slug: 'guides', path: 'guides', content: '', position: 1 }));
    state.pages.push(page({ id: 'group-2', kind: 'GROUP', title: 'FAQ', slug: 'faq', path: 'faq', content: '', position: 2 }));
    state.pages.push(page({ id: 'child-1', parentId: 'group-1', title: 'A', slug: 'a', path: 'guides/a', position: 0 }));
    const original = mocks.updatePage.getMockImplementation();
    mocks.updatePage.mockImplementationOnce(async (...args: unknown[]) => {
      const result = await original?.(...(args as Parameters<NonNullable<typeof original>>));
      // A person moves the page elsewhere right after our conditional write.
      Object.assign(state.pages.find((row) => row.id === 'page-1') as PageRow, { parentId: 'group-2', updatedAt: nextDate() });
      return result;
    });
    const client = await connect(makePrincipal());
    const response = await client.call('move_page', {
      pageId: 'page-1',
      expectedRevision: '2026-11-02T00:00:00.000Z',
      parentId: 'group-1',
      position: 0,
    });
    expect(response.structuredContent.error?.code).toBe('mcp:revision_conflict');
    // Their move stands: placement never writes parentId.
    expect((state.pages.find((row) => row.id === 'page-1') as PageRow).parentId).toBe('group-2');
    expect(mocks.pageUpdateMany.mock.calls.every(([call]) => !('parentId' in call.data))).toBe(true);
    await client.close();
  });

  it('refuses page writes while a publish is being built', async () => {
    state.deployments.push({ id: 'deployment-9', version: 9, status: 'BUILDING', commitMessage: null });
    const client = await connect(makePrincipal());
    const response = await client.call('update_page', { pageId: 'page-1', expectedRevision: '2026-11-02T00:00:00.000Z', title: 'Later' });
    expect(response.structuredContent.error).toMatchObject({ code: 'mcp:publish_in_progress', retryable: true });
    expect(mocks.updatePage).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ operation: 'update_page', outcome: 'failed', errorCode: 'mcp:publish_in_progress' });
    await client.close();
  });

  it('moves to the top level with parentId null and treats a same-place move as a no-op', async () => {
    state.pages.push(page({ id: 'group-1', kind: 'GROUP', title: 'Guides', slug: 'guides', path: 'guides', content: '', position: 1 }));
    state.pages.push(page({ id: 'child-1', parentId: 'group-1', slug: 'a', path: 'guides/a', position: 0 }));
    const client = await connect(makePrincipal());
    const noop = await client.call('move_page', { pageId: 'page-1', expectedRevision: '2026-11-02T00:00:00.000Z', parentId: null });
    expect(noop.structuredContent.data).toMatchObject({ changed: false });
    expect(mocks.updatePage).not.toHaveBeenCalled();
    const response = await client.call('move_page', { pageId: 'child-1', expectedRevision: '2026-11-02T00:00:00.000Z', parentId: null });
    expect(mocks.updatePage).toHaveBeenCalledWith('project-1', 'child-1', { parentId: null }, 'user-1', expect.anything());
    expect(response.structuredContent.data.page).toMatchObject({ parentId: null, position: 2 });
    await client.close();
  });

  it('refuses a stale revision', async () => {
    const client = await connect(makePrincipal());
    const response = await client.call('move_page', { pageId: 'page-1', expectedRevision: '2026-10-01T00:00:00.000Z', parentId: null, position: 0 });
    expect(response.structuredContent.error?.code).toBe('mcp:revision_conflict');
    expect(mocks.reorderPages).not.toHaveBeenCalled();
    await client.close();
  });
});

describe('translate_page', () => {
  it('links the source with a CAS-written translation key and maps the parent', async () => {
    state.pages = [
      page({ id: 'group-en', kind: 'GROUP', title: 'Guides', slug: 'guides', path: 'guides', content: '', translationKey: 'guides' }),
      page({
        id: 'group-ar',
        kind: 'GROUP',
        title: 'أدلة',
        slug: 'guides',
        path: 'guides',
        content: '',
        languageId: 'lang-ar',
        translationKey: 'guides',
      }),
      page({ id: 'page-1', parentId: 'group-en', path: 'guides/install-guide', icon: 'download' }),
    ];
    const client = await connect(makePrincipal());
    const response = await client.call('translate_page', {
      sourcePageId: 'page-1',
      sourceRevision: '2026-11-02T00:00:00.000Z',
      targetLanguageId: 'lang-ar',
      title: 'دليل التثبيت',
      markdown: '# التثبيت',
    });
    expect(response.isError).not.toBe(true);
    expect(mocks.updatePage).toHaveBeenCalledWith('project-1', 'page-1', { translationKey: 'page-1' }, 'user-1', {
      expectedUpdatedAt: new Date('2026-11-02T00:00:00.000Z'),
    });
    expect(mocks.createPage).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        title: 'دليل التثبيت',
        slug: 'install-guide',
        icon: 'download',
        content: '# التثبيت',
        parentId: 'group-ar',
        languageId: 'lang-ar',
        branchId: 'version-1',
        translationKey: 'page-1',
      }),
      'user-1',
    );
    expect(response.structuredContent.data).toMatchObject({ translationKey: 'page-1', parentMapped: true, sourcePageId: 'page-1' });
    expect(lastAudit()).toMatchObject({ operation: 'translate_page', target: { type: 'page', id: 'page-new-1' } });
    await client.close();
  });

  it('refuses when the language already has a variant and returns its id', async () => {
    state.pages = [
      page({ translationKey: 'install' }),
      page({ id: 'page-ar', languageId: 'lang-ar', translationKey: 'install', slug: 'tathbit', path: 'tathbit' }),
    ];
    const client = await connect(makePrincipal());
    const response = await client.call('translate_page', {
      sourcePageId: 'page-1',
      sourceRevision: '2026-11-02T00:00:00.000Z',
      targetLanguageId: 'lang-ar',
      title: 'x',
      markdown: 'y',
    });
    expect(response.structuredContent.error).toMatchObject({
      code: 'mcp:translation_exists',
      data: { pageId: 'page-ar', revision: expect.any(String) },
    });
    expect(mocks.createPage).not.toHaveBeenCalled();
    await client.close();
  });

  it('refuses to translate a source that changed after it was read', async () => {
    const client = await connect(makePrincipal());
    const response = await client.call('translate_page', {
      sourcePageId: 'page-1',
      sourceRevision: '2026-11-01T00:00:00.000Z',
      targetLanguageId: 'lang-ar',
      title: 'x',
      markdown: 'y',
    });
    expect(response.structuredContent.error).toMatchObject({ code: 'mcp:revision_conflict', data: { currentRevision: '2026-11-02T00:00:00.000Z' } });
    expect(mocks.createPage).not.toHaveBeenCalled();
    expect(mocks.updatePage).not.toHaveBeenCalled();
    await client.close();
  });

  it('finds an existing translation without a key at the same path', async () => {
    state.pages = [page({ translationKey: 'install' }), page({ id: 'page-ar', languageId: 'lang-ar', translationKey: null })];
    const client = await connect(makePrincipal());
    const response = await client.call('translate_page', {
      sourcePageId: 'page-1',
      sourceRevision: '2026-11-02T00:00:00.000Z',
      targetLanguageId: 'lang-ar',
      title: 'x',
      markdown: 'y',
    });
    expect(response.structuredContent.error).toMatchObject({ code: 'mcp:translation_exists', data: { pageId: 'page-ar' } });
    expect(mocks.createPage).not.toHaveBeenCalled();
    await client.close();
  });

  it('keeps existing path-paired variants paired when it introduces a key', async () => {
    state.pages = [page(), page({ id: 'page-fr', languageId: 'lang-fr' })];
    mocks.assertLanguageInProject.mockResolvedValue({ id: 'lang-ar' });
    const client = await connect(makePrincipal());
    const response = await client.call('translate_page', {
      sourcePageId: 'page-1',
      sourceRevision: '2026-11-02T00:00:00.000Z',
      targetLanguageId: 'lang-ar',
      title: 'تثبيت',
      markdown: 'نص',
    });
    expect(response.isError).not.toBe(true);
    expect(mocks.updatePage).toHaveBeenCalledWith('project-1', 'page-fr', { translationKey: 'page-1' }, 'user-1', expect.anything());
    expect(response.structuredContent.data).toMatchObject({ linkedVariantIds: ['page-fr'], parentMapped: null });
    await client.close();
  });

  it('places the translation at the top level when the parent has no translation', async () => {
    state.pages = [
      page({ id: 'group-en', kind: 'GROUP', slug: 'guides', path: 'guides', content: '' }),
      page({ parentId: 'group-en', path: 'guides/install-guide' }),
    ];
    const client = await connect(makePrincipal());
    const response = await client.call('translate_page', {
      sourcePageId: 'page-1',
      sourceRevision: '2026-11-02T00:00:00.000Z',
      targetLanguageId: 'lang-ar',
      title: 'تثبيت',
      markdown: 'نص',
    });
    expect(mocks.createPage).toHaveBeenCalledWith('project-1', expect.objectContaining({ parentId: null }), 'user-1');
    expect(response.structuredContent.data).toMatchObject({ parentMapped: false, parentNote: expect.stringContaining('move_page') });
    await client.close();
  });

  it('requires translated markdown for a page and refuses the source language', async () => {
    const client = await connect(makePrincipal());
    expect(
      (
        await client.call('translate_page', {
          sourcePageId: 'page-1',
          sourceRevision: '2026-11-02T00:00:00.000Z',
          targetLanguageId: 'lang-ar',
          title: 'x',
        })
      ).structuredContent.error?.code,
    ).toBe('validation:failed');
    expect(
      (
        await client.call('translate_page', {
          sourcePageId: 'page-1',
          sourceRevision: '2026-11-02T00:00:00.000Z',
          targetLanguageId: 'lang-en',
          title: 'x',
          markdown: 'y',
        })
      ).structuredContent.error?.code,
    ).toBe('http:bad_request');
    expect(mocks.createPage).not.toHaveBeenCalled();
    await client.close();
  });
});

describe('set_page_visibility', () => {
  it('hides a page through the conditional write and treats the current state as a no-op', async () => {
    const client = await connect(makePrincipal());
    const hidden = await client.call('set_page_visibility', { pageId: 'page-1', expectedRevision: '2026-11-02T00:00:00.000Z', hidden: true });
    expect(mocks.updatePage).toHaveBeenCalledWith('project-1', 'page-1', { hidden: true }, 'user-1', {
      expectedUpdatedAt: new Date('2026-11-02T00:00:00.000Z'),
    });
    expect(hidden.structuredContent.data).toMatchObject({ changed: true, page: { hidden: true } });
    const again = await client.call('set_page_visibility', {
      pageId: 'page-1',
      expectedRevision: hidden.structuredContent.data.page?.revision,
      hidden: true,
    });
    expect(again.structuredContent.data).toMatchObject({ changed: false });
    expect(mocks.updatePage).toHaveBeenCalledOnce();
    const stale = await client.call('set_page_visibility', { pageId: 'page-1', expectedRevision: '2026-11-02T00:00:00.000Z', hidden: false });
    expect(stale.structuredContent.error?.code).toBe('mcp:revision_conflict');
    await client.close();
  });
});

describe('search_pages', () => {
  it('ranks metadata matches first and returns bounded, untrusted snippets with revisions', async () => {
    state.pages = [
      page({
        id: 'page-1',
        title: 'Install guide',
        content: `${'Intro text. '.repeat(30)}Reset your password from the account menu. ${'More. '.repeat(30)}`,
      }),
      page({ id: 'page-2', title: 'Password reset', slug: 'password-reset', path: 'password-reset', content: 'Short' }),
      page({ id: 'page-3', title: 'Other version', content: 'password', branchId: 'version-2' }),
    ];
    const client = await connect(makePrincipal({ scopes: ['mcp:connect', 'pages:read'] }));
    const response = await client.call('search_pages', { query: 'password' });
    const results = response.structuredContent.data.results as Array<Record<string, unknown>>;
    expect(results.map((result) => result.id)).toEqual(['page-2', 'page-1']);
    expect(results[0]).toMatchObject({ matchedIn: 'title', languageCode: 'en', revision: '2026-11-02T00:00:00.000Z', hidden: false });
    expect(results[1]?.matchedIn).toBe('content');
    expect(String(results[1]?.snippet)).toContain('Reset your password');
    expect(String(results[1]?.snippet).length).toBeLessThan(200);
    expect(response.structuredContent.data.contentTrust).toBe('untrusted');
    expect(mocks.getDefaultBranch).toHaveBeenCalledWith('project-1');
    await client.close();
  });

  it('validates language filters and the query length', async () => {
    const client = await connect(makePrincipal({ scopes: ['mcp:connect', 'pages:read'] }));
    expect((await client.call('search_pages', { query: 'install', languageId: 'lang-xx' })).structuredContent.error?.code).toBe('database:not_found');
    expect((await client.call('search_pages', { query: 'a' })).isError).toBe(true);
    await client.close();
  });
});

describe('preview and publish', () => {
  const preview = async (client: Awaited<ReturnType<typeof connect>>) => {
    const response = await client.call('preview_publish');
    return response.structuredContent.data as Record<string, unknown> & { previewToken: string | null };
  };

  it('summarizes the project-wide pending set and binds a short-lived token to it', async () => {
    const client = await connect(makePrincipal());
    const data = await preview(client);
    expect(data).toMatchObject({
      scope: 'project',
      counts: { total: 1, added: 1, modified: 0, removed: 0 },
      changes: [{ pageId: 'page-1', title: 'Install guide', path: 'install-guide', languageCode: 'en', status: 'added', changedFields: ['content'] }],
      changesTruncated: false,
      redirectIssues: { count: 0, blocking: false, summary: null },
      blocking: false,
      canPublish: true,
      publishedSiteUrl: 'https://docs.docs.example.test',
      // Opens the dashboard's publish dialog; the link alone publishes nothing and carries no token.
      publishDialogUrl: 'https://app.example.test/app/projects/project-1/editor?publish=true',
      contentTrust: 'untrusted',
    });
    expect(String(data.publishDialogUrl)).not.toContain(String(data.previewToken));
    expect(String(data.notice)).toContain('project-wide');
    expect(String(data.nextStep)).toContain('explicitly approve');
    expect(data.previewToken).toMatch(/^v1\./);
    expect(JSON.stringify(data)).not.toContain('"lines"');
    expect(mocks.createDeployment).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ operation: 'preview_publish', outcome: 'succeeded', target: { type: 'project', id: 'project-1' } });
    await client.close();
  });

  it('caps the change list, prefers a live custom domain, and withholds tokens when blocked or empty', async () => {
    state.pages = Array.from({ length: 60 }, (_, index) => page({ id: `page-${index}`, slug: `p${index}`, path: `p${index}` }));
    mocks.domainFindMany.mockResolvedValueOnce([
      { domain: 'help.example.com', verified: true, isPrimary: true, dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' },
    ]);
    const client = await connect(makePrincipal());
    const capped = await preview(client);
    expect((capped.changes as unknown[]).length).toBe(50);
    expect(capped).toMatchObject({ changesTruncated: true, counts: { total: 60 }, publishedSiteUrl: 'https://help.example.com' });
    state.redirectIssues = [{ code: 'redirect_loop', message: 'Loop between a and b', sequence: ['a', 'b'], rowIndexes: [0] }];
    const blocked = await preview(client);
    expect(blocked).toMatchObject({ blocking: true, canPublish: false, previewToken: null, redirectIssues: { count: 1, blocking: true } });
    state.redirectIssues = [];
    state.pages = [];
    const empty = await preview(client);
    expect(empty).toMatchObject({ canPublish: false, previewToken: null, counts: { total: 0 } });
    await client.close();
  });

  it('tells the assistant to send the person to the dashboard when the change list is cut short', async () => {
    state.pages = Array.from({ length: 60 }, (_, index) => page({ id: `page-${index}`, slug: `p${index}`, path: `p${index}` }));
    const client = await connect(makePrincipal());
    const capped = await preview(client);
    expect(capped.nextStep).toContain('lists 50 of 60 changed pages');
    expect(capped.nextStep).toContain("dashboard's publish dialog");
    await client.close();
  });

  it('names pending site settings in the approval summary, and can publish settings alone', async () => {
    const published = snapshot().project;
    state.publishedProject = { ...published, name: 'Old docs', config: { theme: 'harbor' } };
    state.pages = [];
    const client = await connect(makePrincipal());
    const data = await preview(client);
    expect(data).toMatchObject({
      counts: { total: 0 },
      settings: { changed: true, changedFields: ['name', 'config.theme'] },
      canPublish: true,
    });
    expect(data.nextStep).toContain('Site settings will also change: name, config.theme.');
    const publishedSettings = await client.call('publish_changes', { confirm: true, previewToken: data.previewToken });
    expect(publishedSettings.isError).not.toBe(true);
    expect(mocks.createDeployment).toHaveBeenCalledOnce();
    await client.close();
  });

  it('publishes after confirm with a fresh token, attributing the key, and replays a retried publish', async () => {
    const client = await connect(makePrincipal());
    const { previewToken } = await preview(client);
    const args = { confirm: true, previewToken, message: 'Refund policy update', clientRequestId: 'publish-0001' };
    const published = await client.call('publish_changes', args);
    expect(published.isError).not.toBe(true);
    expect(mocks.createDeployment).toHaveBeenCalledWith(
      'org-1',
      'project-1',
      'user-1',
      { message: 'Refund policy update (via MCP key "Support bot")' },
      'en',
      expect.objectContaining({ project: expect.objectContaining({ id: 'project-1' }), pages: expect.any(Array) }),
    );
    expect(published.structuredContent.data).toMatchObject({
      deploymentId: 'deployment-1',
      version: 1,
      status: 'PENDING',
      poll: { tool: 'get_deployment', arguments: { id: 'deployment-1' } },
    });
    expect(lastAudit()).toMatchObject({ operation: 'publish_changes', outcome: 'succeeded', target: { type: 'deployment', id: 'deployment-1' } });
    const deploymentUrl = 'https://app.example.test/app/projects/project-1/publishes/deployment-1';
    expect(published.structuredContent.data.deploymentUrl).toBe(deploymentUrl);
    const replay = await client.call('publish_changes', args);
    expect(replay.structuredContent).toMatchObject({
      meta: { replayed: true },
      data: { deploymentId: 'deployment-1', replayed: true, deploymentUrl },
    });
    expect(mocks.createDeployment).toHaveBeenCalledOnce();
    // The same token cannot publish again: the new deployment changed the state it was bound to.
    const reuse = await client.call('publish_changes', { confirm: true, previewToken });
    expect(reuse.structuredContent.error?.code).toBe('mcp:preview_stale');
    await client.close();
  });

  it('requires confirm: true and a token before publishing', async () => {
    const client = await connect(makePrincipal());
    const { previewToken } = await preview(client);
    for (const args of [{ previewToken }, { confirm: false, previewToken }, { confirm: 'true', previewToken }]) {
      const response = await client.call('publish_changes', args);
      expect(response.structuredContent.error?.code).toBe('mcp:confirmation_required');
    }
    expect((await client.call('publish_changes', { confirm: true })).structuredContent.error?.code).toBe('validation:failed');
    expect(mocks.createDeployment).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ operation: 'publish_changes', outcome: 'failed' });
    await client.close();
  });

  it('refuses a stale preview when anything changed after it, without publishing', async () => {
    const client = await connect(makePrincipal());
    const { previewToken } = await preview(client);
    (state.pages[0] as PageRow).content = '# Install (edited by a colleague)';
    const response = await client.call('publish_changes', { confirm: true, previewToken });
    expect(response.structuredContent.error).toMatchObject({ code: 'mcp:preview_stale', retryable: false });
    expect(response.structuredContent.error?.message).toContain('Nothing was published');
    expect(mocks.createDeployment).not.toHaveBeenCalled();
    await client.close();
  });

  it('ignores timestamp-only churn between preview and publish', async () => {
    const client = await connect(makePrincipal());
    const { previewToken } = await preview(client);
    (state.pages[0] as PageRow).updatedAt = new Date('2026-11-05T00:00:00.000Z');
    expect((await client.call('publish_changes', { confirm: true, previewToken })).isError).not.toBe(true);
    await client.close();
  });

  it('refuses expired, forged, and other-person tokens', async () => {
    const principal = makePrincipal();
    const client = await connect(principal);
    const { previewToken } = await preview(client);
    const token = String(previewToken);
    const [version, payload, signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify(['user-1', 'project-1', 'digest', Date.now() + 60_000])).toString('base64url');
    expect(
      (await client.call('publish_changes', { confirm: true, previewToken: `${version}.${forgedPayload}.${signature}` })).structuredContent.error
        ?.code,
    ).toBe('mcp:preview_invalid');
    expect((await client.call('publish_changes', { confirm: true, previewToken: `${version}.${payload}.AAAA` })).structuredContent.error?.code).toBe(
      'mcp:preview_invalid',
    );
    expect((await client.call('publish_changes', { confirm: true, previewToken: 'not-a-token' })).structuredContent.error?.code).toBe(
      'mcp:preview_invalid',
    );
    // The token is bound to the person who saw the preview, not to any key.
    const other = await connect(makePrincipal({ actor: { userId: 'user-2', role: 'member' as MemberRole } }));
    expect((await other.call('publish_changes', { confirm: true, previewToken: token })).structuredContent.error?.code).toBe('mcp:preview_invalid');
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 11 * 60 * 1000);
    expect((await client.call('publish_changes', { confirm: true, previewToken: token })).structuredContent.error?.code).toBe('mcp:preview_expired');
    expect(mocks.createDeployment).not.toHaveBeenCalled();
    await client.close();
    await other.close();
  });

  it('lets one preview token publish only once, even when the project did not change', async () => {
    const principal = makePrincipal();
    const client = await connect(principal);
    const approved = await preview(client);
    // Another request already consumed this exact token (for example a concurrent retry).
    await mocks.idempotency.create({
      data: {
        projectId: 'project-1',
        apiKeyId: principal.credential.id,
        operation: 'publish_changes:preview_token',
        clientRequestId: (await import('node:crypto')).createHash('sha256').update(String(approved.previewToken)).digest('hex'),
        argsHash: 'preview-token',
        status: 'consumed',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const response = await client.call('publish_changes', { confirm: true, previewToken: approved.previewToken });
    expect(response.structuredContent.error?.code).toBe('mcp:preview_stale');
    expect(response.structuredContent.error?.message).toContain('already used');
    expect(mocks.createDeployment).not.toHaveBeenCalled();
    await client.close();
  });

  it('publishes a change that is only to navigation groups, which lists no page', async () => {
    // Pending changes list pages only; a renamed or removed group shows as
    // `upToDate: false` with no listed page.
    mocks.getPendingChanges.mockImplementation(async () => ({
      hasBaseline: true,
      upToDate: false,
      lastVersion: 1,
      lastPublishedAt: null,
      changes: [],
      redirectIssues: [],
    }));
    const client = await connect(makePrincipal());
    const data = await preview(client);
    expect(data).toMatchObject({ canPublish: true, counts: { total: 0 } });
    expect(String(data.nextStep)).toContain('site navigation');
    const published = await client.call('publish_changes', { confirm: true, previewToken: data.previewToken });
    expect(published.structuredContent.error?.code).toBeUndefined();
    expect(mocks.createDeployment).toHaveBeenCalledOnce();
    await client.close();
  });

  it('discloses navigation changes alongside page changes', async () => {
    mocks.getPendingChanges.mockImplementation(async () => ({
      hasBaseline: true,
      upToDate: false,
      groupsChanged: true,
      lastVersion: 1,
      lastPublishedAt: null,
      changes: [
        {
          id: 'page-1',
          title: 'Install',
          path: 'install',
          languageCode: 'en',
          kind: 'PAGE',
          status: 'modified',
          fields: ['content'],
          additions: 1,
          deletions: 0,
          lines: [],
          truncated: false,
        },
      ],
      redirectIssues: [],
    }));
    const client = await connect(makePrincipal());
    const data = await preview(client);
    expect(data).toMatchObject({ canPublish: true, counts: { total: 1 } });
    expect(String(data.nextStep)).toContain('site navigation also changes');
    await client.close();
  });

  it('reports nothing to publish and enforces the hourly publish budget', async () => {
    mocks.env.MCP_PUBLISH_RATE_LIMIT_PER_HOUR = 1;
    const client = await connect(makePrincipal());
    const first = await preview(client);
    expect((await client.call('publish_changes', { confirm: true, previewToken: first.previewToken })).isError).not.toBe(true);
    // While that publish is still building, another publish (or page write) waits.
    const second0 = await preview(client);
    const busy = await client.call('publish_changes', { confirm: true, previewToken: second0.previewToken });
    expect(busy.structuredContent.error).toMatchObject({ code: 'mcp:publish_in_progress', retryable: true });
    (state.deployments[0] as { status: string }).status = 'READY';
    (state.pages[0] as PageRow).content = 'second edit';
    const second = await preview(client);
    const limited = await client.call('publish_changes', { confirm: true, previewToken: second.previewToken });
    expect(limited.structuredContent.error).toMatchObject({ code: 'http:rate_limited', retryable: true });
    expect(limited.structuredContent.error?.message).toContain('Nothing was published');
    expect(mocks.createDeployment).toHaveBeenCalledOnce();
    expect(lastAudit()).toMatchObject({ operation: 'publish_changes', errorCode: 'http:rate_limited' });
    state.pages = [];
    const empty = await client.call('publish_changes', { confirm: true, previewToken: second.previewToken });
    expect(empty.structuredContent.error?.code).toBe('mcp:nothing_to_publish');
    await client.close();
  });
});

describe('page markdown resource', () => {
  it('serializes the page exactly like Git sync and stays bound to the project', async () => {
    state.pages = [page({ description: 'How to "install"', icon: 'download', content: '\n\n# Install\nRun it.' })];
    const client = await connect(makePrincipal({ scopes: ['mcp:connect', 'pages:read'] }));
    const response = await client.request<{ contents: Array<{ mimeType: string; text: string; _meta?: Record<string, unknown> }> }>(
      'resources/read',
      {
        uri: 'nibleaf://projects/project-1/pages/page-1/markdown',
      },
    );
    expect(response.result?.contents[0]).toEqual({
      uri: 'nibleaf://projects/project-1/pages/page-1/markdown',
      mimeType: 'text/markdown',
      text: '---\ntitle: "Install guide"\ndescription: "How to \\"install\\""\nicon: "download"\n---\n\n# Install\nRun it.',
      _meta: { pageId: 'page-1', revision: '2026-11-02T00:00:00.000Z', contentTrust: 'untrusted' },
    });
    const foreign = await client.request('resources/read', { uri: 'nibleaf://projects/project-2/pages/page-1/markdown' });
    expect(foreign.error?.code).toBe(-32_602);
    await client.close();
  });
});

describe('title similarity', () => {
  it.each([
    ['Billing FAQ', 'billing faq!', true],
    ['Billing FAQ', 'Billing FAQs', true],
    ['Reset your password', 'Reset your passwords', true],
    ['Install guide', 'Uninstall guide', false],
    ['API', 'SDK', false],
    ['دليل التثبيت', 'دليل التثبيت.', true],
  ])('%s ~ %s → %s', (left, right, expected) => {
    expect(nearIdenticalTitles(left, right)).toBe(expected);
  });
});

describe('untitled pages through MCP', () => {
  it('creates an untitled PAGE from an explicit empty title, as the dashboard does', async () => {
    const client = await connect(makePrincipal());
    const response = await client.call('create_page_draft', { title: '', markdown: 'Body' });
    expect(response.isError).not.toBe(true);
    expect(mocks.createPage).toHaveBeenCalledWith('project-1', expect.objectContaining({ kind: 'PAGE', title: '' }), expect.anything());
    // Untitled pages are not "possible duplicates" of each other.
    expect((response.structuredContent.data as { possibleDuplicates: unknown[] }).possibleDuplicates).toEqual([]);
    await client.close();
  });

  it('still asks for a title when none is given, and always for a GROUP', async () => {
    const client = await connect(makePrincipal());
    const missing = await client.call('create_page_draft', { markdown: 'Body' });
    expect(missing.structuredContent.error?.message).toContain('provide a title argument');
    const group = await client.call('create_page_draft', { title: ' ', kind: 'GROUP' });
    expect(group.structuredContent.error).toMatchObject({ code: 'validation:failed', message: expect.stringContaining('GROUP needs a title') });
    expect(mocks.createPage).not.toHaveBeenCalled();
    await client.close();
  });

  it('clears a PAGE title but never a GROUP name', async () => {
    state.pages.push(page({ id: 'group-1', kind: 'GROUP', title: 'Guides', slug: 'guides' }));
    const client = await connect(makePrincipal());
    const cleared = await client.call('update_page', { pageId: 'page-1', expectedRevision: '2026-11-02T00:00:00.000Z', title: '' });
    expect(cleared.isError).not.toBe(true);
    expect(mocks.updatePage).toHaveBeenCalledWith(
      'project-1',
      'page-1',
      expect.objectContaining({ title: '' }),
      expect.anything(),
      expect.anything(),
    );
    mocks.updatePage.mockClear();
    const group = await client.call('update_page', { pageId: 'group-1', expectedRevision: '2026-11-02T00:00:00.000Z', title: '' });
    expect(group.structuredContent.error?.message).toContain('GROUP needs a title');
    expect(mocks.updatePage).not.toHaveBeenCalled();
    await client.close();
  });

  it('reads an untitled page as "Untitled", flagged untitled', async () => {
    const first = state.pages[0] as { title: string };
    first.title = '';
    const client = await connect(makePrincipal());
    const read = await client.call('get_page', { pageId: 'page-1' });
    expect(read.structuredContent.data).toMatchObject({ id: 'page-1', title: 'Untitled', untitled: true });
    await client.close();
  });
});
