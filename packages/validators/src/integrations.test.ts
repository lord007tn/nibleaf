import { INTEGRATION_CATALOG, INTEGRATION_PROVIDER_IDS } from '@nibleaf/shared/integrations';
import { describe, expect, it } from 'vitest';
import {
  createProjectIntegrationBody,
  integrationConnectionSummarySchema,
  updateProjectIntegrationBody,
  verifyProjectIntegrationBody,
} from './integrations';

describe('integration contracts', () => {
  it('publishes one truthful manifest per provider and mutations only for implemented webhooks', () => {
    expect(INTEGRATION_CATALOG.map(({ id }) => id)).toEqual(INTEGRATION_PROVIDER_IDS);
    expect(INTEGRATION_CATALOG.filter(({ lifecycle }) => lifecycle === 'configurable').map(({ id }) => id)).toEqual(['slack', 'discord', 'zapier']);
    expect(INTEGRATION_CATALOG.filter(({ supportsDelete }) => supportsDelete).map(({ id }) => id)).toEqual(['slack', 'discord', 'zapier']);
    for (const manifest of INTEGRATION_CATALOG) {
      expect(manifest.navigation.documentation).toEqual({
        en: '/reference/integrations-engine',
        ar: '/ar/reference/integrations-engine',
      });
      expect(['git', 'integrations', null]).toContain(manifest.navigation.settingsSection);
    }
    expect(
      INTEGRATION_CATALOG.filter(({ lifecycle }) => lifecycle === 'managed').every(({ navigation }) => navigation.settingsSection === null),
    ).toBe(true);
  });

  it('accepts only allowlisted provider webhook hosts', () => {
    expect(
      createProjectIntegrationBody.safeParse({
        providerId: 'slack',
        webhookUrl: 'https://hooks.slack.com/services/T/B/token',
        idempotencyKey: 'create-key',
      }).success,
    ).toBe(true);
    expect(
      createProjectIntegrationBody.safeParse({
        providerId: 'slack',
        webhookUrl: 'https://example.com/services/T/B/token',
        idempotencyKey: 'create-key',
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      'slack',
      'https://hooks.slack.com/services/T/B/token',
      ['https://user:pass@hooks.slack.com/services/T/B/token', 'https://example.com/services/T/B/token'],
    ],
    [
      'discord',
      'https://discord.com/api/webhooks/1/token',
      ['https://user:pass@discord.com/api/webhooks/1/token', 'https://example.com/api/webhooks/1/token'],
    ],
    [
      'zapier',
      'https://hooks.zapier.com/hooks/catch/1/token',
      ['https://user:pass@hooks.zapier.com/hooks/catch/1/token', 'https://example.com/hooks/catch/1/token'],
    ],
  ] as const)('safely enforces the %s webhook boundary for create and update contracts', (providerId, webhookUrl, providerInvalidUrls) => {
    expect(createProjectIntegrationBody.safeParse({ providerId, webhookUrl, idempotencyKey: 'create-key' }).success).toBe(true);
    expect(
      updateProjectIntegrationBody.safeParse({
        providerId,
        webhookUrl,
        replaceCredential: true,
        expectedRevision: 1,
        idempotencyKey: 'update-key',
      }).success,
    ).toBe(true);

    for (const invalidUrl of ['', 'x', '://', ...providerInvalidUrls]) {
      expect(() => createProjectIntegrationBody.safeParse({ providerId, webhookUrl: invalidUrl, idempotencyKey: 'create-key' })).not.toThrow();
      expect(createProjectIntegrationBody.safeParse({ providerId, webhookUrl: invalidUrl, idempotencyKey: 'create-key' }).success).toBe(false);
      expect(() =>
        updateProjectIntegrationBody.safeParse({
          providerId,
          webhookUrl: invalidUrl,
          replaceCredential: true,
          expectedRevision: 1,
          idempotencyKey: 'update-key',
        }),
      ).not.toThrow();
      expect(
        updateProjectIntegrationBody.safeParse({
          providerId,
          webhookUrl: invalidUrl,
          replaceCredential: true,
          expectedRevision: 1,
          idempotencyKey: 'update-key',
        }).success,
      ).toBe(false);
    }
  });

  it('rejects secrets and unknown fields from persisted public replay results', () => {
    const safe = {
      id: 'connection-1',
      providerId: 'slack',
      category: 'webhook',
      ownership: 'project',
      status: 'active',
      health: { status: 'unverified', checkedAt: null, code: null },
      credential: { configured: true },
      config: { providerId: 'slack', label: 'Alerts', webhookUrl: 'https://hooks.slack.com/services/T/B/token' },
      revision: 1,
      createdAt: '2026-08-23T12:00:00.000Z',
      updatedAt: '2026-08-23T12:00:00.000Z',
    };
    expect(integrationConnectionSummarySchema.safeParse(safe).success).toBe(false);
  });

  it('requires revision fields only for project-owned webhook verification', () => {
    expect(verifyProjectIntegrationBody.safeParse({ providerId: 'github' }).success).toBe(true);
    expect(verifyProjectIntegrationBody.safeParse({ providerId: 'github', expectedRevision: 1, idempotencyKey: 'unused-key' }).success).toBe(false);
    expect(verifyProjectIntegrationBody.safeParse({ providerId: 'discord' }).success).toBe(false);
  });
});
