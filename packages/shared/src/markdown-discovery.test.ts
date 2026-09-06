import { describe, expect, it } from 'vitest';
import {
  canonicalPathFromMarkdownAlias,
  decodePublishedPathname,
  documentUrlForBase,
  markdownAliasPath,
  markdownAlternateUrl,
  markdownDiscoveryLinkHeader,
} from './markdown-discovery';

describe('llms.txt v2 Markdown discovery', () => {
  it('uses stable sibling aliases and an index alias for the origin root', () => {
    expect(markdownAliasPath('/guides/migrate')).toBe('/guides/migrate.md');
    expect(markdownAliasPath('/')).toBe('/_index.md');
    expect(canonicalPathFromMarkdownAlias('/guides/migrate.md')).toBe('/guides/migrate');
    expect(canonicalPathFromMarkdownAlias('/_index.md')).toBe('/');
    expect(canonicalPathFromMarkdownAlias('/index.md')).toBe('/index');
    expect(canonicalPathFromMarkdownAlias('/llms.txt')).toBeNull();
  });

  it('preserves query parameters on the Markdown alternate', () => {
    expect(markdownAlternateUrl('https://docs.example.com/start?lang=ar')).toBe('https://docs.example.com/start.md?lang=ar');
  });

  it('advertises both the Markdown alternate and covering llms index', () => {
    expect(markdownDiscoveryLinkHeader('https://docs.example.com/start', 'https://docs.example.com/llms.txt')).toBe(
      '<https://docs.example.com/start.md>; rel="alternate"; type="text/markdown", <https://docs.example.com/llms.txt>; rel="describedby"',
    );
  });

  it('preserves a path-bearing site base when joining published document URLs', () => {
    expect(documentUrlForBase('https://app.example.com/sites/project-1', '/getting-started', '?lang=ar')).toBe(
      'https://app.example.com/sites/project-1/getting-started?lang=ar',
    );
    expect(documentUrlForBase('https://docs.example.com/', '/')).toBe('https://docs.example.com');
  });

  it('normalizes long runs of boundary slashes in linear time', () => {
    const slashes = '/'.repeat(10_000);

    expect(markdownAliasPath(`/guides${slashes}`)).toBe('/guides.md');
    expect(documentUrlForBase(`https://docs.example.com${slashes}`, `${slashes}guide${slashes}`)).toBe('https://docs.example.com/guide');
  });

  it('decodes Unicode path segments once and rejects malformed escapes', () => {
    expect(decodePublishedPathname('/ar/%D8%A7%D9%84%D9%85%D9%82%D8%AF%D9%85%D8%A9')).toBe('/ar/المقدمة');
    expect(decodePublishedPathname('/docs/%252F')).toBe('/docs/%2F');
    expect(decodePublishedPathname('/docs/%E0%A4%A')).toBeNull();
  });
});
