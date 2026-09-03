import { describe, expect, it } from 'vitest';
import {
  canonicalPathFromMarkdownAlias,
  documentUrlForBase,
  markdownAliasPath,
  markdownAlternateUrl,
  markdownDiscoveryLinkHeader,
} from './markdown-discovery';

describe('llms.txt v2 Markdown discovery', () => {
  it('uses stable sibling aliases and an index alias for the origin root', () => {
    expect(markdownAliasPath('/guides/migrate')).toBe('/guides/migrate.md');
    expect(markdownAliasPath('/')).toBe('/index.md');
    expect(canonicalPathFromMarkdownAlias('/guides/migrate.md')).toBe('/guides/migrate');
    expect(canonicalPathFromMarkdownAlias('/index.md')).toBe('/');
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
});
