import { describe, expect, it, vi } from 'vitest';
import { documentationComponentContractEntries } from './documentation-component-contract';
import { offsetInRanges } from './page-content-facts';
import {
  buildInboundPageLinkMap,
  buildInboundPageLinkMapAsync,
  findBrokenInternalLinks,
  findInboundPageLinks,
  pageContentFacts,
  snapshotContentFacts,
} from './publish-checks';
import type { SiteSnapshot, SnapshotPage } from './site';

// Some tests here work through large generated case sets or whole documentation
// corpora. On a loaded CI runner such tests have taken ~28x as long as on a laptop
// (5.5 s against 0.19 s), past Vitest's 5 s default, so the file gets an explicit
// timeout. Their cost stays linear; the *.growth.test.ts files pin that.
vi.setConfig({ testTimeout: 60_000 });

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

describe('inbound draft page links', () => {
  const target = () => page({ id: 'target', path: 'guide', kind: 'GROUP' });
  const child = () => page({ id: 'child', parentId: 'target', path: 'guide/setup', content: '[self](/guide/setup)' });

  it('keeps mixed async results identical, capped and ordered across slices', async () => {
    const snapshot = site([
      target(),
      child(),
      page({ id: 'ar-child', path: 'guide/setup', languageCode: 'ar' }),
      page({ id: 'ar-source', path: 'ar-source', languageCode: 'ar', content: '[Arabic](/guide/setup)' }),
      page({ id: 'v2-target', path: 'setup', versionId: 'v2' }),
      page({ id: 'v2-source', path: 'source', versionId: 'v2', content: '[Own](https://docs.example.test/v2/setup)' }),
      page({ path: 'ignored', content: '`[code](/guide)`\n\n<!-- [comment](/guide) -->\n\n[external](https://foreign.test/guide)' }),
      page({ path: 'guide/relative', content: '[Relative](setup.md#section)' }),
      ...Array.from({ length: 27 }, (_, i) =>
        page({
          id: `mixed-${i}`,
          path: `mixed-${i}`,
          hidden: i % 2 === 0,
          content:
            i % 3 === 0
              ? '<Card href="/old">Setup</Card>'
              : i % 3 === 1
                ? '[Ref][setup]\n\n[setup]: /guide/setup'
                : '<a href="https://docs.example.test/guide/setup">Setup</a>',
        }),
      ),
    ]);
    snapshot.project.config = { redirects: [{ from: '/old', to: '/guide/setup' }] };
    snapshot.project.languages.push({ code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false, config: null });
    snapshot.project.versions.push({ id: 'v2', name: 'v2', slug: 'v2', isDefault: false });
    const origins = ['https://docs.example.test'];
    let clock = 0;
    let yields = 0;
    const result = await buildInboundPageLinkMapAsync(snapshot, origins, {
      now: () => {
        clock += 5;
        return clock;
      },
      yieldToEventLoop: async () => {
        yields++;
      },
    });
    expect(result).toEqual(buildInboundPageLinkMap(snapshot, origins));
    expect(yields).toBeGreaterThan(1);
    expect(result.get('target')?.total).toBe(28);
    expect(result.get('target')?.pages).toHaveLength(20);
    expect(result.get('target')?.pages[0]?.path).toBe('guide/relative');
    expect(result.get('ar-child')?.pages.map(({ id }) => id)).toEqual(['ar-source']);
    expect(result.get('v2-target')?.pages.map(({ id }) => id)).toEqual(['v2-source']);
  });

  it('yields by elapsed work rather than a fixed number of pages, without wall-clock assertions', async () => {
    for (const pageMs of [2, 7]) {
      let clock = 0;
      let lastYield = 0;
      const slices: number[] = [];
      const snapshot = site(Array.from({ length: 100 }, (_, i) => page({ path: `timed-${i}` })));
      for (const source of snapshot.pages)
        Object.defineProperty(source, 'content', {
          get: () => {
            clock += pageMs;
            return 'Body.';
          },
        });
      await buildInboundPageLinkMapAsync(snapshot, [], {
        sliceMs: 25,
        now: () => clock,
        yieldToEventLoop: async () => {
          slices.push(clock - lastYield);
          lastYield = clock;
        },
      });
      expect(slices.length).toBeGreaterThan(1);
      // An indivisible page can cross the budget by at most its own cost.
      for (const slice of slices) {
        expect(slice).toBeGreaterThanOrEqual(25);
        expect(slice).toBeLessThan(25 + pageMs);
      }
      expect(clock - lastYield).toBeLessThan(25);
    }
  });

  it('stops at a chunk boundary on abort and never returns a partial map', async () => {
    const controller = new AbortController();
    let parsed = 0;
    const snapshot = site(Array.from({ length: 100 }, (_, i) => page({ path: `abort-${i}` })));
    for (const source of snapshot.pages)
      Object.defineProperty(source, 'content', {
        get: () => {
          parsed++;
          return 'Body.';
        },
      });
    await expect(
      buildInboundPageLinkMapAsync(snapshot, [], {
        signal: controller.signal,
        now: () => parsed * 10,
        yieldToEventLoop: async () => {
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(parsed).toBe(3);
    await expect(buildInboundPageLinkMapAsync(snapshot, [], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(parsed).toBe(3);
  });

  it('counts absolute URLs only on trusted hosts and leaves publish checks unchanged', () => {
    const snapshot = site([
      target(),
      child(),
      ...[
        'http://DOCS.example.test:80/guide#section',
        'https://docs.example.test:443/guide/setup',
        '//docs.example.test/guide',
        '//CUSTOM.example.test:443/guide/setup?lang=en#section',
        'https://foreign.example.test/guide',
        'https://unverified.example.test/guide',
        'https://docs.example.test:444/guide',
      ].map((href, i) => page({ id: `absolute-${i}`, path: `absolute-${i}`, content: `[guide](${href})` })),
    ]);
    expect(findInboundPageLinks(snapshot, 'target', ['https://docs.example.test', 'https://custom.example.test']).pages.map((p) => p.id)).toEqual([
      'absolute-0',
      'absolute-1',
      'absolute-2',
      'absolute-3',
    ]);
    // Missing destinations on even the trusted host remain external to the
    // publish gate. Its === false consumer and redirect boundary are unchanged.
    snapshot.pages.push(
      page({ path: 'absolute-missing', content: '[missing](https://docs.example.test/missing) [missing](//docs.example.test/missing)' }),
    );
    expect(findBrokenInternalLinks(snapshot)).toEqual([]);
  });

  it('does not sequentially evict content facts when scanning beyond the facts cache', () => {
    const sentinel = pageContentFacts('Cache sentinel for a large inbound scan.');
    const snapshot = site([
      ...Array.from({ length: 2200 }, (_, i) => page({ path: `large-${i}`, content: `Unique large-scan page ${i}.` })),
      target(),
      child(),
    ]);
    expect(buildInboundPageLinkMap(snapshot).get('target')?.total).toBe(0);
    expect(findBrokenInternalLinks(snapshot)).toEqual([]);
    expect(pageContentFacts('Cache sentinel for a large inbound scan.')).toBe(sentinel);
  });

  it('parses each content once per snapshot, and again for a new snapshot only from the shared cache', () => {
    const content = `Per-snapshot facts ${Math.random()}.`;
    const first = site([page({ path: 'a', content }), page({ path: 'b', content })]);
    const facts = snapshotContentFacts(first)(content);
    expect(snapshotContentFacts(first)(content)).toBe(facts);
    // A small site's facts also go to the shared cache, so another snapshot reuses them.
    expect(snapshotContentFacts(site([page({ path: 'c', content })]))(content)).toBe(facts);
    // A large one keeps its own, without adding to the shared cache.
    const large = `Large per-snapshot facts ${Math.random()}.`;
    const big = site(Array.from({ length: 2001 }, (_, i) => page({ path: `big-${i}`, content: i === 0 ? large : `Big ${i}.` })));
    const bigFacts = snapshotContentFacts(big)(large);
    expect(snapshotContentFacts(big)(large)).toBe(bigFacts);
    expect(pageContentFacts(large)).not.toBe(bigFacts);
  });

  it("keeps a trusted absolute URL's own version and language instead of inheriting the source context", () => {
    const snapshot = site([
      target(),
      child(),
      page({ id: 'ar-child', path: 'guide/setup', languageCode: 'ar' }),
      page({ id: 'ar-source', path: 'ar-source', languageCode: 'ar', content: '[Default](https://docs.example.test/guide/setup)' }),
      page({ id: 'target-v2', path: 'setup', versionId: 'v2' }),
      page({ id: 'source-v2', path: 'source', versionId: 'v2', content: '[Own version](https://docs.example.test/v2/setup)' }),
      page({ id: 'default-from-v2', path: 'default-source', versionId: 'v2', content: '[Default](https://docs.example.test/guide/setup)' }),
    ]);
    snapshot.project.languages.push({ code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false, config: null });
    snapshot.project.versions.push({ id: 'v2', name: 'v2', slug: 'v2', isDefault: false });
    const map = buildInboundPageLinkMap(snapshot, ['https://docs.example.test']);
    expect(map.get('target')?.pages.map((p) => p.id)).toEqual(['ar-source']);
    expect(map.get('ar-child')?.total).toBe(0);
    expect(map.get('target-v2')?.pages.map((p) => p.id)).toEqual(['source-v2']);
  });

  it('finds rendered links into a page or descendant, following redirects and relative paths, once per source', () => {
    const snapshot = site([
      target(),
      child(),
      page({ id: 'direct', path: 'direct', content: '[group](/guide) [child](/guide/setup)' }),
      page({ id: 'relative', path: 'guide/other', content: '[relative](setup.md#install)' }),
      page({ id: 'redirect', path: 'redirect', content: '<Card href="/old-setup">Setup</Card>' }),
      page({ id: 'ignored', path: 'ignored', content: '`[code](/guide)`\n\n<!-- [comment](/guide) -->\n\n[external](https://elsewhere.test/guide)' }),
    ]);
    snapshot.project.config = { redirects: [{ from: '/old-setup', to: '/guide/setup' }] };
    expect(findInboundPageLinks(snapshot, 'target')).toEqual({
      total: 3,
      pages: [
        { id: 'direct', title: snapshot.pages[2]?.title, path: 'direct' },
        { id: 'relative', title: snapshot.pages[3]?.title, path: 'guide/other' },
        { id: 'redirect', title: snapshot.pages[4]?.title, path: 'redirect' },
      ],
    });
    expect(findInboundPageLinks(snapshot, 'child').total).toBe(3);
  });

  it('respects language query, prefix and default fallback; excludes another branch and the whole subtree', () => {
    const snapshot = site([
      target(),
      child(),
      page({ id: 'inside', parentId: 'child', path: 'guide/setup/inside', content: '[ancestor](/guide)' }),
      page({ id: 'ar-target', path: 'guide/setup', languageCode: 'ar' }),
      page({ id: 'arabic', path: 'arabic', languageCode: 'ar', content: '[translated](/guide/setup)' }),
      page({ id: 'prefix', path: 'prefix', content: '[translated](/ar/guide/setup)' }),
      page({ id: 'explicit-en', path: 'en-link', languageCode: 'ar', content: '[English](/guide/setup?lang=en)' }),
      page({ id: 'fallback', path: 'fallback', languageCode: 'ar', content: '[fallback](/guide/setup/inside)' }),
      page({ id: 'other-branch', path: 'other-branch', versionId: 'v2', content: '[main](/guide/setup)' }),
      page({ id: 'hidden-draft', path: 'hidden-draft', hidden: true, content: '[main](/guide/setup)' }),
    ]);
    snapshot.project.languages.push({ code: 'ar', label: 'Arabic', direction: 'RTL', isDefault: false, config: null });
    snapshot.project.versions.push({ id: 'v2', name: 'Old', slug: 'old', isDefault: false });
    expect(findInboundPageLinks(snapshot, 'target').pages.map((p) => p.id)).toEqual(['explicit-en', 'fallback', 'hidden-draft']);
    expect(findInboundPageLinks(snapshot, 'ar-target').pages.map((p) => p.id)).toEqual(['arabic', 'prefix']);
  });

  it('caps the list at 20 without capping the count or counting repeated links twice', () => {
    const snapshot = site([
      target(),
      child(),
      ...Array.from({ length: 27 }, (_, i) => page({ id: `source-${i}`, path: `source-${i}`, content: '[one](/guide/setup) [two](/guide)' })),
    ]);
    const result = findInboundPageLinks(snapshot, 'target');
    expect(result.total).toBe(27);
    expect(result.pages).toHaveLength(20);
    expect(result.pages.at(-1)?.id).toBe('source-19');
  });

  // Correctness only: this parses 300 pages, which can pass Vitest's 5 s default
  // on a loaded CI runner. Its cost is measured serially in publish-checks.growth.test.ts.
  it('opens a 300-page site twice with the same answer (its cost: publish-checks.growth.test.ts)', { timeout: 30_000 }, () => {
    const snapshot = site([
      ...Array.from({ length: 298 }, (_, i) =>
        page({
          path: `cost-${i}`,
          content: `# Topic ${i}\n\n${Array.from({ length: 4 }, (_, j) => `[related](/cost-${(i + j + 1) % 298})`).join(' ')} [guide](/old-setup)\n\n${'Useful documentation. '.repeat(30)}`,
        }),
      ),
      target(),
      child(),
    ]);
    snapshot.project.config = { redirects: [{ from: '/old-setup', to: '/guide/setup' }] };
    expect(findInboundPageLinks(snapshot, 'target').total).toBe(298);
    expect(findInboundPageLinks(snapshot, 'target').total).toBe(298);
  });
});

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

describe('offsets inside skipped HTML ranges', () => {
  const everyRange = (ranges: { start: number; end: number }[], offset: number) =>
    ranges.some((range) => offset >= range.start && offset < range.end);

  it('answers like checking every range, with unsorted, nested and overlapping ranges', () => {
    // An unclosed context runs to the end of the page, so it can overlap later, shorter ranges.
    const ranges = [
      { start: 40, end: 45 },
      { start: 5, end: 10 },
      { start: 20, end: 100 },
      { start: 30, end: 35 },
      { start: 10, end: 12 },
    ];
    const inRange = offsetInRanges(ranges);
    for (let offset = -1; offset <= 101; offset++) expect(inRange(offset), `offset ${offset}`).toBe(everyRange(ranges, offset));
  });

  it('answers like checking every range for generated ranges', () => {
    let seed = 7;
    const next = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % limit;
    };
    for (let round = 0; round < 50; round++) {
      const ranges = Array.from({ length: next(12) }, () => {
        const start = next(200);
        return { start, end: start + next(60) };
      });
      const inRange = offsetInRanges(ranges);
      for (let offset = 0; offset < 260; offset++) expect(inRange(offset)).toBe(everyRange(ranges, offset));
    }
  });

  it('finds nothing when there are no ranges', () => {
    expect(offsetInRanges([])(0)).toBe(false);
  });
});

describe('embed checks next to raw HTML contexts', () => {
  it('skips a video inside a title and checks the ones after it', () => {
    const facts = pageContentFacts(
      '<title>t</title>\n\n<video src="http://a.example.com/1.mp4"></video>\n\n<title><video src="http://b.example.com/2.mp4"></video></title>\n\n<video src="http://c.example.com/3.mp4"></video>\n',
      false,
    );
    expect(facts.insecureVideos).toEqual(['http://a.example.com/1.mp4', 'http://c.example.com/3.mp4']);
  });
});
