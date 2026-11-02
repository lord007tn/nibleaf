import { expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getCommit: vi.fn(), getTree: vi.fn() }));
vi.mock('octokit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('octokit')>();
  return {
    ...actual,
    Octokit: class {
      rest = { repos: { getCommit: api.getCommit }, git: { getTree: api.getTree } };
    },
  };
});

import { getGitHubSnapshot } from './github';

it('pins the tree walk to the resolved commit instead of the mutable branch or tree ID', async () => {
  api.getCommit.mockResolvedValue({ data: { sha: 'immutable-commit' } });
  api.getTree.mockResolvedValue({ data: { sha: 'tree-object', tree: [{ path: 'README.md', type: 'blob' }] } });
  expect(await getGitHubSnapshot('public', 'docs', 'main')).toEqual({ revision: 'immutable-commit', files: [{ path: 'README.md', type: 'blob' }] });
  expect(api.getTree).toHaveBeenCalledWith({ owner: 'public', repo: 'docs', tree_sha: 'immutable-commit', recursive: 'true' });
});
