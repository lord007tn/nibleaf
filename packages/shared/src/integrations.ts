export type IntegrationCategory = 'source_control' | 'deployment' | 'ai' | 'email' | 'analytics' | 'storage' | 'webhook';
export const INTEGRATION_CATEGORIES = [
  'source_control',
  'deployment',
  'ai',
  'email',
  'analytics',
  'storage',
  'webhook',
] as const satisfies readonly IntegrationCategory[];

export type IntegrationProviderId =
  | 'github'
  | 'gitlab'
  | 'public-git'
  | 'google-analytics'
  | 'plausible'
  | 'slack'
  | 'discord'
  | 'zapier'
  | 'openrouter'
  | 'qdrant'
  | 'clickhouse'
  | 'postmark'
  | 'smtp'
  | 'maxio'
  | 'minio'
  | 'amazon-s3'
  | 'cloudflare-r2'
  | 'backblaze-b2'
  | 'cloudflare';

export const INTEGRATION_PROVIDER_IDS = [
  'github',
  'gitlab',
  'public-git',
  'google-analytics',
  'plausible',
  'slack',
  'discord',
  'zapier',
  'openrouter',
  'qdrant',
  'clickhouse',
  'postmark',
  'smtp',
  'maxio',
  'minio',
  'amazon-s3',
  'cloudflare-r2',
  'backblaze-b2',
  'cloudflare',
] as const satisfies readonly IntegrationProviderId[];

export type IntegrationCapability =
  | 'read'
  | 'write'
  | 'events'
  | 'health'
  | 'webhooks'
  | 'content'
  | 'deployments'
  | 'generation'
  | 'search'
  | 'delivery'
  | 'analytics'
  | 'assets';

export type IntegrationSettingsSection = 'git' | 'integrations';

export interface IntegrationNavigation {
  settingsSection: IntegrationSettingsSection | null;
  documentation: {
    en: '/reference/integrations-engine';
    ar: '/ar/reference/integrations-engine';
  };
}

export interface IntegrationManifest {
  id: IntegrationProviderId;
  category: IntegrationCategory;
  capabilities: readonly IntegrationCapability[];
  ownership: 'project' | 'instance';
  authKind: 'none' | 'secret' | 'managed';
  lifecycle: 'configurable' | 'adapter' | 'managed';
  supportsActivation: boolean;
  supportsCredentialFreeUpdate: boolean;
  supportsDelete: boolean;
  supportsPassiveVerification: boolean;
  verificationSideEffect: boolean;
  navigation: IntegrationNavigation;
  configFields: readonly {
    key: string;
    kind: 'text' | 'url' | 'secret';
    required: boolean;
    secret: boolean;
  }[];
}

const documentation = { en: '/reference/integrations-engine', ar: '/ar/reference/integrations-engine' } as const;

const managed = (id: IntegrationProviderId, category: IntegrationCategory, capabilities: readonly IntegrationCapability[]): IntegrationManifest => ({
  id,
  category,
  capabilities,
  ownership: 'instance',
  authKind: 'managed',
  lifecycle: 'managed',
  supportsActivation: false,
  supportsCredentialFreeUpdate: false,
  supportsDelete: false,
  supportsPassiveVerification: false,
  verificationSideEffect: false,
  navigation: { settingsSection: null, documentation },
  configFields: [],
});

const adapter = (
  id: IntegrationProviderId,
  category: IntegrationCategory,
  capabilities: readonly IntegrationCapability[],
  authKind: IntegrationManifest['authKind'] = 'none',
  settingsSection: IntegrationSettingsSection = 'integrations',
): IntegrationManifest => ({
  id,
  category,
  capabilities,
  ownership: 'project',
  authKind,
  lifecycle: 'adapter',
  supportsActivation: false,
  supportsCredentialFreeUpdate: false,
  supportsDelete: false,
  supportsPassiveVerification: false,
  verificationSideEffect: false,
  navigation: { settingsSection, documentation },
  configFields: [],
});

const webhook = (id: 'slack' | 'discord' | 'zapier', verificationSideEffect: boolean): IntegrationManifest => ({
  id,
  category: 'webhook',
  capabilities: ['read', 'write', 'events', 'health', 'webhooks'],
  ownership: 'project',
  authKind: 'secret',
  lifecycle: 'configurable',
  supportsActivation: true,
  supportsCredentialFreeUpdate: true,
  supportsDelete: true,
  supportsPassiveVerification: !verificationSideEffect,
  verificationSideEffect,
  navigation: { settingsSection: 'integrations', documentation },
  configFields: [
    { key: 'webhookUrl', kind: 'secret', required: true, secret: true },
    { key: 'label', kind: 'text', required: false, secret: false },
  ],
});

/**
 * Provider discovery is static and secret-free. Adapters intentionally keep
 * existing domain models authoritative; only configurable webhook providers
 * use the generic project-connection persistence layer.
 */
export const INTEGRATION_CATALOG: readonly IntegrationManifest[] = [
  {
    ...adapter('github', 'source_control', ['read', 'write', 'content', 'webhooks', 'health'], 'secret', 'git'),
    supportsPassiveVerification: true,
  },
  adapter('gitlab', 'source_control', ['read', 'content'], 'none', 'git'),
  adapter('public-git', 'source_control', ['read', 'content'], 'none', 'git'),
  adapter('google-analytics', 'analytics', ['write', 'analytics']),
  adapter('plausible', 'analytics', ['write', 'analytics']),
  webhook('slack', true),
  webhook('discord', false),
  webhook('zapier', true),
  managed('openrouter', 'ai', ['generation', 'search', 'health']),
  managed('qdrant', 'storage', ['search', 'health']),
  managed('clickhouse', 'analytics', ['analytics', 'health']),
  managed('postmark', 'email', ['delivery', 'health']),
  managed('smtp', 'email', ['delivery']),
  managed('maxio', 'storage', ['assets', 'health']),
  managed('minio', 'storage', ['assets', 'health']),
  managed('amazon-s3', 'storage', ['assets', 'health']),
  managed('cloudflare-r2', 'storage', ['assets', 'health']),
  managed('backblaze-b2', 'storage', ['assets', 'health']),
  managed('cloudflare', 'deployment', ['deployments', 'health']),
];

export type IntegrationPublicConfig =
  | { providerId: 'github'; repository: string; baseBranch: string; headBranch: string; contentPath: string }
  | { providerId: 'gitlab' | 'public-git'; repository: string; branch: string; contentPath: string }
  | { providerId: 'google-analytics'; measurementId: string }
  | { providerId: 'plausible'; domain: string }
  | { providerId: 'slack' | 'discord' | 'zapier'; label: string | null }
  | { providerId: 'openrouter'; draftModel: string; embeddingModel: string; answerModel: string }
  | { providerId: 'qdrant'; collectionAlias: string; searchRuntime: 'legacy' | 'shadow' | 'hybrid' }
  | { providerId: 'clickhouse'; mode: 'disabled' | 'dual_write' | 'shadow_read' | 'clickhouse' }
  | { providerId: 'postmark'; messageStream: string | null }
  | { providerId: 'smtp' }
  | { providerId: 'maxio' | 'minio' | 'amazon-s3' | 'cloudflare-r2' | 'backblaze-b2' }
  | { providerId: 'cloudflare'; workerScript: string };

export interface IntegrationConnectionSummary {
  id: string;
  providerId: IntegrationProviderId;
  category: IntegrationCategory;
  ownership: 'project' | 'instance';
  status: 'active' | 'inactive' | 'error';
  health: {
    status: 'unverified' | 'healthy' | 'unhealthy';
    checkedAt: string | null;
    code: string | null;
  };
  credential: { configured: boolean } | null;
  config: IntegrationPublicConfig;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationCatalogEntry extends IntegrationManifest {
  availability: 'available' | 'not_configured' | 'unavailable';
  connection: IntegrationConnectionSummary | null;
}

export const getIntegrationManifest = (providerId: IntegrationProviderId) => INTEGRATION_CATALOG.find((provider) => provider.id === providerId);
