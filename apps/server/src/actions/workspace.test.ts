import { MemberRole } from '@nibleaf/shared/constants';
import { describe, expect, it, vi } from 'vitest';
import { getScopedWorkspaceSettings } from './workspace';

const metadata = {
  plan: 'free',
  notifications: { member_joined: true },
  integrations: { slack: { webhookUrl: 'https://hooks.slack.com/services/secret' } },
  git: { provider: 'github', repo: 'acme/docs', lastSyncStatus: 'ok', cloneUrl: 'https://user:tok@git.example.com/acme/docs.git?x=1' },
};

vi.mock('@nibleaf/database', () => ({
  prisma: {
    organization: { findUniqueOrThrow: async () => ({ id: 'org-1', name: 'Acme', slug: 'acme', metadata: JSON.stringify(metadata) }) },
    project: { count: async () => 1, findMany: async () => [{ id: 'website-1' }] },
    projectGitSettings: { findUnique: async () => ({ settings: metadata.git }) },
    projectLegacySettings: { findUnique: async () => ({ metadata: { integrations: metadata.integrations } }) },
    member: { count: async () => 3 },
  },
}));

vi.mock('./git-webhook-secret', () => ({
  getGitWebhookSecret: async () => 'f00d',
  readGitWebhookSecret: async () => ({ secret: 'f00d' }),
  moveLegacyWebhookSecret: async () => undefined,
  settleLegacyWebhookSecretIn: async () => undefined,
}));

describe('getScopedWorkspaceSettings: admin-only material never reaches Editors or Viewers', () => {
  it.each([MemberRole.OWNER, MemberRole.ADMIN])('returns the webhook secret and integrations to %s', async (role) => {
    const visible = await getScopedWorkspaceSettings('org-1', role);
    expect(visible.git).toEqual({ ...metadata.git, webhookSecret: 'f00d' });
    expect(visible.integrations).toEqual(metadata.integrations);
  });

  it.each([MemberRole.MEMBER, MemberRole.VIEWER, '', 'unknown'])('strips the webhook secret and integration blob for %j', async (role) => {
    const visible = await getScopedWorkspaceSettings('org-1', role);
    expect(visible.git).toEqual({ ...metadata.git, cloneUrl: 'https://git.example.com/acme/docs.git' });
    expect(visible.integrations).toEqual({});
    expect(visible.notifications).toEqual({ member_joined: true });
    expect(visible.name).toBe('Acme');
  });
});
