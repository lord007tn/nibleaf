import { MemberRole } from '@nibleaf/shared/constants';
import { describe, expect, it, vi } from 'vitest';
import { getScopedWorkspaceSettings } from './workspace';

const metadata = {
  plan: 'free',
  notifications: { member_joined: true },
  integrations: { slack: { webhookUrl: 'https://hooks.slack.com/services/secret' } },
  git: { provider: 'github', repo: 'acme/docs', lastSyncStatus: 'ok' },
};

vi.mock('@nibleaf/database', () => ({
  prisma: {
    organization: { findUnique: async () => ({ id: 'org-1', name: 'Acme', slug: 'acme', metadata: JSON.stringify(metadata) }) },
    project: { count: async () => 1 },
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
    expect(visible.git).toEqual(metadata.git);
    expect(visible.integrations).toEqual({});
    expect(visible.notifications).toEqual({ member_joined: true });
    expect(visible.name).toBe('Acme');
  });
});
