import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), logError: vi.fn() }));

vi.mock('@nibleaf/database', () => ({ prisma: { mcpAuditEvent: { create: mocks.create } } }));
vi.mock('@nibleaf/logger', () => ({ createLogger: () => ({ error: mocks.logError }) }));

import { recordMcpAudit } from './audit';

const context = { get: (key: string) => (key === 'requestId' ? 'request-1' : undefined) } as never;
const principal = {
  apiKey: { id: 'key-1', name: 'Reader', scopes: ['mcp:connect'], expiresAt: new Date('2030-01-01T00:00:00.000Z') },
  project: { id: 'project-1', name: 'Docs', organizationId: 'org-1' },
} as never;

describe('MCP audit persistence failure', () => {
  it('logs only the error class and safe request ID before failing closed', async () => {
    mocks.create.mockRejectedValueOnce(new TypeError('sensitive database detail'));

    await expect(
      recordMcpAudit(context, principal, {
        kind: 'tool',
        operation: 'get_project',
        capability: 'projects:read',
        outcome: 'succeeded',
        durationMs: 1,
      }),
    ).rejects.toMatchObject({ code: 'storage:error' });

    expect(mocks.logError).toHaveBeenCalledWith({ errorName: 'TypeError', requestId: 'request-1' }, 'MCP audit persistence failed');
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain('sensitive database detail');
  });
});
