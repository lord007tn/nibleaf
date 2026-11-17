import { gitConnectionBody } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import {
  type GitWorkflowConnectionValues,
  gitWorkflowConnectionPayload,
  gitWorkflowConnectionValues,
  gitWorkflowTokenToSend,
  missingGitWorkflowConnectionFields,
  sentGitWorkflowConnectionValues,
} from './git-workflow-connection';

// Fictional, low-entropy fixture values; never a real credential.
const TOKEN = 'fixture-token-0000000000000000';
const values = (overrides: Partial<GitWorkflowConnectionValues> = {}): GitWorkflowConnectionValues => ({
  repository: 'acme-fixture/docs',
  baseBranch: 'main',
  headBranch: 'nibleaf/docs',
  contentPath: 'docs',
  ...overrides,
});
const stored = { ...values(), importBranchId: 'branch-fixture-1', importLanguageId: 'language-fixture-1' };

/**
 * Typed values → what `connectGitHub` stores and the status reads back. The
 * same table drives `apps/server/src/actions/git/workflow.test.ts`, which sends
 * these bodies through the real validator and `connectGitHub`.
 */
const NORMALIZED: Array<[string, GitWorkflowConnectionValues, GitWorkflowConnectionValues]> = [
  [
    'a GitHub URL with .git and padding',
    values({ repository: '  https://github.com/acme-fixture/moved.git  ' }),
    values({ repository: 'acme-fixture/moved' }),
  ],
  ['an upper-case URL prefix and suffix', values({ repository: 'HTTPS://GITHUB.COM/acme-fixture/docs.GIT' }), values()],
  [
    'refs/heads/ branches',
    values({ baseBranch: ' refs/heads/trunk ', headBranch: 'refs/heads/nibleaf/edit' }),
    values({ baseBranch: 'trunk', headBranch: 'nibleaf/edit' }),
  ],
  ['a path with slashes and backslashes', values({ contentPath: ' /content\\guides/ ' }), values({ contentPath: 'content/guides' })],
  ['a blank path (the repository root)', values({ contentPath: '   ' }), values({ contentPath: '' })],
];

describe('gitWorkflowConnectionValues', () => {
  it('takes only the four settings, never the targets, credential, webhook or sync state', () => {
    expect(
      gitWorkflowConnectionValues({ ...stored, credentialConfigured: true, webhookConfigured: true, lastSyncStatus: 'RUNNING' } as typeof stored),
    ).toEqual(values());
  });
});

describe('sentGitWorkflowConnectionValues', () => {
  it.each(NORMALIZED)('stores %s as the server normalizes it', (_name, typed, expected) => {
    expect(sentGitWorkflowConnectionValues(typed)).toEqual(expected);
  });

  it('leaves values already stored as they are', () => {
    expect(sentGitWorkflowConnectionValues(values())).toEqual(values());
  });
});

describe('gitWorkflowConnectionPayload', () => {
  it('sends the settings as typed and the import targets as the latest status holds them', () => {
    const typed = values({ repository: ' https://github.com/acme-fixture/moved.git ', contentPath: 'guides/' });
    expect(gitWorkflowConnectionPayload(typed, stored)).toEqual({
      ...typed,
      importBranchId: 'branch-fixture-1',
      importLanguageId: 'language-fixture-1',
    });
  });

  it('leaves out a target the status holds none of (the server keeps it null)', () => {
    expect(gitWorkflowConnectionPayload(values(), { ...stored, importBranchId: null, importLanguageId: null })).toEqual(values());
    expect(gitWorkflowConnectionPayload(values(), { ...stored, importLanguageId: null })).toEqual({
      ...values(),
      importBranchId: 'branch-fixture-1',
    });
    expect(gitWorkflowConnectionPayload(values(), null)).toEqual(values());
  });

  it('sends a token only when one was typed: blank keeps the stored credential', () => {
    expect(gitWorkflowConnectionPayload(values(), stored, '')).not.toHaveProperty('token');
    expect(gitWorkflowConnectionPayload(values(), stored, '   ')).not.toHaveProperty('token');
    expect(gitWorkflowConnectionPayload(values(), stored, TOKEN).token).toBe(TOKEN);
    expect(gitWorkflowTokenToSend(' \t')).toBeUndefined();
  });

  it('never sends a webhook secret, credential state, operations or display defaults', () => {
    const body = gitWorkflowConnectionPayload(values(), { ...stored, webhookConfigured: true, credentialConfigured: true } as typeof stored);
    expect(Object.keys(body).sort()).toEqual(['baseBranch', 'contentPath', 'headBranch', 'importBranchId', 'importLanguageId', 'repository']);
  });

  it.each(NORMALIZED)('passes the real validator for %s', (_name, typed) => {
    const parsed = gitConnectionBody.safeParse(gitWorkflowConnectionPayload(typed, stored, TOKEN));
    expect(parsed.success).toBe(true);
  });
});

describe('missingGitWorkflowConnectionFields', () => {
  it('lists the blank required settings in form order; the path may be blank', () => {
    expect(missingGitWorkflowConnectionFields(values({ contentPath: '' }))).toEqual([]);
    expect(missingGitWorkflowConnectionFields(values({ repository: ' ', headBranch: '' }))).toEqual(['repository', 'headBranch']);
    expect(missingGitWorkflowConnectionFields(values({ baseBranch: '\t' }))).toEqual(['baseBranch']);
  });
});
