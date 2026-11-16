import { MemberRole } from '@nibleaf/shared/constants';
import { updateWorkspaceSettingsBody } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The dashboard's repository form serializer (pure), run here through the real validator and merge.
import {
  type GitConnectionValues,
  gitConnectionPayload,
  gitConnectionValues,
  sentGitConnectionValues,
} from '../../../app/src/features/site-git/model/git-connection';
import { type GitInstantChange, gitInstantPayload } from '../../../app/src/features/site-git/model/git-instant-write';
import { getScopedWorkspaceSettings, updateWorkspaceSettings } from './workspace';

/** Persistence only: what `writeProjectSettings` and the reads touch, in memory. */
const db = vi.hoisted(() => ({
  git: {} as Record<string, unknown>,
  legacy: {} as Record<string, unknown>,
  organization: '{}',
  secret: undefined as string | undefined,
}));
vi.mock('@nibleaf/database', () => {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) =>
      strings.join('?').includes('"organizationId"') ? [{ organizationId: 'org-1' }] : [{ id: 'website-1' }],
    projectGitSettings: {
      findUnique: async () => ({ projectId: 'website-1', settings: copy(db.git) }),
      upsert: async ({ update }: { update: { settings: Record<string, unknown> } }) => {
        db.git = copy(update.settings);
      },
    },
    projectLegacySettings: {
      findUnique: async () => ({ projectId: 'website-1', metadata: copy(db.legacy) }),
      upsert: async ({ update }: { update: { metadata: Record<string, unknown> } }) => {
        db.legacy = copy(update.metadata);
      },
    },
    organization: {
      findUniqueOrThrow: async () => ({ id: 'org-1', name: 'Acme', slug: 'acme', metadata: db.organization }),
      update: async ({ data }: { data: { metadata: string } }) => {
        db.organization = data.metadata;
      },
    },
  };
  return {
    prisma: {
      ...tx,
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
      project: { count: async () => 1, findMany: async () => [{ id: 'website-1' }] },
      member: { count: async () => 1 },
    },
  };
});
vi.mock('./git-webhook-secret', () => ({ getGitWebhookSecret: async () => db.secret }));

/** Everything a site's legacy `git` can hold: flags, an import branch and language, and the server's bookkeeping. */
const STORED = {
  provider: 'gitlab',
  repo: 'group/docs',
  cloneUrl: 'https://git.example.com/group/docs.git',
  instanceUrl: 'https://git.example.com',
  branch: 'release',
  path: 'docs',
  importBranchId: 'b1',
  importLanguageId: 'fr',
  connected: true,
  autoPublish: true,
  lastImportedAt: '2026-11-01T08:00:00.000Z',
  lastSyncAt: '2026-11-02T08:00:00.000Z',
  lastSyncStatus: 'failed',
  lastSyncError: 'Could not read docs/intro.md',
};
const BOOKKEEPING = {
  lastImportedAt: STORED.lastImportedAt,
  lastSyncAt: STORED.lastSyncAt,
  lastSyncStatus: 'failed',
  lastSyncError: STORED.lastSyncError,
};

beforeEach(() => {
  db.git = { ...STORED };
  db.legacy = { integrations: { slack: { webhookUrl: 'https://hooks.slack.com/services/x' } } };
  db.organization = JSON.stringify({ plan: 'free', notifications: { member_joined: true } });
  db.secret = 'f00d';
});

/** The dashboard's save: the payload from the settings it last read, through the route's validator, into the server's merge. */
async function saveConnection(values: GitConnectionValues) {
  const read = await getScopedWorkspaceSettings('org-1', MemberRole.ADMIN, 'website-1');
  const body = updateWorkspaceSettingsBody.parse({ git: gitConnectionPayload(values, read.git) });
  await updateWorkspaceSettings('org-1', 'actor-1', body, 'website-1');
  return getScopedWorkspaceSettings('org-1', MemberRole.ADMIN, 'website-1');
}

describe('a repository save through the real validator and merge', () => {
  const draft = (overrides: Partial<GitConnectionValues>) => ({ ...gitConnectionValues(STORED), ...overrides });

  it.each([
    [
      'github',
      draft({ provider: 'github', repo: ' acme/docs ', branch: ' ', importBranchId: '' }),
      { provider: 'github', repo: 'acme/docs', branch: 'main', path: 'docs', importLanguageId: 'fr' },
    ],
    [
      'gitlab',
      draft({ provider: 'gitlab', instanceUrl: ' ', path: ' guides ' }),
      {
        provider: 'gitlab',
        repo: 'group/docs',
        instanceUrl: 'https://gitlab.com',
        branch: 'release',
        path: 'guides',
        importBranchId: 'b1',
        importLanguageId: 'fr',
      },
    ],
    [
      'git',
      draft({ provider: 'git', cloneUrl: ' https://git.example.com/acme/docs.git ', importLanguageId: '' }),
      { provider: 'git', cloneUrl: 'https://git.example.com/acme/docs.git', branch: 'release', path: 'docs', importBranchId: 'b1' },
    ],
  ])(
    '%s: stores exactly the connection, keeps the flags, the bookkeeping, the secret and the rest of the settings',
    async (_provider, values, connection) => {
      const read = await saveConnection(values);
      expect(db.git).toEqual({ ...connection, connected: true, autoPublish: true, ...BOOKKEEPING });
      expect(read.git).toEqual({ ...connection, connected: true, autoPublish: true, ...BOOKKEEPING, webhookSecret: 'f00d' });
      // What the form reads back is what it judged the save by (its `toSent`): a clean echo.
      expect(gitConnectionValues(read.git)).toEqual(sentGitConnectionValues(values));
      expect(db.legacy).toEqual({ integrations: { slack: { webhookUrl: 'https://hooks.slack.com/services/x' } } });
      expect(JSON.parse(db.organization)).toMatchObject({ plan: 'free', notifications: { member_joined: true } });
    },
  );

  it('sends the auto publish another writer stored while the repository was being edited', async () => {
    const values = draft({ provider: 'gitlab', repo: 'group/handbook' });
    db.git = { ...db.git, autoPublish: false };
    await saveConnection(values);
    expect(db.git).toMatchObject({ repo: 'group/handbook', autoPublish: false, connected: true });
  });

  it('never writes an auto publish the site never set, and connects a disconnected site', async () => {
    const { autoPublish: _unset, ...rest } = STORED;
    db.git = { ...rest, connected: false };
    await saveConnection(draft({}));
    expect(db.git).not.toHaveProperty('autoPublish');
    expect(db.git).toMatchObject({ connected: true });
  });
});

/** The dashboard's instant write (auto publish, Disconnect, legacy switch-off): the settings it last read, with one change. */
async function writeInstant(change: GitInstantChange) {
  const read = await getScopedWorkspaceSettings('org-1', MemberRole.ADMIN, 'website-1');
  const git = gitInstantPayload(read.git, change);
  // The serializer before the validator, and after it: accepted unchanged, nothing normalized away.
  expect(updateWorkspaceSettingsBody.parse({ git })).toEqual({ git });
  expect(JSON.stringify(git)).not.toMatch(/f00d|webhookSecret|lastSync|lastImportedAt/);
  await updateWorkspaceSettings('org-1', 'actor-1', updateWorkspaceSettingsBody.parse({ git }), 'website-1');
  return getScopedWorkspaceSettings('org-1', MemberRole.ADMIN, 'website-1');
}

describe('an instant write through the real validator and merge (#780)', () => {
  // Each provider with only its own address stored: no clone URL for GitHub or GitLab, no repository for a Git URL.
  const CONNECTIONS = {
    github: { provider: 'github', repo: 'team/docs', branch: 'main', path: 'docs', connected: true, autoPublish: false },
    gitlab: {
      provider: 'gitlab',
      repo: 'group/docs',
      instanceUrl: 'https://git.example.com',
      branch: 'release',
      path: '',
      importBranchId: 'b1',
      importLanguageId: 'fr',
      connected: true,
      autoPublish: true,
    },
    git: { provider: 'git', cloneUrl: 'https://git.example.com/team/docs.git', branch: 'main', path: 'guides', connected: true },
  } as const;
  const CHANGES: GitInstantChange[] = [{ autoPublish: true }, { autoPublish: false }, { connected: false }];

  it.each(Object.entries(CONNECTIONS))(
    '%s: each change stores only that change, and reads it back with the bookkeeping and the secret',
    async (_provider, connection) => {
      for (const change of CHANGES) {
        db.git = { ...connection, ...BOOKKEEPING };
        const read = await writeInstant(change);
        expect(db.git).toEqual({ ...connection, ...change, ...BOOKKEEPING });
        expect(read.git).toEqual({ ...connection, ...change, ...BOOKKEEPING, webhookSecret: 'f00d' });
        expect(db.secret).toBe('f00d');
        expect(db.legacy).toEqual({ integrations: { slack: { webhookUrl: 'https://hooks.slack.com/services/x' } } });
      }
    },
  );

  it('a site with nothing stored gains only the change: no repository, never connected', async () => {
    db.git = {};
    await writeInstant({ autoPublish: true });
    expect(db.git).toEqual({ autoPublish: true });
    await writeInstant({ connected: false });
    expect(db.git).toEqual({ autoPublish: true, connected: false });
  });
});
