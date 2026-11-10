import { describe, expect, it } from 'vitest';
import {
  organizationMetadataResponseFilter,
  redactOrganizationPayload,
  stripServerOnlyOrganizationMetadata,
  withoutMemberHiddenMetadata,
  withoutServerOnlyMetadata,
  withoutUrlCredentials,
} from './organization-metadata';

describe('organization metadata', () => {
  it('drops the Git webhook secret and keeps every other field', () => {
    const metadata = { plan: 'free', notifications: { member_joined: true }, git: { repo: 'acme/docs', webhookSecret: 'secret' } };
    expect(withoutServerOnlyMetadata(metadata)).toEqual({ plan: 'free', notifications: { member_joined: true }, git: { repo: 'acme/docs' } });
    expect(metadata.git.webhookSecret).toBe('secret');
  });

  it.each([undefined, null, 'text', [], { plan: 'free' }, { git: 'acme/docs' }, { git: { repo: 'acme/docs' } }])(
    'returns %j unchanged',
    (metadata) => {
      expect(withoutServerOnlyMetadata(metadata)).toBe(metadata);
    },
  );

  it('rewrites an organization update only when it carries server-only fields', async () => {
    await expect(stripServerOnlyOrganizationMetadata({ organization: {} })).resolves.toBeUndefined();
    await expect(stripServerOnlyOrganizationMetadata({ organization: { metadata: { plan: 'free' } } })).resolves.toBeUndefined();
    await expect(
      stripServerOnlyOrganizationMetadata({ organization: { metadata: { git: { repo: 'acme/docs', webhookSecret: 'secret' } } } }),
    ).resolves.toEqual({ data: { metadata: { git: { repo: 'acme/docs' } } } });
  });
});

describe('organization responses', () => {
  /** Stored text the data migration skips: valid JSON that PostgreSQL rejects as jsonb. */
  const skippedRow = '{"note":"a\\u0000b","label":"\\ud800","git":{"repo":"acme/docs","webhookSecret":"secret"}}';

  it('removes the secret from stored JSON text and keeps every other value', () => {
    const [organization] = redactOrganizationPayload([{ id: 'org-1', name: 'Site', metadata: skippedRow }]) as [{ metadata: string }];
    expect(organization.metadata).not.toContain('secret');
    expect(JSON.parse(organization.metadata)).toEqual({});
  });

  it('removes the secret from parsed metadata in a full organization payload', () => {
    const payload = {
      id: 'org-1',
      metadata: { plan: 'free', git: { repo: 'acme/docs', webhookSecret: 'secret' } },
      members: [{ id: 'member-1', user: { id: 'user-1', email: 'member@example.com' } }],
      invitations: [],
    };
    const redacted = redactOrganizationPayload(payload);
    expect(redacted).toEqual({ ...payload, metadata: { plan: 'free' } });
    expect(payload.metadata.git.webhookSecret).toBe('secret');
  });

  it('removes the secret from organizations nested in other results', () => {
    const redacted = redactOrganizationPayload({ organization: { id: 'org-1', metadata: JSON.stringify({ git: { webhookSecret: 'secret' } }) } });
    expect(JSON.stringify(redacted)).not.toContain('secret');
  });

  it('withholds metadata text that cannot be parsed', () => {
    expect(redactOrganizationPayload({ id: 'org-1', metadata: '{"git":{"webhookSecret":"secret"' })).toEqual({ id: 'org-1', metadata: null });
  });

  it('returns results without server-only fields unchanged', () => {
    const createdAt = new Date();
    const list = [
      { id: 'org-1', metadata: '{"plan":"free"}', createdAt },
      { id: 'org-2', metadata: null },
    ];
    expect(redactOrganizationPayload(list)).toBe(list);
    expect(redactOrganizationPayload(null)).toBeNull();
    expect(redactOrganizationPayload({ status: true })).toEqual({ status: true });
  });

  it('filters every organization endpoint and nothing else', () => {
    const [hook] = organizationMetadataResponseFilter().hooks.after;
    const matches = (path: string) => hook?.matcher({ path } as Parameters<NonNullable<typeof hook>['matcher']>[0]);
    for (const path of ['/organization/list', '/organization/get-full-organization', '/organization/set-active', '/organization/update']) {
      expect(matches(path), path).toBe(true);
    }
    expect(matches('/get-session')).toBe(false);
  });
});

describe('organization responses hide admin-only and credential-bearing metadata from every member', () => {
  const metadata = {
    plan: 'free',
    integrations: { slack: { webhookUrl: 'https://hooks.slack.com/services/secret' } },
    git: {
      repo: 'acme/docs',
      webhookSecret: 'secret',
      cloneUrl: 'https://user:token@git.example.com/acme/docs.git?private_token=t#x',
      instanceUrl: 'https://oauth2:tok@gitlab.example.com/',
    },
  };

  it('drops integrations, the webhook secret and URL credentials', () => {
    expect(withoutMemberHiddenMetadata(metadata)).toEqual({
      plan: 'free',
    });
    expect(metadata.git.cloneUrl).toContain('token');
  });

  it('applies to organization endpoint payloads, parsed or stored as text', () => {
    const parsed = JSON.stringify(redactOrganizationPayload({ id: 'org-1', metadata }));
    const text = JSON.stringify(redactOrganizationPayload({ id: 'org-1', metadata: JSON.stringify(metadata) }));
    for (const out of [parsed, text]) {
      expect(out).not.toContain('hooks.slack.com');
      expect(out).not.toContain('token');
      expect(out).not.toContain('secret');
    }
  });

  it('drops a Git URL it cannot parse and keeps clean values as they are', () => {
    expect(withoutUrlCredentials('not a url')).toBeNull();
    expect(withoutUrlCredentials('ssh://git@example.com/x')).toBeNull();
    const clean = { git: { cloneUrl: 'https://git.example.com/acme/docs.git' } };
    expect(withoutMemberHiddenMetadata(clean)).toEqual({});
    expect(withoutMemberHiddenMetadata({ git: { cloneUrl: 'nope' } })).toEqual({});
  });

  it('never strips integrations from an organization update', async () => {
    await expect(stripServerOnlyOrganizationMetadata({ organization: { metadata: { integrations: { a: 1 } } } })).resolves.toBeUndefined();
  });
});
