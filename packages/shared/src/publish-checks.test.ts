import { describe, expect, it } from 'vitest';
import { findBrokenInternalLinks, pageContentFacts } from './publish-checks';
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

  it('ignores links in comments, MDX expressions and JSX attributes', () => {
    expect(broken('<!-- [a](/in-comment) -->\n\nText.')).toEqual([]);
    expect(broken('{/* [a](/in-expression) */}\n\n<Card title="Next" href="/in-attribute" />')).toEqual([]);
  });

  it('reports a link inside an MDX component body', () => {
    expect(broken('<Note>\n\nSee [a](/missing).\n\n</Note>')).toEqual(['/missing']);
  });

  it('reads invalid MDX as the reader does (CommonMark + raw HTML)', () => {
    // `a < b` breaks MDX; the reader still renders the link.
    expect(broken('If a < b, see [a](/missing).\n\n<!-- [c](/commented) -->')).toEqual(['/missing']);
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

  it('matches labels case-insensitively, and an undefined reference renders as text', () => {
    expect(broken('See [Guide] and [nothing][none].\n\n[GUIDE]: /missing')).toEqual(['/missing']);
  });
});

describe('pageContentFacts', () => {
  it('finds images without alt text: inline, reference-style, multiline <img>, and inside components', () => {
    const content = [
      '![](/inline.png) ![Described](/ok.png)',
      '',
      '![][shot]',
      '',
      '[shot]: /reference.png',
      '',
      '<img',
      '  src="/multiline.png"',
      '/>',
      '',
      '<Frame>',
      '  <img src="/framed.png" alt="" />',
      '</Frame>',
      '',
      '<img src="/fine.png" alt="Chart" />',
      '',
      '<img src="/expression.png" alt={caption} />',
    ].join('\n');
    expect(pageContentFacts(content).imagesWithoutAlt).toEqual(['/inline.png', '/reference.png', '/multiline.png', '/framed.png']);
  });

  it('finds raw-HTML images in content that is not valid MDX', () => {
    expect(pageContentFacts('<!-- note -->\n\n<img\n  src="/raw.png">').imagesWithoutAlt).toEqual(['/raw.png']);
  });

  it('ignores images in code and comments', () => {
    expect(pageContentFacts('```\n![](/a.png)\n```\n\n<!-- ![](/b.png) -->').imagesWithoutAlt).toEqual([]);
  });

  it('finds stray text: a lone / paragraph, a literal --- and <p> leftovers, not dividers or code', () => {
    const content = ['Intro.', '', '/', '', '\\---', '', '---', '', 'Open / to search.', '', '```', '/', '```'].join('\n');
    expect(pageContentFacts(content).strayText).toEqual(['/', '---']);
    expect(pageContentFacts('<p>---</p>').strayText).toEqual(['---']);
  });
});
