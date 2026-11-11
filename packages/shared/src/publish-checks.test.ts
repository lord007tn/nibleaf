import { describe, expect, it } from 'vitest';
import { documentationComponentContractEntries } from './documentation-component-contract';
import { findBrokenInternalLinks } from './publish-checks';
import type { SiteSnapshot, SnapshotPage } from './site';

let sequence = 0;
const page = (overrides: Partial<SnapshotPage> & Pick<SnapshotPage, 'path'>): SnapshotPage => {
  sequence += 1;
  return {
    id: `page-${sequence}`,
    parentId: null,
    versionId: 'v1',
    updatedAt: '2026-11-01T00:00:00.000Z',
    languageCode: 'en',
    kind: 'PAGE',
    title: `Page ${sequence}`,
    slug: overrides.path.split('/').at(-1) ?? '',
    icon: null,
    description: null,
    content: 'Body.',
    config: null,
    translationKey: null,
    position: sequence,
    hidden: false,
    ...overrides,
  };
};

const site = (pages: SnapshotPage[]): SiteSnapshot => ({
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: null,
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
    versions: [{ id: 'v1', name: 'Latest', slug: 'latest', isDefault: true }],
  },
  pages,
  generatedAt: '2026-11-01T00:00:00.000Z',
});

/** The broken links on one page with `content`, next to an existing `/exists` page. */
const broken = (content: string) =>
  findBrokenInternalLinks(site([page({ path: 'start', content }), page({ path: 'exists' })])).map((link) => link.href);

describe('code boundaries come from the parsed tree', () => {
  it('reports a link between escaped backticks (they are not code)', () => {
    expect(broken('Use \\`[a](/missing)\\` here.')).toEqual(['/missing']);
  });

  it('ignores a link inside a code span that spans lines', () => {
    expect(broken('Run `npm run\n[a](/missing)` first.\n\nThen [b](/exists).')).toEqual([]);
  });

  it('ignores a link inside indented code, which the reader renders as code', () => {
    expect(broken('Example:\n\n    [a](/missing)\n\nAnd [b](/exists).')).toEqual([]);
  });

  it('ignores a link inside a fence closed only by a longer or equal delimiter', () => {
    expect(broken('````md\n```\n[a](/missing)\n```\n````\n\n[b](/gone)')).toEqual(['/gone']);
  });

  it('ignores links in HTML comments and non-link JSX attributes', () => {
    expect(broken('<!-- [a](/in-comment) -->\n\nText.')).toEqual([]);
    expect(broken('<Card title="[Next](/in-attribute)" />')).toEqual([]);
  });

  it('skips a link in an MDX comment, which the reader drops', () => {
    expect(broken('{/* [a](/in-expression) */}')).toEqual([]);
    expect(broken('Text {/* see [a](/inline-comment) */} and [b](/missing).')).toEqual(['/missing']);
  });

  it('reports a link inside an MDX component body', () => {
    expect(broken('<Note>\n\nSee [a](/missing).\n\n</Note>')).toEqual(['/missing']);
  });

  it('reads invalid MDX as the reader does (CommonMark + raw HTML)', () => {
    // `a < b` breaks MDX; the reader still renders the link.
    expect(broken('If a < b, see [a](/missing).\n\n<!-- [c](/commented) -->')).toEqual(['/missing']);
  });
});

describe('literal hrefs on elements the reader renders as links', () => {
  // The link components come from the reader's component contract, the source
  // mdx-config's sanitizer and the component map are built from.
  const hrefComponents = documentationComponentContractEntries().flatMap(([tag, component]) => ('href' in component.attributes ? [tag] : []));
  it('takes link components from the reader contract', () => {
    expect([...hrefComponents].sort()).toEqual(['Button', 'Card', 'RelatedCard']);
  });
  it.each(hrefComponents)('checks every contract component with an href: %s', (tag) => {
    expect(broken(`<${tag} href="/missing">Next</${tag}>`)).toEqual(['/missing']);
  });

  it.each(['Card', 'Button', 'RelatedCard', 'a'])('checks %s literals and ignores expressions', (tag) => {
    expect(broken(`<${tag} href="/missing">Next</${tag}>`)).toEqual(['/missing']);
    expect(broken(`<${tag} href='/exists'>Next</${tag}>`)).toEqual([]);
    expect(broken(`<${tag} href={"/missing"}>Next</${tag}>`)).toEqual([]);
    expect(broken(`<${tag} href={destination}>Next</${tag}>`)).toEqual([]);
  });

  it('finds CardGroup children and inline links in document order, including inside raw HTML', () => {
    expect(
      broken(
        '<CardGroup>\n\n<Card href="/card">Next</Card>\n\n</CardGroup>\n\nText <Button href="/button">Go</Button>.\n\n<div><a href="/anchor">Go</a></div>',
      ),
    ).toEqual(['/card', '/button', '/anchor']);
  });

  it("matches the reader's case-insensitive HTML tags and attributes", () => {
    expect(broken('<card HREF="/card" />\n\n<RELATEDCARD href="/related" />\n\n<button href="/button">Go</button>')).toEqual([
      '/card',
      '/related',
      '/button',
    ]);
  });

  it('ignores non-link component props', () => {
    expect(broken('<CardGroup href="/group"><Note href="/note" /></CardGroup>')).toEqual([]);
  });

  it('skips external URLs, anchors and files just like Markdown links', () => {
    expect(
      broken(
        '<Card href="https://example.com/missing" />\n\n<Button href="#section">Go</Button>\n\n<RelatedCard href="/file.pdf" />\n\n<a href="//example.com/missing">Go</a>',
      ),
    ).toEqual([]);
  });

  it('ignores JSX examples in fenced, inline and indented code', () => {
    expect(broken('`<Card href="/inline" />`\n\n```mdx\n<Button href="/fenced">Go</Button>\n```\n\n    <a href="/indented">Go</a>')).toEqual([]);
  });

  it('resolves component hrefs relative to the page with version, language, twins and redirects', () => {
    const snapshot = site([
      page({
        path: 'guides/intro',
        versionId: 'v2',
        languageCode: 'ar',
        content:
          '<Card href="next.mdx?lang=ar#top" />\n\n<RelatedCard href="/old" />\n\n<Button href="/next.md?lang=en">Go</Button>\n\n<a href="/missing?lang=ar">Go</a>',
      }),
      page({ path: 'guides/next', versionId: 'v2', languageCode: 'ar' }),
      page({ path: 'next', versionId: 'v2', languageCode: 'ar' }),
    ]);
    snapshot.project.versions.push({ id: 'v2', name: 'v2', slug: 'v2', isDefault: false });
    snapshot.project.languages.push({ code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false, config: null });
    snapshot.project.config = { redirects: [{ from: '/v2/old', to: '/v2/next?lang=ar' }] };
    expect(findBrokenInternalLinks(snapshot).map((link) => link.href)).toEqual(['/next.md?lang=en', '/missing?lang=ar']);
  });

  it('applies the reader path length bound to literal component hrefs', () => {
    const href = `/${'x'.repeat(2048)}`;
    expect(findBrokenInternalLinks(site([page({ path: 'start', content: `<Card href="${href}" />` })]))).toEqual([
      expect.objectContaining({ href, reason: 'path-too-long' }),
    ]);
  });
});

describe('reference links resolve through definitions that are used', () => {
  it('reports a used definition, ignores an unused one', () => {
    expect(broken('See [the guide][used].\n\n[used]: /missing-used\n[unused]: /missing-unused')).toEqual(['/missing-used']);
  });

  it('uses the first of duplicate definitions (CommonMark)', () => {
    expect(broken('See [guide].\n\n[guide]: /exists\n[guide]: /missing-second')).toEqual([]);
    expect(broken('See [guide].\n\n[guide]: /missing-first\n[guide]: /exists')).toEqual(['/missing-first']);
  });

  it('treats a footnote as a footnote, not a page link, and still reads links in table cells', () => {
    expect(broken('A claim.[^1]\n\n[^1]: Source text\n\n| a | b |\n| - | - |\n| [x](/missing-cell) | y |')).toEqual(['/missing-cell']);
  });

  it('matches labels case-insensitively, and an undefined reference renders as text', () => {
    expect(broken('See [Guide] and [nothing][none].\n\n[GUIDE]: /missing')).toEqual(['/missing']);
  });
});

describe('over-long links', () => {
  it('reports a link longer than the reader serves as broken, with its reason', () => {
    const href = `/${'x'.repeat(3000)}`;
    const snapshot = site([page({ path: 'exists' }), page({ path: 'home', content: `See [it](${href}).` })]);
    expect(findBrokenInternalLinks(snapshot).map(({ href: link, reason }) => ({ length: link.length, reason }))).toEqual([
      { length: href.length, reason: 'path-too-long' },
    ]);
  });
});
