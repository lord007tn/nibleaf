import { gitOperationBody } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import { gitSyncRequest, gitUpdatePrRequest, isGitOperationFor } from './git-operation';

const KEY = '7f0c2c1e-4b8a-4d0e-9b51-0a9e6c1d2f3a';

describe('Git operation requests', () => {
  it("Sync pulls the connection's base branch, as main sent it", () => {
    const request = gitSyncRequest('site-a', KEY, 'release/v2');
    expect(request).toEqual({ projectId: 'site-a', body: { idempotencyKey: KEY, kind: 'PULL', sourceRef: 'release/v2' } });
    expect(Object.keys(request.body)).toEqual(['idempotencyKey', 'kind', 'sourceRef']);
    expect(gitOperationBody.parse(request.body)).toEqual(request.body);
  });

  it('Update PR sends every field raw, with createPullRequest, as main sent it', () => {
    const fields = { commitMessage: 'Update documentation', authorName: 'Ada Example', authorEmail: 'ada@example.com', pullRequestTitle: 'Docs' };
    const request = gitUpdatePrRequest('site-a', KEY, fields);
    expect(request).toEqual({ projectId: 'site-a', body: { idempotencyKey: KEY, kind: 'PUSH', ...fields, createPullRequest: true } });
    expect(Object.keys(request.body)).toEqual([
      'idempotencyKey',
      'kind',
      'commitMessage',
      'authorName',
      'authorEmail',
      'createPullRequest',
      'pullRequestTitle',
    ]);
    expect(gitOperationBody.parse(request.body)).toEqual(request.body);
  });

  it('trims, defaults and checks nothing: the server validator stays the authority', () => {
    const spaced = gitUpdatePrRequest('site-a', KEY, {
      commitMessage: '  Update docs  ',
      authorName: ' Ada ',
      authorEmail: 'ada@example.com',
      pullRequestTitle: '  Docs  ',
    });
    expect(spaced.body).toMatchObject({ commitMessage: '  Update docs  ', authorName: ' Ada ', pullRequestTitle: '  Docs  ' });
    // The validator trims on its side, as it did for main's body.
    expect(gitOperationBody.parse(spaced.body)).toMatchObject({ commitMessage: 'Update docs', authorName: 'Ada', pullRequestTitle: 'Docs' });

    const blank = gitUpdatePrRequest('site-a', KEY, { commitMessage: '', authorName: '', authorEmail: 'not-an-email', pullRequestTitle: '' });
    expect(blank.body).toMatchObject({ commitMessage: '', authorName: '', authorEmail: 'not-an-email', pullRequestTitle: '' });
    expect(gitOperationBody.safeParse(blank.body).success).toBe(false);

    expect(gitSyncRequest('site-a', KEY, '').body).toEqual({ idempotencyKey: KEY, kind: 'PULL', sourceRef: '' });
    expect(gitOperationBody.safeParse(gitSyncRequest('site-a', KEY, '').body).success).toBe(false);
  });

  it('a pending request is for its own site only', () => {
    const request = gitSyncRequest('site-a', KEY, 'main');
    expect(isGitOperationFor(request, 'site-a')).toBe(true);
    expect(isGitOperationFor(request, 'site-b')).toBe(false);
    expect(isGitOperationFor(undefined, 'site-a')).toBe(false);
    expect(isGitOperationFor(null, 'site-a')).toBe(false);
  });
});
