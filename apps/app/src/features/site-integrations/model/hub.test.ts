import { INTEGRATION_CATALOG, type IntegrationCatalogEntry, type IntegrationConnectionSummary } from '@nibleaf/shared/integrations';
import { describe, expect, it } from 'vitest';
import { detailEntry, hubCard, hubGroups, integrationDetailId } from './hub';

type Connection = NonNullable<IntegrationCatalogEntry['connection']>;
const entry = (id: IntegrationCatalogEntry['id'], overrides: Partial<IntegrationCatalogEntry> = {}): IntegrationCatalogEntry => {
  const manifest = INTEGRATION_CATALOG.find((candidate) => candidate.id === id);
  if (!manifest) throw new Error(id);
  return { ...manifest, availability: manifest.comingSoon ? 'coming_soon' : 'available', connection: null, ...overrides };
};
const connection = (config: IntegrationConnectionSummary['config'], overrides: Partial<Connection> = {}): Connection => ({
  id: `connection-${config.providerId}`,
  providerId: config.providerId,
  category: 'webhook',
  ownership: 'project',
  status: 'active',
  health: { status: 'unverified', checkedAt: null, code: null },
  credential: null,
  config,
  revision: 1,
  createdAt: '2026-11-26T00:00:00.000Z',
  updatedAt: '2026-11-26T00:00:00.000Z',
  ...overrides,
});
/** The catalog as a server with every service set up reports it to a site. */
const fullCatalog = () =>
  INTEGRATION_CATALOG.map((manifest) =>
    entry(manifest.id, manifest.lifecycle === 'managed' ? { connection: connection({ providerId: 'smtp' }, { ownership: 'instance' }) } : {}),
  );

describe('hubGroups', () => {
  it('groups only what a site owner connects, by job, and never the server’s services or the AI providers', () => {
    const groups = hubGroups(fullCatalog());
    expect(groups.map((group) => [group.id, group.cards.map((card) => card.entry.id)])).toEqual([
      ['sync', ['github']],
      ['analytics', ['google-analytics', 'plausible']],
      ['notifications', ['slack', 'discord']],
      ['automation', ['zapier']],
    ]);
  });

  it('keeps a GitLab or plain Git card only while the site still syncs from one', () => {
    const gitlab = entry('gitlab', { connection: connection({ providerId: 'gitlab', repository: 'acme/docs', branch: 'main', contentPath: '' }) });
    const groups = hubGroups([entry('github'), gitlab, entry('public-git')]);
    expect(groups[0]?.cards.map((card) => card.entry.id)).toEqual(['github', 'gitlab']);
    expect(groups[0]?.cards[1]?.state).toEqual({ kind: 'connected', line: { kind: 'syncing', repository: 'acme/docs', branch: 'main' } });
  });

  it('drops empty groups', () => {
    expect(hubGroups([entry('plausible')]).map((group) => group.id)).toEqual(['analytics']);
    expect(hubGroups([])).toEqual([]);
  });
});

describe('hubCard', () => {
  it('offers GitHub on the Git page: Set up, or Connected with what syncs', () => {
    expect(hubCard(entry('github'))).toMatchObject({ state: { kind: 'setUp', action: 'setUp' }, target: { kind: 'git' } });
    const connected = entry('github', {
      connection: connection({ providerId: 'github', repository: 'acme/docs', baseBranch: 'main', headBranch: 'nibleaf/docs', contentPath: 'docs' }),
    });
    expect(hubCard(connected)?.state).toEqual({ kind: 'connected', line: { kind: 'syncing', repository: 'acme/docs', branch: 'main' } });
    expect(hubCard({ ...connected, connection: { ...(connected.connection as Connection), status: 'error' } })?.state).toEqual({
      kind: 'notWorking',
    });
  });

  it('opens one Analytics page from either analytics card', () => {
    expect(hubCard(entry('google-analytics'))).toMatchObject({ state: { kind: 'setUp' }, target: { kind: 'detail', id: 'analytics' } });
    const tracked = entry('plausible', { connection: connection({ providerId: 'plausible', domain: 'docs.acme.com' }) });
    expect(hubCard(tracked)).toMatchObject({
      state: { kind: 'connected', line: { kind: 'tracking', id: 'docs.acme.com' } },
      target: { kind: 'detail', id: 'analytics' },
    });
  });

  it('shows Slack, Discord and Zapier as coming soon with nothing to open, and a stored one as remove-only', () => {
    for (const id of ['slack', 'discord', 'zapier'] as const) {
      expect(hubCard(entry(id))).toMatchObject({ state: { kind: 'comingSoon' }, target: null });
    }
    const stored = entry('slack', { connection: connection({ providerId: 'slack', label: 'Docs team' }) });
    expect(hubCard(stored)).toMatchObject({
      state: { kind: 'notSendingYet', line: { kind: 'posts', label: 'Docs team' } },
      target: { kind: 'detail', id: 'slack' },
    });
  });

  it('once a notification provider is live: Connect, Connected, Paused or Not working', () => {
    const live = (status?: Connection['status']) =>
      entry('discord', {
        availability: 'available',
        comingSoon: false,
        connection: status ? connection({ providerId: 'discord', label: null }, { status }) : null,
      });
    expect(hubCard(live())?.state).toEqual({ kind: 'setUp', action: 'connect' });
    expect(hubCard(live('active'))?.state).toEqual({ kind: 'connected', line: { kind: 'posts', label: null } });
    expect(hubCard(live('inactive'))?.state).toEqual({ kind: 'paused', line: { kind: 'posts', label: null } });
    expect(hubCard(live('error'))?.state).toEqual({ kind: 'notWorking' });
  });

  it('draws no Connect card for a notification provider this server can’t connect', () => {
    for (const availability of ['not_configured', 'unavailable'] as const) {
      expect(hubCard(entry('discord', { availability, comingSoon: false }))).toBeNull();
    }
  });

  it('shows a paused GitHub sync as Paused', () => {
    const paused = entry('github', {
      connection: connection(
        { providerId: 'github', repository: 'acme/docs', baseBranch: 'main', headBranch: 'nibleaf/docs', contentPath: 'docs' },
        { status: 'inactive' },
      ),
    });
    expect(hubCard(paused)?.state).toEqual({ kind: 'paused', line: { kind: 'syncing', repository: 'acme/docs', branch: 'main' } });
  });

  it.each([
    'openai',
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
  ] as const)('never draws %s', (id) => {
    expect(hubCard(entry(id))).toBeNull();
  });
});

describe('integrationDetailId', () => {
  it('opens only the pages Integrations has; anything else, inherited names included, is the hub', () => {
    for (const id of ['analytics', 'slack', 'discord', 'zapier']) expect(integrationDetailId(id)).toBe(id);
    for (const id of ['qdrant', 'openai', 'github', 'toString', '__proto__', '', undefined]) expect(integrationDetailId(id)).toBeUndefined();
  });
});

describe('detailEntry', () => {
  it('opens a stored or live webhook connection and falls back to the hub otherwise', () => {
    const stored = entry('slack', { connection: connection({ providerId: 'slack', label: null }) });
    expect(detailEntry([stored], 'slack')).toBe(stored);
    expect(detailEntry([entry('slack')], 'slack')).toBeNull();
    expect(detailEntry([], 'zapier')).toBeNull();
  });
});
