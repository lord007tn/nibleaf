import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGitHubTextFile } from './github';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getGitHubTextFile', () => {
  it('reads public files from the raw-content origin without consuming the Contents API limit', async () => {
    const request = vi.fn(async () => new Response('# Intro', { status: 200 }));
    vi.stubGlobal('fetch', request);

    await expect(getGitHubTextFile('acme', 'docs', 'main', 'guides/intro.mdx')).resolves.toBe('# Intro');
    expect(request).toHaveBeenCalledWith('https://raw.githubusercontent.com/acme/docs/main/guides/intro.mdx', {
      headers: { Accept: 'text/plain', 'User-Agent': 'nibleaf-importer' },
      redirect: 'error',
    });
  });

  it('returns null for a missing raw file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );

    await expect(getGitHubTextFile('acme', 'docs', 'main', 'missing.mdx')).resolves.toBeNull();
  });
});
