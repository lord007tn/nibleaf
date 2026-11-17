import { updateWorkspaceSettingsBody } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import {
  type GitConnectionValues,
  gitConnectionPayload,
  gitConnectionValues,
  missingGitConnectionField,
  sentGitConnectionValues,
} from './git-connection';

const values = (overrides: Partial<GitConnectionValues> = {}): GitConnectionValues => ({
  provider: 'github',
  repo: 'acme/docs',
  cloneUrl: '',
  instanceUrl: 'https://gitlab.com',
  branch: 'main',
  path: 'docs',
  importBranchId: '',
  importLanguageId: '',
  ...overrides,
});

describe('gitConnectionValues', () => {
  it('shows an unset site with the defaults', () => {
    expect(gitConnectionValues(undefined)).toEqual(values({ repo: '' }));
  });

  it('keeps stored blanks blank, and ignores the flags and bookkeeping', () => {
    expect(
      gitConnectionValues({
        provider: 'gitlab',
        repo: 'group/docs',
        instanceUrl: 'https://git.example.com',
        branch: '',
        path: '',
        importBranchId: 'b1',
        importLanguageId: 'fr',
        autoPublish: true,
        connected: true,
        lastImportedAt: '2026-11-01T00:00:00Z',
      } as never),
    ).toEqual(
      values({
        provider: 'gitlab',
        repo: 'group/docs',
        instanceUrl: 'https://git.example.com',
        branch: '',
        path: '',
        importBranchId: 'b1',
        importLanguageId: 'fr',
      }),
    );
  });

  it('reads an unknown provider as GitHub', () => {
    expect(gitConnectionValues({ provider: 'svn', repo: 'a/b' }).provider).toBe('github');
  });
});

describe('gitConnectionPayload: the whole `git` object, since the PATCH replaces it', () => {
  // Every field of every provider filled in, so each payload shows exactly what it clears.
  const everything = { repo: '  acme/docs  ', cloneUrl: '  https://git.example.com/acme/docs.git  ', instanceUrl: ' https://git.example.com ' };

  it('GitHub: the repository, trimmed; no clone URL or GitLab instance', () => {
    expect(gitConnectionPayload(values({ ...everything, provider: 'github' }), { autoPublish: true })).toEqual({
      provider: 'github',
      repo: 'acme/docs',
      branch: 'main',
      path: 'docs',
      connected: true,
      autoPublish: true,
    });
  });

  it('GitLab: the repository and the instance, trimmed; no clone URL', () => {
    expect(gitConnectionPayload(values({ ...everything, provider: 'gitlab' }), { autoPublish: false })).toEqual({
      provider: 'gitlab',
      repo: 'acme/docs',
      instanceUrl: 'https://git.example.com',
      branch: 'main',
      path: 'docs',
      connected: true,
      autoPublish: false,
    });
  });

  it('Git URL: the clone URL, trimmed; no repository or instance', () => {
    expect(gitConnectionPayload(values({ ...everything, provider: 'git' }), {})).toEqual({
      provider: 'git',
      cloneUrl: 'https://git.example.com/acme/docs.git',
      branch: 'main',
      path: 'docs',
      connected: true,
    });
  });

  it('fills a blank branch and GitLab instance with their defaults, and keeps a blank content path blank', () => {
    expect(gitConnectionPayload(values({ provider: 'gitlab', instanceUrl: '  ', branch: ' ', path: '  ' }), {})).toEqual({
      provider: 'gitlab',
      repo: 'acme/docs',
      instanceUrl: 'https://gitlab.com',
      branch: 'main',
      path: '',
      connected: true,
    });
  });

  it('sends the import branch and language only when picked', () => {
    expect(gitConnectionPayload(values({ importBranchId: 'b2', importLanguageId: 'fr' }), {})).toMatchObject({
      importBranchId: 'b2',
      importLanguageId: 'fr',
    });
    expect(gitConnectionPayload(values(), {})).not.toHaveProperty('importBranchId');
    expect(gitConnectionPayload(values(), {})).not.toHaveProperty('importLanguageId');
  });

  it('carries auto publish exactly as stored, never a default, and nothing server-managed', () => {
    const stored = {
      autoPublish: true,
      connected: false,
      lastImportedAt: '2026-11-01T00:00:00Z',
      lastSyncAt: '2026-11-02T00:00:00Z',
      lastSyncStatus: 'failed',
      lastSyncError: 'boom',
      webhookSecret: 'f00d',
    };
    const payload = gitConnectionPayload(values(), stored);
    expect(payload.autoPublish).toBe(true);
    // Saving the repository connects it.
    expect(payload.connected).toBe(true);
    for (const key of ['lastImportedAt', 'lastSyncAt', 'lastSyncStatus', 'lastSyncError', 'webhookSecret']) expect(payload).not.toHaveProperty(key);
    expect(gitConnectionPayload(values(), { autoPublish: false }).autoPublish).toBe(false);
    expect(gitConnectionPayload(values(), {})).not.toHaveProperty('autoPublish');
    expect(gitConnectionPayload(values(), null)).not.toHaveProperty('autoPublish');
  });

  it('passes the real settings validator unchanged, for every provider', () => {
    for (const provider of ['github', 'gitlab', 'git'] as const) {
      const git = gitConnectionPayload(
        values({ provider, cloneUrl: 'https://git.example.com/acme/docs.git', importBranchId: 'b2', importLanguageId: 'fr' }),
        { autoPublish: true },
      );
      expect(updateWorkspaceSettingsBody.parse({ git })).toEqual({ git });
    }
  });

  it('leaves what the validator refuses for the server to refuse, as before', () => {
    const git = gitConnectionPayload(values({ provider: 'git', cloneUrl: 'https://user:token@git.example.com/docs.git' }), {});
    expect(updateWorkspaceSettingsBody.safeParse({ git }).success).toBe(false);
  });
});

describe('sentGitConnectionValues: what a save reads back as', () => {
  it('matches the stored payload read back through gitConnectionValues, for every provider', () => {
    for (const provider of ['github', 'gitlab', 'git'] as const) {
      const draft = values({
        provider,
        repo: ' acme/docs ',
        cloneUrl: ' https://git.example.com/a.git ',
        instanceUrl: ' ',
        branch: ' ',
        path: ' guides ',
        importBranchId: 'b2',
      });
      expect(sentGitConnectionValues(draft)).toEqual(gitConnectionValues(gitConnectionPayload(draft, { autoPublish: true })));
    }
  });
});

describe('missingGitConnectionField', () => {
  it('needs the repository for GitHub and GitLab, and the clone URL for a Git URL', () => {
    expect(missingGitConnectionField(values({ repo: '  ' }))).toBe('repo');
    expect(missingGitConnectionField(values({ provider: 'gitlab', repo: '' }))).toBe('repo');
    expect(missingGitConnectionField(values({ provider: 'git', repo: 'acme/docs', cloneUrl: ' ' }))).toBe('cloneUrl');
    expect(missingGitConnectionField(values({ provider: 'git', repo: '', cloneUrl: 'https://git.example.com/a.git' }))).toBeUndefined();
    expect(missingGitConnectionField(values())).toBeUndefined();
  });
});
