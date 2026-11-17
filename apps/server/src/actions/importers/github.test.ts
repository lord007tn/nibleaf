import { MAX_PAGE_CONTENT_BYTES } from '@nibleaf/shared/page-limits';
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
      signal: expect.any(AbortSignal),
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

it('caps a repository file at the shared page size, in bytes', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) => new Response(url.endsWith('limit.md') ? 'x'.repeat(MAX_PAGE_CONTENT_BYTES) : 'é'.repeat(MAX_PAGE_CONTENT_BYTES / 2 + 1)),
    ),
  );
  await expect(getGitHubTextFile('acme', 'docs', 'main', 'limit.md')).resolves.toHaveLength(MAX_PAGE_CONTENT_BYTES);
  await expect(getGitHubTextFile('acme', 'docs', 'main', 'accents.md')).rejects.toMatchObject({ code: 'import:limit' });
});

it('cancels oversized decoded text before consuming the remaining stream', async () => {
  const cancel = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
            cancel,
          }),
        ),
    ),
  );
  await expect(getGitHubTextFile('acme', 'docs', 'main', 'large.md')).rejects.toThrow(/2 MiB/);
  expect(cancel).toHaveBeenCalledOnce();
});

it('wraps a stream timeout as a definite application error', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new DOMException('Timed out', 'TimeoutError'));
            },
          }),
        ),
    ),
  );
  await expect(getGitHubTextFile('acme', 'docs', 'main', 'file.md')).rejects.toMatchObject({ code: 'http:bad_request', status: 400 });
});
