import { updateWorkspaceSettingsBody } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import { gitInstantPayload } from './git-instant-write';

/** What the server's settings read returns: the client fields, the bookkeeping, and the secret (to an admin). */
const SERVER_OWNED = {
  lastImportedAt: '2026-11-01T08:00:00.000Z',
  lastSyncAt: '2026-11-02T08:00:00.000Z',
  lastSyncStatus: 'failed',
  lastSyncError: 'boom',
  webhookSecret: 'f00d',
};
const GITHUB = { connected: true, provider: 'github', repo: 'team/docs', branch: 'main', path: 'docs', autoPublish: false } as const;
const GITLAB = {
  connected: true,
  provider: 'gitlab',
  repo: 'group/docs',
  instanceUrl: 'https://git.example.com',
  branch: 'release',
  path: '',
  importBranchId: 'b1',
  importLanguageId: 'fr',
  autoPublish: true,
} as const;
const GIT = { connected: true, provider: 'git', cloneUrl: 'https://git.example.com/team/docs.git', branch: 'main', path: 'guides' } as const;

/** The payload, checked before the validator and after it: accepted, and unchanged by it. */
const throughValidator = (git: unknown) => {
  const parsed = updateWorkspaceSettingsBody.safeParse({ git });
  expect(parsed.success).toBe(true);
  expect(parsed.data).toEqual({ git });
  return git;
};

describe('gitInstantPayload: the stored connection with one change', () => {
  it.each([
    ['GitHub', GITHUB],
    ['GitLab', GITLAB],
    ['a Git URL', GIT],
  ])('%s: each change sends every stored client field, that one change, and nothing server-owned', (_name, stored) => {
    for (const change of [{ autoPublish: true }, { autoPublish: false }, { connected: false } as const]) {
      const payload = gitInstantPayload({ ...stored, ...SERVER_OWNED }, change);
      expect(payload).toEqual({ ...stored, ...change });
      throughValidator(payload);
    }
  });

  it('keeps an explicit false, a blank path and branch, and blank import targets; leaves unset ones unset', () => {
    const stored = { provider: 'github', repo: 'team/docs', branch: '', path: '', importBranchId: '', connected: false, autoPublish: false };
    expect(throughValidator(gitInstantPayload(stored, { autoPublish: true }))).toEqual({ ...stored, autoPublish: true });
    // Nothing stored but the repository: no branch, path, instance, flag or provider appears.
    expect(throughValidator(gitInstantPayload({ repo: 'team/docs', connected: true }, { autoPublish: true }))).toEqual({
      repo: 'team/docs',
      connected: true,
      autoPublish: true,
    });
    expect(gitInstantPayload({ repo: 'team/docs', connected: true }, { connected: false })).not.toHaveProperty('autoPublish');
  });

  it('GitLab: sends a self-hosted instance; never writes the default for an unset one', () => {
    expect(gitInstantPayload(GITLAB, { connected: false }).instanceUrl).toBe('https://git.example.com');
    expect(throughValidator(gitInstantPayload({ provider: 'gitlab', repo: 'group/docs', connected: true }, { autoPublish: true }))).toEqual({
      provider: 'gitlab',
      repo: 'group/docs',
      connected: true,
      autoPublish: true,
    });
  });

  it('sends only the provider’s own address: no blank one, and none left from another provider', () => {
    const leftovers = { cloneUrl: 'https://git.example.com/old.git', instanceUrl: 'https://git.example.com', repo: 'old/repo' };
    expect(throughValidator(gitInstantPayload({ ...GITHUB, ...leftovers, repo: 'team/docs', cloneUrl: '' }, { autoPublish: true }))).toEqual({
      ...GITHUB,
      autoPublish: true,
    });
    expect(throughValidator(gitInstantPayload({ ...GIT, repo: '', instanceUrl: leftovers.instanceUrl }, { connected: false }))).toEqual({
      ...GIT,
      connected: false,
    });
    // A blank active address is left out rather than refused: the change still saves.
    expect(throughValidator(gitInstantPayload({ provider: 'gitlab', repo: '  ', instanceUrl: '', connected: true }, { connected: false }))).toEqual({
      provider: 'gitlab',
      connected: false,
    });
  });

  it('reads an unknown provider as GitHub and leaves it out, since the schema would refuse it', () => {
    expect(
      throughValidator(gitInstantPayload({ provider: 'svn', repo: 'team/docs', cloneUrl: 'https://x.test/a.git' }, { connected: false })),
    ).toEqual({
      repo: 'team/docs',
      connected: false,
    });
  });

  it('a site with nothing stored gains no repository and is never connected', () => {
    for (const stored of [null, undefined, {}]) {
      expect(throughValidator(gitInstantPayload(stored, { autoPublish: true }))).toEqual({ autoPublish: true });
      expect(throughValidator(gitInstantPayload(stored, { connected: false }))).toEqual({ connected: false });
    }
    expect(gitInstantPayload({ connected: false, autoPublish: true }, { autoPublish: false })).toEqual({ connected: false, autoPublish: false });
  });

  it('ignores values of the wrong type instead of sending them', () => {
    expect(gitInstantPayload({ repo: 'team/docs', branch: 3, path: null, connected: 'yes', autoPublish: 1 } as never, { connected: false })).toEqual({
      repo: 'team/docs',
      connected: false,
    });
  });

  it('sends a stored address the server would refuse as it is, so the write fails rather than deleting it', () => {
    const payload = gitInstantPayload({ provider: 'github', repo: 'https://github.com/team/docs.git', connected: true }, { connected: false });
    expect(payload.repo).toBe('https://github.com/team/docs.git');
    expect(updateWorkspaceSettingsBody.safeParse({ git: payload }).success).toBe(false);
  });
});
