import { posix } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  convertGitBookMarkdown,
  expandGitBookIncludes,
  extractGitBookTitle,
  findGitBookSpaceLinks,
  parseGitBookFrontmatter,
  plainGitBookText,
} from './gitbook-markdown';

const convert = (source: string, resolveFile: (reference: string) => string | undefined = () => undefined) =>
  convertGitBookMarkdown(source, { resolveFile });

describe('parseGitBookFrontmatter', () => {
  it('reads folded descriptions, icons, visibility, and layout', () => {
    const { meta, body } = parseGitBookFrontmatter(
      [
        '---',
        'description: >-',
        '  A long description',
        '  over two lines.',
        'icon: rocket',
        'hidden: true',
        'layout:',
        '  width: wide',
        '  tableOfContents:',
        '    visible: false',
        '---',
        '',
        '# Title',
      ].join('\n'),
    );
    expect(meta).toEqual({ description: 'A long description over two lines.', icon: 'rocket', hidden: true, mode: 'wide', hideToc: true });
    expect(body).toBe('\n# Title');
  });

  it('ignores invalid YAML without failing the page', () => {
    expect(parseGitBookFrontmatter('---\n: [\n---\nBody').meta).toEqual({});
  });
});

describe('extractGitBookTitle', () => {
  it('lifts the leading H1 and strips its anchor', () => {
    expect(extractGitBookTitle('\n# Quick start <a href="#q" id="q"></a>\n\nBody')).toEqual({ title: 'Quick start', body: 'Body' });
  });

  it('leaves bodies without a leading H1 alone', () => {
    expect(extractGitBookTitle('Intro\n\n# Later')).toEqual({ body: 'Intro\n\n# Later' });
  });
});

describe('convertGitBookMarkdown', () => {
  it('maps hint styles onto callouts, including nested hints', () => {
    const { content } = convert(
      [
        '{% hint style="success" %}',
        'Done.',
        '{% hint style="danger" %}',
        'Careful.',
        '{% endhint %}',
        '{% endhint %}',
        '{% hint style="info" %}',
        'FYI',
        '{% endhint %}',
      ].join('\n'),
    );
    expect(content).toBe(['<Check>', 'Done.', '<Danger>', 'Careful.', '</Danger>', '</Check>', '<Info>', 'FYI', '</Info>'].join('\n\n'));
  });

  it('converts tabs and moves code titles onto the fence', () => {
    const { content } = convert(
      [
        '{% tabs %}',
        '{% tab title="Node" %}',
        '{% code title="index.js" lineNumbers="true" %}',
        '```javascript',
        'run();',
        '```',
        '{% endcode %}',
        '{% endtab %}',
        '{% endtabs %}',
      ].join('\n'),
    );
    expect(content).toBe('<Tabs>\n\n<Tab title="Node">\n\n```javascript title="index.js"\nrun();\n```\n\n\n</Tab>\n\n</Tabs>');
  });

  it('lifts step headings into Step titles', () => {
    const { content } = convert(['{% stepper %}', '{% step %}', '### Install', 'Run it.', '{% endstep %}', '{% endstepper %}'].join('\n'));
    expect(content).toBe(['<Steps>', '<Step title="Install">', 'Run it.', '</Step>', '</Steps>'].join('\n\n'));
  });

  it('keeps percentage attributes on columns intact', () => {
    const { content, warnings } = convert('{% columns %}\n{% column width="50%" %}\nLeft\n{% endcolumn %}\n{% endcolumns %}');
    expect(content).toBe(['<Columns>', '<Column>', 'Left', '</Column>', '</Columns>'].join('\n\n'));
    expect(warnings).toEqual([]);
  });

  it('turns page links, embeds, and files into cards', () => {
    const { content, warnings } = convert(
      [
        '{% content-ref url="guides/setup.md" %}',
        '[setup.md](guides/setup.md)',
        '{% endcontent-ref %}',
        '{% embed url="https://www.youtube.com/watch?v=abc" %}',
        '{% embed url="https://codepen.io/x" %}',
        'Pen caption',
        '{% endembed %}',
        '{% file src=".gitbook/assets/guide (1).pdf" %}',
        'The PDF',
        '{% endfile %}',
      ].join('\n'),
      (reference) => (reference.includes('guide') ? 'https://raw.example/guide%20%281%29.pdf' : undefined),
    );
    expect(content).toContain('<Card title="setup.md" href="guides/setup.md"></Card>');
    expect(content).toContain('<Card title="youtube.com" href="https://www.youtube.com/watch?v=abc" icon="arrow-up-right-from-square"></Card>');
    expect(content).toContain('<Card title="Pen caption" href="https://codepen.io/x"');
    expect(content).toContain('<Card title="guide (1).pdf" href="https://raw.example/guide%20%281%29.pdf" icon="file">\n\nThe PDF\n\n</Card>');
    expect(warnings).toEqual([]);
  });

  it('converts figures, pictures, frames, and inline images to Markdown images', () => {
    const { content } = convert(
      [
        '<div data-with-frame="true"><figure><img src="../.gitbook/assets/image (1).png" alt="Shot"><figcaption><p>Caption &amp; more</p></figcaption></figure></div>',
        '',
        '<figure><picture><source srcset="dark.png" media="(prefers-color-scheme: dark)"><img src="light.png" alt="Logo"></picture></figure>',
        '',
        'Inline <img src="icon.svg" alt="" width="20"> icon.',
      ].join('\n'),
    );
    expect(content).toContain('<Frame caption="Caption &amp; more">\n\n![Shot](<../.gitbook/assets/image (1).png>)\n\n</Frame>');
    expect(content).toContain('![Logo](light.png)');
    expect(content).not.toContain('dark.png');
    expect(content).toContain('Inline ![](icon.svg) icon.');
  });

  it('turns expandable details into accordions and strips heading anchors', () => {
    const { content } = convert(
      '## Setup <a href="#setup" id="setup"></a>\n\n<details>\n<summary>More <strong>info</strong></summary>\n\nHidden **text**\n\n</details>',
    );
    expect(content).toBe('## Setup\n\n<Accordion title="More info">\n\nHidden **text**\n\n</Accordion>');
  });

  it('converts card tables using their hidden target and cover columns', () => {
    const table = [
      '<table data-view="cards"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type="content-ref"></th><th data-hidden data-card-cover data-type="files"></th></tr></thead>',
      '<tbody><tr><td><strong>Quickstart</strong></td><td>Get going fast</td><td><a href="quickstart.md">quickstart.md</a></td><td><a href=".gitbook/assets/cover.png">cover.png</a></td></tr></tbody></table>',
    ].join('');
    const { content } = convert(table, () => 'https://raw.example/cover.png');
    expect(content).toBe(
      '<CardGroup cols="1">\n\n<Card title="Quickstart" href="quickstart.md">\n\n![Quickstart](https://raw.example/cover.png)\n\nGet going fast\n\n</Card>\n\n</CardGroup>',
    );
  });

  it('converts buttons and icons', () => {
    const { content } = convert('<a href="https://x.dev" class="button secondary" data-icon="rocket">Go</a> <i class="fa-rocket">:rocket:</i>');
    expect(content).toBe('<Button href="https://x.dev" variant="secondary">Go</Button> <Icon icon="rocket" />');
  });

  it('reads the icon from the class attribute alone', () => {
    const { content } = convert('<i class="fas fa-bolt fa-lg">x</i> <i class="note">y</i> <i data-class="fa-x">z</i>');
    expect(content).toBe('<Icon icon="bolt" /> <i class="note">y</i> <i data-class="fa-x">z</i>');
  });

  it('keeps later offsets after letters that grow when lowercased', () => {
    const { content } = convert('İİİİ <details><summary>Sum</summary>Body</details> after <a href="https://x.dev" class="button">Go</a>');
    expect(content).toContain('after <Button href="https://x.dev" variant="primary">Go</Button>');
    expect(content).toContain('Body');
    expect(content).not.toContain('</de');
  });

  it('labels updates by date', () => {
    const { content } = convert(
      '{% updates format="full" %}\n{% update date="2025-01-02" %}\n## New editor\nShipped.\n{% endupdate %}\n{% endupdates %}',
    );
    expect(content).toBe('<Update label="2025-01-02" description="New editor">\n\nShipped.\n\n</Update>');
  });

  it('never rewrites GitBook syntax inside code', () => {
    const source = '```markdown\n{% hint style="info" %}\n<figure><img src="x.png"></figure>\n{% endhint %}\n```\n\nUse `{% tabs %}` inline.';
    expect(convert(source).content).toBe(source);
  });

  it('unwraps unknown and conditional blocks and reports them', () => {
    const { content, warnings } = convert('{% if visitor.claims.plan %}\nPro\n{% endif %}\n{% mystery a="b" %}\nKept\n{% endmystery %}');
    expect(content).toBe('Pro\n\nKept');
    expect(warnings).toEqual([
      'Adaptive-content conditions ({% if %}) were removed; all conditional content is now visible to every reader.',
      'Unsupported GitBook block "{% mystery %}" was removed; its content was kept.',
    ]);
  });

  it('reports missing files and OpenAPI blocks', () => {
    const { content, warnings } = convert(
      '{% file src="/files/abc" %}\n\n{% openapi src="https://x.dev/spec.yaml" path="/pets" method="get" %}\n[spec](https://x.dev/spec.yaml)\n{% endopenapi %}',
    );
    expect(content).toContain('<Card title="abc" href="/files/abc" icon="file">');
    expect(content).toContain('<Card title="GET /pets" href="https://x.dev/spec.yaml" icon="code">');
    expect(warnings).toHaveLength(2);
  });

  it('rebases relative links and images in included content onto the including page', async () => {
    const media = new Map([
      [
        '.gitbook/includes/media.md',
        '![a](../assets/a.png "t") [s](<../../guides/setup page.md#x>) <img src="../assets/b.png"> [ext](https://x.dev) [top](#a)\n\n```\n![c](../keep.png)\n```',
      ],
    ]);
    const resolveRelative = (reference: string, sourceFile: string) => {
      const path = posix.normalize(posix.join(posix.dirname(sourceFile), reference));
      return media.has(path) ? path : undefined;
    };
    const warnings: string[] = [];
    expect(
      await expandGitBookIncludes(
        '{% include "../.gitbook/includes/media.md" %}',
        'guides/p.md',
        resolveRelative,
        async (path) => media.get(path) ?? null,
        warnings,
      ),
    ).toBe(
      '![a](../.gitbook/assets/a.png "t") [s](<setup page.md#x>) <img src="../.gitbook/assets/b.png"> [ext](https://x.dev) [top](#a)\n\n```\n![c](../keep.png)\n```',
    );
    expect(warnings).toEqual([]);
  });
});

describe('findGitBookSpaceLinks', () => {
  it('lists distinct links into GitBook spaces outside code', () => {
    const content = [
      '<Card title="Guides" href="https://app.gitbook.com/s/4gzcGtLrr90pVjAWVdTc/modding-guides"></Card>',
      'See [this](https://app.gitbook.com/o/org1/s/fwsaoju1TBAUvMpI6NIw/) and [again](https://app.gitbook.com/s/4gzcGtLrr90pVjAWVdTc/modding-guides).',
      '`https://app.gitbook.com/s/inCode/x`',
      '[site](https://docs.gitbook.com/s/not-a-space)',
    ].join('\n\n');
    expect(findGitBookSpaceLinks(content)).toEqual([
      'https://app.gitbook.com/s/4gzcGtLrr90pVjAWVdTc/modding-guides',
      'https://app.gitbook.com/o/org1/s/fwsaoju1TBAUvMpI6NIw/',
    ]);
  });
});

describe('expandGitBookIncludes', () => {
  const files = new Map([
    ['.gitbook/includes/note.md', '---\ntitle: Note\n---\n\nShared {% include "deeper.md" %}'],
    ['.gitbook/includes/deeper.md', 'deep text'],
    ['.gitbook/includes/loop.md', '{% include "loop.md" %}'],
  ]);
  const resolve = (reference: string, sourceFile: string) => {
    const base = sourceFile.includes('/') ? sourceFile.slice(0, sourceFile.lastIndexOf('/') + 1) : '';
    const path = reference.startsWith('.gitbook/') ? reference : `${base}${reference}`;
    return files.has(path) ? path : undefined;
  };
  const load = async (path: string) => files.get(path) ?? null;

  it('inlines nested reusable content without its frontmatter', async () => {
    const warnings: string[] = [];
    expect(await expandGitBookIncludes('A\n\n{% include ".gitbook/includes/note.md" %}', 'page.md', resolve, load, warnings)).toBe(
      'A\n\nShared deep text',
    );
    expect(warnings).toEqual([]);
  });

  it('cuts include cycles and reports missing includes', async () => {
    const warnings: string[] = [];
    await expect(
      expandGitBookIncludes('{% include ".gitbook/includes/loop.md" %}{% include "missing.md" %}', 'page.md', resolve, load, warnings),
    ).rejects.toThrow(/source content is missing/);
    expect(warnings).toHaveLength(1);
  });

  it('rebases relative links and images in included content onto the including page', async () => {
    const media = new Map([
      [
        '.gitbook/includes/media.md',
        '![a](../assets/a.png "t") [s](<../../guides/setup page.md#x>) <img src="../assets/b.png"> [ext](https://x.dev) [top](#a)\n\n```\n![c](../keep.png)\n```',
      ],
    ]);
    const resolveRelative = (reference: string, sourceFile: string) => {
      const path = posix.normalize(posix.join(posix.dirname(sourceFile), reference));
      return media.has(path) ? path : undefined;
    };
    const warnings: string[] = [];
    expect(
      await expandGitBookIncludes(
        '{% include "../.gitbook/includes/media.md" %}',
        'guides/p.md',
        resolveRelative,
        async (path) => media.get(path) ?? null,
        warnings,
      ),
    ).toBe(
      '![a](../.gitbook/assets/a.png "t") [s](<setup page.md#x>) <img src="../.gitbook/assets/b.png"> [ext](https://x.dev) [top](#a)\n\n```\n![c](../keep.png)\n```',
    );
    expect(warnings).toEqual([]);
  });
});

it.each(['details', 'figure', 'picture', 'table data-view="cards"', 'div', 'a class="button"'])(
  'converts a MiB of unclosed %s openings promptly',
  (tag) => {
    const unit = `<${tag}>`;
    const input = unit.repeat(Math.ceil((1024 * 1024) / unit.length));
    const started = performance.now();
    convertGitBookMarkdown(input, { resolveFile: () => undefined });
    const elapsed = performance.now() - started;
    console.info(`HTML conversion ${tag}: ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(900);
  },
);
it.each(['a < b and c', 'x <= y', 'List<T> API'])('preserves literal title text %s', (label) => {
  expect(plainGitBookText(label)).toBe(label);
});
it('handles out-of-range entity values', () => {
  expect(() => plainGitBookText('&#x110000; &#999999999999999999999999;')).not.toThrow();
});

it('continues converting buttons after an unmatched anchor opener', () => {
  const content = convert('<a href="/stray">Unclosed\n<a href="/valid" class="button">Valid</a>').content;
  expect(content).toContain('<Button href="/valid" variant="primary">Valid</Button>');
  expect(content).toContain('<a href="/stray">Unclosed');
});
it.each(['Map<K, V>', 'a<b and c>d'])('preserves ambiguous prose %s', (title) => {
  expect(plainGitBookText(title)).toBe(title);
});
it('bounds the echoed include reference', async () => {
  await expect(
    expandGitBookIncludes(
      `{% include "${'x'.repeat(1000)}" %}`,
      'page.md',
      () => undefined,
      async () => null,
      [],
    ),
  ).rejects.toMatchObject({ details: { path: 'x'.repeat(200) } });
});
it('keeps indentation after extracting the page heading', () => {
  expect(extractGitBookTitle('# Title\n\n    literal')).toEqual({ title: 'Title', body: '    literal' });
});

it('keeps HTML attribute lookup case insensitive', () => {
  expect(convert('<IMG SRC="image.png" ALT="Shot">').content).toBe('![Shot](image.png)');
  expect(convert('<A HREF="/safe" CLASS="button">Go</A>').content).toBe('<Button href="/safe" variant="primary">Go</Button>');
});
