import { describe, expect, it, vi } from 'vitest';
import { GitHubProvider } from './github';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('GitHub provider adapter', () => {
  it('enforces repository write permission before connecting', async () => {
    const request = vi.fn(async () => json({ permissions: { push: false } }));
    const provider = new GitHubProvider('never-log-this-token', request as typeof fetch);
    await expect(provider.verifyWriteAccess('acme/docs')).rejects.toThrow(/contents write access/);
  });

  it('uses compare-and-swap semantics and refuses a divergent ref', async () => {
    const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ object: { sha: 'new-upstream-sha' } }));
    const provider = new GitHubProvider('token', request as typeof fetch);
    await expect(provider.updateBranch('acme/docs', 'nibleaf/docs', 'new-commit', 'expected-old')).rejects.toThrow(/changed during the push/);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer token' });
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
    const provider = new GitHubProvider('token', request as typeof fetch);
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

  it('does not leak credentials through provider errors', async () => {
    const request = vi.fn(async () => json({ message: 'Forbidden' }, 403));
    const provider = new GitHubProvider('super-secret-token', request as typeof fetch);
    await expect(provider.verifyWriteAccess('acme/docs')).rejects.not.toThrow(/super-secret-token/);
  });
});
