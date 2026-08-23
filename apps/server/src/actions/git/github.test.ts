import { describe, expect, it, vi } from 'vitest';
import { GitHubProvider } from './github';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('GitHub provider adapter', () => {
  it('verifies the provider identity without a repository request', async () => {
    const request = vi.fn(async () => json({ login: 'octocat', name: 'The Octocat' }));
    const provider = new GitHubProvider('never-log-this-token', request);
    await expect(provider.verifyIdentity()).resolves.toEqual({ login: 'octocat', name: 'The Octocat' });
    expect(request).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'token never-log-this-token' }) }),
    );
  });

  it('enforces repository write permission before connecting', async () => {
    const request = vi.fn(async () => json({ permissions: { push: false } }));
    const provider = new GitHubProvider('never-log-this-token', request);
    await expect(provider.verifyWriteAccess('acme/docs')).rejects.toThrow(/contents write access/);
  });

  it('uses compare-and-swap semantics and refuses a divergent ref', async () => {
    const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ object: { sha: 'new-upstream-sha' } }));
    const provider = new GitHubProvider('token', request);
    await expect(provider.updateBranch('acme/docs', 'nibleaf/docs', 'new-commit', 'expected-old')).rejects.toThrow(/changed during the push/);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: 'token token' });
  });

  it('updates an existing draft pull request instead of creating a duplicate', async () => {
    const pull = {
      number: 12,
      html_url: 'https://github.com/acme/docs/pull/12',
      title: 'Old',
      state: 'open',
      draft: true,
      base: { ref: 'main' },
      head: { ref: 'nibleaf/docs', sha: 'abc' },
    };
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      json(init?.method === 'PATCH' ? { ...pull, title: 'New' } : [pull]),
    );
    const provider = new GitHubProvider('token', request);
    const result = await provider.upsertDraftPullRequest({
      repository: 'acme/docs',
      baseBranch: 'main',
      headBranch: 'nibleaf/docs',
      title: 'New',
      body: 'Summary',
    });
    expect(result).toMatchObject({ number: 12, title: 'New', draft: true });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]?.method).toBe('PATCH');
  });

  it('bounds concurrent blob downloads for large documentation trees', async () => {
    const entries = Array.from({ length: 24 }, (_, index) => ({
      path: `docs/page-${index}.mdx`,
      type: 'blob',
      sha: `blob-${index}`,
      size: 100,
    }));
    let activeBlobs = 0;
    let maxActiveBlobs = 0;
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/git/trees/')) return json({ truncated: false, tree: entries });
      activeBlobs += 1;
      maxActiveBlobs = Math.max(maxActiveBlobs, activeBlobs);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeBlobs -= 1;
      const sha = url.split('/').pop() ?? '';
      return json({ encoding: 'base64', content: Buffer.from(sha).toString('base64') });
    });
    const provider = new GitHubProvider('token', request);

    const files = await provider.listMarkdownFiles('acme/docs', 'head-sha', 'docs');

    expect(files).toHaveLength(entries.length);
    expect(files.map((file) => file.path)).toEqual(entries.map((entry) => entry.path));
    expect(maxActiveBlobs).toBeGreaterThan(1);
    expect(maxActiveBlobs).toBeLessThanOrEqual(8);
  });

  it('lists the bounded text theme surface without decoding customer binary assets', async () => {
    const entries = [
      { path: 'nibleaf.theme.json', type: 'blob', sha: 'manifest', size: 100 },
      { path: '.nibleaf/snapshot.json', type: 'blob', sha: 'snapshot', size: 100 },
      { path: 'src/theme/HarborTheme.tsx', type: 'blob', sha: 'theme', size: 100 },
      { path: 'content/welcome.mdx', type: 'blob', sha: 'content', size: 100 },
      { path: 'public/logo.png', type: 'blob', sha: 'binary-logo', size: 100 },
      { path: 'unmanaged.txt', type: 'blob', sha: 'unmanaged', size: 100 },
    ];
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/git/trees/')) return json({ truncated: false, tree: entries });
      const sha = url.split('/').pop() ?? '';
      return json({ encoding: 'base64', content: Buffer.from(sha).toString('base64') });
    });
    const provider = new GitHubProvider('token', request as typeof fetch);

    const files = await provider.listThemeRepositoryFiles('acme/docs', 'head-sha', 'content');

    expect(files.map((file) => file.path)).toEqual([
      'nibleaf.theme.json',
      '.nibleaf/snapshot.json',
      'src/theme/HarborTheme.tsx',
      'content/welcome.mdx',
    ]);
  });

  it('does not leak credentials through provider errors', async () => {
    const request = vi.fn(async () => json({ message: 'Forbidden' }, 403));
    const provider = new GitHubProvider('super-secret-token', request);
    await expect(provider.verifyWriteAccess('acme/docs')).rejects.not.toThrow(/super-secret-token/);
  });

  it('does not leak credentials through authorization errors', async () => {
    const request = vi.fn(async () => json({ message: 'Bad credentials' }, 401));
    const provider = new GitHubProvider('super-secret-token', request);
    await expect(provider.verifyIdentity()).rejects.not.toThrow(/super-secret-token/);
  });
});
