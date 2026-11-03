import { decodeEncryptionKey, encryptSecret } from '@nibleaf/shared/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ project: vi.fn(), connection: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: { project: { findUnique: db.project }, projectIntegration: { findUnique: db.connection } } }));

import { resolveWorkspaceAi } from './workspace';

const key = Buffer.alloc(32, 13).toString('base64');
const encrypted = (projectId = 'workspace-a', providerId = 'openai', apiKey = 'workspace-owned-secret') =>
  encryptSecret(JSON.stringify({ kind: 'workspace-ai', projectId, providerId, apiKey }), decodeEncryptionKey(key));
const connection = (overrides = {}) => ({
  id: 'connection-a',
  revision: 1,
  status: 'ACTIVE',
  lastVerificationStatus: 'HEALTHY',
  config: { answerModel: 'gpt-test', embeddingModel: 'openai/text-embedding-3-small' },
  credentialEncrypted: encrypted(),
  ...overrides,
});

describe('workspace AI credential ownership', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OPENROUTER_API_KEY', 'instance-secret-must-not-be-used');
    vi.stubEnv('INTEGRATION_CREDENTIAL_ENCRYPTION_KEY', key);
    vi.stubEnv('INTEGRATION_CREDENTIAL_PREVIOUS_KEYS', '');
    vi.stubEnv('SEARCH_EMBEDDING_MODEL', 'openai/text-embedding-3-small');
    db.project.mockResolvedValue({ config: { search: { aiProvider: 'openai' } } });
    db.connection.mockResolvedValue(connection());
  });

  it('uses the selected workspace key instead of the instance key', async () => {
    const value = await resolveWorkspaceAi('workspace-a');
    expect(value).toMatchObject({ providerId: 'openai', apiKey: 'workspace-owned-secret', answersEnabled: true, revision: 'connection-a:1' });
    expect(db.connection).toHaveBeenCalledWith({ where: { projectId_providerId: { projectId: 'workspace-a', providerId: 'openai' } } });
  });

  it('turns off provider access without deleting the stored key', async () => {
    db.project.mockResolvedValue({ config: { search: { aiProvider: 'disabled' } } });
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
    expect(db.connection).not.toHaveBeenCalled();
  });

  it.each([null, connection({ status: 'INACTIVE' }), connection({ lastVerificationStatus: 'UNHEALTHY' })])(
    'never silently falls back for a missing or invalid workspace connection',
    async (row) => {
      db.connection.mockResolvedValue(row);
      await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
    },
  );

  it('rejects a credential envelope copied from another workspace', async () => {
    db.connection.mockResolvedValue(connection({ credentialEncrypted: encrypted('workspace-b') }));
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
  });

  it('rejects a credential envelope copied from another provider', async () => {
    db.connection.mockResolvedValue(connection({ credentialEncrypted: encrypted('workspace-a', 'openrouter') }));
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
  });

  it('reads a changed credential revision on the next operation', async () => {
    const previous = await resolveWorkspaceAi('workspace-a');
    db.connection.mockResolvedValue(connection({ revision: 2, credentialEncrypted: encrypted('workspace-a', 'openai', 'new-workspace-secret') }));
    const next = await resolveWorkspaceAi('workspace-a');
    expect(previous?.revision).toBe('connection-a:1');
    expect(next).toMatchObject({ revision: 'connection-a:2', apiKey: 'new-workspace-secret' });
  });

  it('does not query a different embedding model against an existing index', async () => {
    db.connection.mockResolvedValue(connection({ config: { answerModel: 'gpt-test', embeddingModel: 'other/model' } }));
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toBeNull();
  });

  it('preserves the existing instance provider for unmodified workspaces', async () => {
    db.project.mockResolvedValue({ config: {} });
    await expect(resolveWorkspaceAi('workspace-a')).resolves.toMatchObject({
      providerId: 'openrouter',
      apiKey: 'instance-secret-must-not-be-used',
      revision: 'instance',
    });
  });
});
