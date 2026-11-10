import { describe, expect, it } from 'vitest';
import { isPageQuery, matchPages, normalizeLinkUrl } from './link-utils';

describe('normalizeLinkUrl', () => {
  it('accepts http(s) URLs as-is', () => {
    expect(normalizeLinkUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeLinkUrl('http://example.com/a?b=1#c')).toBe('http://example.com/a?b=1#c');
    expect(normalizeLinkUrl('  https://example.com  ')).toBe('https://example.com');
  });

  it('accepts mailto:, tel:, anchors, and site-relative paths', () => {
    expect(normalizeLinkUrl('mailto:hi@example.com')).toBe('mailto:hi@example.com');
    expect(normalizeLinkUrl('tel:+15551234567')).toBe('tel:+15551234567');
    expect(normalizeLinkUrl('#installation')).toBe('#installation');
    expect(normalizeLinkUrl('/guides/intro')).toBe('/guides/intro');
  });

  it('upgrades bare domains to https', () => {
    expect(normalizeLinkUrl('example.com')).toBe('https://example.com');
    expect(normalizeLinkUrl('www.example.com/docs?x=1')).toBe('https://www.example.com/docs?x=1');
    expect(normalizeLinkUrl('docs.foo.io:8080/bar')).toBe('https://docs.foo.io:8080/bar');
  });

  it('accepts document-relative paths as-is', () => {
    expect(normalizeLinkUrl('./getting-started')).toBe('./getting-started');
    expect(normalizeLinkUrl('../guides/intro')).toBe('../guides/intro');
    // Never mistaken for a bare domain (no https:// upgrade).
    expect(normalizeLinkUrl('../foo.md')).toBe('../foo.md');
  });

  it('accepts scheme-less bare relative paths', () => {
    expect(normalizeLinkUrl('getting-started')).toBe('getting-started');
    expect(normalizeLinkUrl('guides/intro#setup')).toBe('guides/intro#setup');
  });

  it('rejects unsafe or unknown schemes', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('JavaScript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('data:text/html;base64,PGI+')).toBeNull();
    expect(normalizeLinkUrl('vbscript:msgbox')).toBeNull();
    expect(normalizeLinkUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeLinkUrl('ftp://example.com')).toBeNull();
  });

  it('rejects malformed or empty input', () => {
    expect(normalizeLinkUrl('')).toBeNull();
    expect(normalizeLinkUrl('   ')).toBeNull();
    expect(normalizeLinkUrl('not a url')).toBeNull();
    expect(normalizeLinkUrl('https://')).toBeNull();
    expect(normalizeLinkUrl('mailto:')).toBeNull();
    expect(normalizeLinkUrl('tel:')).toBeNull();
    // Protocol-relative URLs inherit the scheme — too easy to abuse, reject.
    expect(normalizeLinkUrl('//evil.com')).toBeNull();
  });
});

describe('isPageQuery (AUTH-02)', () => {
  it('treats bare words typed in the link field as a page search', () => {
    expect(isPageQuery('Getting')).toBe(true);
    expect(isPageQuery('getting-started')).toBe(true);
    expect(isPageQuery('Getting started')).toBe(true);
  });

  it('treats links, paths, anchors and domains as links', () => {
    for (const value of ['https://example.com', 'mailto:a@b.co', '/getting-started', '#setup', './intro', '../intro', 'example.com', '', '  ']) {
      expect(isPageQuery(value)).toBe(false);
    }
  });
});

describe('matchPages', () => {
  const pages = [
    { kind: 'PAGE', title: 'Install guide', path: 'install' },
    { kind: 'PAGE', title: 'Getting started', path: 'getting-started' },
    { kind: 'GROUP', title: 'Getting there', path: 'there' },
    { kind: 'PAGE', title: 'Quickstart', path: 'guides/getting-going' },
  ];

  it('ranks titles that start with the query first and also matches the address', () => {
    expect(matchPages(pages, 'getting').map((page) => page.title)).toEqual(['Getting started', 'Quickstart']);
  });

  it('never offers groups', () => {
    expect(matchPages(pages, 'there')).toEqual([]);
  });
});
