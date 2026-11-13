import { describe, expect, it } from 'vitest';
import { rewriteGitBookImages } from './gitbook-assets';
import { convertGitBookMarkdown, findGitBookSpaceLinks } from './gitbook-markdown';
import { rewriteMintlifyAssetReferences } from './mintlify-assets';
import { mintlifyInternalLinkTargets, rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

const converters = [
  [
    'GitBook',
    (source: string, issues: string[]) => {
      const result = convertGitBookMarkdown(source, { resolveFile: () => undefined });
      issues.push(...result.issues.map(({ reference }) => reference));
      return result.content;
    },
  ],
  ['Mintlify', (source: string, issues: string[]) => normalizeMintlifyMdx(source, (url) => issues.push(url))],
] as const;

const codeForms = [
  ['indented Markdown', 'Example:\n\n    [Next](https://help.test/next)\n    [Missing](https://help.test/missing)'],
  ['fenced Markdown', 'Example:\n\n```md\n[Next](https://help.test/next)\n[Missing](https://help.test/missing)\n```'],
  ['nested list code', '- Outer\n\n  - Example:\n\n        [Next](https://help.test/next)\n        [Missing](https://help.test/missing)'],
  ['blockquote code', '> Example:\n>\n>     [Next](https://help.test/next)\n>     [Missing](https://help.test/missing)'],
  ['quoted fence', '> ```md\n> [Next](https://help.test/next)\n> [Missing](https://help.test/missing)\n> ```'],
  ['indented HTML anchor', 'Example:\n\n    <a href="https://help.test/next">Next</a>\n    <a href="https://help.test/missing">Missing</a>'],
] as const;

describe.each(converters)('council re-check at 4a3bb650: %s', (_name, convert) => {
  it.each(codeForms)('P1: preserves %s through conversion and link rewriting without reports', (_form, source) => {
    const issues: string[] = [];
    const converted = convert(source, issues);
    expect(converted).toBe(source);
    const linked = rewriteMintlifyInternalLinks(converted, 'intro', new Map([['next', '/guide/next']]), {
      sourceUrl: 'https://help.test',
      onUnresolved: (url) => issues.push(url),
    });
    expect(issues).toEqual([]);
    expect(linked).toBe(source);
    expect(mintlifyInternalLinkTargets(linked, 'intro', 'https://help.test')).toEqual([]);
  });

  it('P1: keeps literal images and space links out of post-conversion rewrites and reports', () => {
    const source = 'Example:\n\n    ![Example](./next.png)\n    ![Missing](./missing.png)\n    https://app.gitbook.com/s/neutral/next';
    const converted = convert(source, []);
    const blobs = new Set(['next.png']);
    expect(rewriteGitBookImages(converted, 'intro.md', blobs, '', (path) => `https://assets.test/${path}`)).toEqual({ content: source, missing: [] });
    expect(rewriteMintlifyAssetReferences(converted, 'intro.mdx', blobs, (path) => `https://assets.test/${path}`)).toEqual({
      content: source,
      missing: [],
      resolved: [],
    });
    expect(findGitBookSpaceLinks(converted)).toEqual([]);
  });

  it.each([true, false])('P2: retains top-level video src metadata (controls present: %s)', (controls) => {
    const opener = `<video src="https://cdn.test/a.mp4" poster="/poster.jpg" title="Original" width="640"${controls ? ' controls' : ''}>`;
    const children = '<track kind="captions" src="/captions.vtt" srclang="en"></video>';
    const issues: string[] = [];
    expect(convert(opener + children, issues)).toBe((controls ? opener : opener.replace('>', ' controls="true">')) + children);
    expect(issues).toEqual([]);
  });
});
