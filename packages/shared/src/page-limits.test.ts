import { describe, expect, it } from 'vitest';
import {
  exceedsUtf8Bytes,
  formatMarkdownParseOverflow,
  MARKDOWN_PLAIN_LANGUAGE,
  MAX_PAGE_CONTENT_BYTES,
  markdownParseBudget,
  oversizedPageContent,
  parseMarkdownParseOverflow,
} from './page-limits';

const MiB = 1024 * 1024;

describe('exceedsUtf8Bytes', () => {
  it('accepts exactly the limit and refuses one byte more', () => {
    expect(MAX_PAGE_CONTENT_BYTES).toBe(2 * MiB);
    expect(exceedsUtf8Bytes('x'.repeat(MAX_PAGE_CONTENT_BYTES), MAX_PAGE_CONTENT_BYTES)).toBe(false);
    expect(exceedsUtf8Bytes('x'.repeat(MAX_PAGE_CONTENT_BYTES + 1), MAX_PAGE_CONTENT_BYTES)).toBe(true);
  });

  it('counts multibyte text in UTF-8 bytes, not UTF-16 length', () => {
    // Arabic letters are two bytes each, emoji four (one surrogate pair).
    expect(exceedsUtf8Bytes('ع'.repeat(MAX_PAGE_CONTENT_BYTES / 2), MAX_PAGE_CONTENT_BYTES)).toBe(false);
    expect(exceedsUtf8Bytes(`${'ع'.repeat(MAX_PAGE_CONTENT_BYTES / 2)}x`, MAX_PAGE_CONTENT_BYTES)).toBe(true);
    expect(exceedsUtf8Bytes('😀'.repeat(MAX_PAGE_CONTENT_BYTES / 4), MAX_PAGE_CONTENT_BYTES)).toBe(false);
    expect(exceedsUtf8Bytes(`${'😀'.repeat(MAX_PAGE_CONTENT_BYTES / 4)}x`, MAX_PAGE_CONTENT_BYTES)).toBe(true);
    // Under the limit in UTF-16 code units, over it in bytes.
    expect(exceedsUtf8Bytes('ع'.repeat(MAX_PAGE_CONTENT_BYTES / 2 + 1), MAX_PAGE_CONTENT_BYTES)).toBe(true);
    expect(exceedsUtf8Bytes('\ud800', 2)).toBe(true);
    expect(exceedsUtf8Bytes('ع', 2)).toBe(false);
  });

  it('stops counting as soon as the limit is passed', () => {
    // Stands in for a string (its length and characters) and counts how many characters were read.
    const counted = (text: string) => {
      const read = { count: 0 };
      const value = {
        length: text.length,
        *[Symbol.iterator]() {
          for (const char of text) {
            read.count += 1;
            yield char;
          }
        },
      };
      return { value: value as unknown as string, read };
    };
    const arabic = counted('ع'.repeat(10_000));
    expect(exceedsUtf8Bytes(arabic.value, 15_000)).toBe(true);
    // 7,501 two-byte letters pass 15,000 bytes; the other 2,499 are never read.
    expect(arabic.read.count).toBe(7501);
    // Longer than the limit in code units: refused without reading any of it.
    const huge = counted('x'.repeat(64 * MiB));
    expect(exceedsUtf8Bytes(huge.value, MAX_PAGE_CONTENT_BYTES)).toBe(true);
    expect(huge.read.count).toBe(0);
  });
});

describe('oversizedPageContent', () => {
  const atCap = 'x'.repeat(MAX_PAGE_CONTENT_BYTES);
  const overCap = `${atCap}x`;

  it('allows any create or update at or under the cap', () => {
    expect(oversizedPageContent(atCap)).toBeNull();
    expect(oversizedPageContent(atCap, '')).toBeNull();
    expect(oversizedPageContent('ع'.repeat(MAX_PAGE_CONTENT_BYTES / 2), '')).toBeNull();
  });

  it('refuses a create over the cap with its size in bytes', () => {
    expect(oversizedPageContent(overCap)).toBe(MAX_PAGE_CONTENT_BYTES + 1);
    expect(oversizedPageContent('😀'.repeat(MAX_PAGE_CONTENT_BYTES / 4 + 1))).toBe(MAX_PAGE_CONTENT_BYTES + 4);
  });

  it('refuses an update over the cap that grows the stored body', () => {
    expect(oversizedPageContent(overCap, 'small')).toBe(MAX_PAGE_CONTENT_BYTES + 1);
    expect(oversizedPageContent('x'.repeat(3 * MiB + 1), 'x'.repeat(3 * MiB))).toBe(3 * MiB + 1);
    // Same UTF-16 length, more bytes: Arabic replacing ASCII grows the page.
    expect(oversizedPageContent('ع'.repeat(MiB + 1), 'x'.repeat(MiB + 1))).toBe(2 * MiB + 2);
  });

  it('never blocks an update that keeps or shrinks a body already over the cap', () => {
    expect(oversizedPageContent('x'.repeat(2.5 * MiB), 'x'.repeat(3 * MiB))).toBeNull();
    expect(oversizedPageContent('y'.repeat(3 * MiB), 'x'.repeat(3 * MiB))).toBeNull();
    // ASCII replacing Arabic: more characters, fewer bytes (2.5 MiB after, 3 MiB before).
    expect(oversizedPageContent('x'.repeat(2.5 * MiB), 'ع'.repeat(1.5 * MiB))).toBeNull();
  });
});

describe('markdownParseBudget', () => {
  const dense = '*a* '.repeat(600);

  it('skips display and inline math that the reader parses as raw text', () => {
    const mathRow = String.raw`x_{i,j} &= \frac{a_i+b_i}{c_i-d_i} + y_{i,j} \\`;
    const display = ['$$', String.raw`\begin{aligned}`, ...Array.from({ length: 64 }, () => mathRow), String.raw`\end{aligned}`, '$$'].join('\n');
    const inline = `Before ${'$x_{i,j} = \\sqrt{a_i*b_i}$ '.repeat(180)}after.`;
    expect(markdownParseBudget(display).overflow).toBeNull();
    expect(markdownParseBudget(inline).overflow).toBeNull();
    expect(markdownParseBudget(`${display}\n\n${dense}`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 70 });
    // A fence-looking line inside a math block cannot hide Markdown after the math closer.
    expect(markdownParseBudget(`$$\n~~~\n$$\n\n${dense}`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 5 });
  });

  it('counts each reference definition as its own unit in a definition run', () => {
    const definitions = Array.from({ length: 600 }, (_, i) => `[#${i}]: /releases/${i}`).join('\n');
    const source = `# Changes\n\n[#17][#17]\n\n${definitions}`;
    expect(markdownParseBudget(source).overflow).toBeNull();
    expect(markdownParseBudget(source).content).toBe(source);
    expect(markdownParseBudget(`Prose above a literal run.\n${definitions}`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 1 });
    expect(markdownParseBudget(definitions.replaceAll('[#', '\u00a0[#')).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 1 });
  });

  it('handles runs of footnotes and reference definitions with balanced destinations and titles', () => {
    const definitions = Array.from({ length: 600 }, (_, index) => `[r${index}]: /wiki/Spec_(${index}) "Title \\"example\\""`).join('\n');
    const footnotes = Array.from({ length: 600 }, (_, index) => `[^note${index}]: Footnote text.`).join('\n');
    expect(markdownParseBudget(definitions).overflow).toBeNull();
    expect(markdownParseBudget(footnotes).overflow).toBeNull();
    const half = '*a'.repeat(600);
    expect(markdownParseBudget(`[^r]: ${half}\n${half}`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 1 });
  });

  it('reads no-leading-pipe GFM tables whose rows start with links, inline HTML or math', () => {
    const rows = Array.from({ length: 256 }, (_, i) => {
      const firstCell = [`[\`E${i}\`](/errors/${i})`, `<span>E${i}</span>`, `$x_${i}$`][i % 3];
      return `${firstCell} | [Open](/details/${i}) | **Error**`;
    });
    const source = ['Code | Details | Type', '--- | --- | ---', ...rows].join('\n');
    expect(markdownParseBudget(source).overflow).toBeNull();
    expect(markdownParseBudget(source).content).toBe(source);
  });

  it('bounds cumulative GFM table rows and preserves Markdown after the over-budget table', () => {
    const table = (rows: number) => ['Kind | Value', '--- | ---', ...Array.from({ length: rows }, () => 'A | B')].join('\n');
    const first = table(1023);
    const second = table(1024);
    const under = `${first}\n\n${table(1023)}`;
    expect(markdownParseBudget(under)).toMatchObject({ overflow: null, content: under });
    const source = `${first}\n\n${second}\n\n## Next\n\n[Read next](/next)`;
    const budget = markdownParseBudget(source);
    expect(budget.overflow).toEqual({ limit: 'tableRows', line: 2052, amount: 2049 });
    expect(budget.regions).toEqual([[1026, 2051]]);
    expect(budget.content).toBe(`${first}\n\n\`\`\`${MARKDOWN_PLAIN_LANGUAGE}\n${second}\n\`\`\`\n\n## Next\n\n[Read next](/next)`);
    // A one-column GFM table can lack pipes even in its header and delimiter.
    expect(markdownParseBudget(`Value\n:-:\n${'A\n'.repeat(16_000)}`).overflow).toMatchObject({ limit: 'tableRows', amount: 2049 });
  });

  it('keeps under-budget blocks abutting a table and counts setext-like text within it', () => {
    const table = `Value\n:-:\n=\n--\n${'A\n'.repeat(2051)}`;
    const budget = markdownParseBudget(`Preamble\n${table}## After\nAfter text`);
    expect(budget.overflow).toMatchObject({ limit: 'tableRows', amount: 2049 });
    expect(budget.content).toBe(`Preamble\n\`\`\`${MARKDOWN_PLAIN_LANGUAGE}\n${table}\`\`\`\n## After\nAfter text`);
  });

  it.each(['[a](/$a)', '[a](/a "$title")'])('does not open inline math in link resources such as %s', (resource) => {
    expect(markdownParseBudget(`${resource}\n${dense}\nplain $b`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 1 });
  });

  it('fences only the block over budget, from blank line to blank line, and names its first line', () => {
    const source = ['# Guide', '', 'Intro.', '', 'Lead-in line', dense, 'tail line', '', '## After', '', 'Done.'].join('\n');
    const budget = markdownParseBudget(source);
    // Markers count per paragraph, named by its first line.
    expect(budget.overflow).toEqual({ limit: 'syntaxMarkers', line: 5, amount: 1200 });
    expect(budget.whole).toBe(false);
    expect(budget.regions).toEqual([[4, 6]]);
    expect(budget.content).toBe(
      ['# Guide', '', 'Intro.', '', `\`\`\`${MARKDOWN_PLAIN_LANGUAGE}`, 'Lead-in line', dense, 'tail line', '```', '', '## After', '', 'Done.'].join(
        '\n',
      ),
    );
  });

  it('takes a tag nested too deep from the block it opens in to the block it closes in', () => {
    const deep = `${'<div>\n\n'.repeat(70)}Deep\n\n${'</div>\n\n'.repeat(70)}`;
    const source = `Before.\n\n<section>\n\n${deep}</section>\n\nAfter.`;
    const budget = markdownParseBudget(source);
    expect(budget.overflow).toMatchObject({ limit: 'nesting', nesting: 'tags', amount: 71 });
    const [region] = budget.regions;
    const lines = source.split('\n');
    // From the 65th open tag (64 divs and the section are open around it) to the tag that closes it.
    expect(lines[region?.[0] ?? -1]).toBe('<div>');
    expect(lines.slice(0, region?.[0]).filter((line) => line === '<div>')).toHaveLength(63);
    expect(lines.slice((region?.[1] ?? 0) + 1).filter((line) => line === '</div>')).toHaveLength(63);
    expect(budget.content.endsWith('</section>\n\nAfter.')).toBe(true);
  });

  it('keeps a fence that holds the region’s own backticks closed around it', () => {
    const source = `\`\`\`\`\`\n${'[x'.repeat(70)}\n\`\`\`\`\``;
    const prose = `Text\n${'[x'.repeat(70)} \`\`\`\`\` code`;
    expect(markdownParseBudget(source).overflow).toBeNull();
    expect(markdownParseBudget(prose).content).toBe(`\`\`\`\`\`\`${MARKDOWN_PLAIN_LANGUAGE}\n${prose}\n\`\`\`\`\`\``);
  });

  it('is unchanged by a second reading, so every renderer step agrees', () => {
    for (const source of [
      `- item\n\n  ${dense}\n\n  more\n\n${'<div>'.repeat(70)}`,
      `> quote\n> ${dense}\n\nAfter`,
      `<!--\n\n${dense}\n\n-->\n\n${dense}`,
      `\`\`\`\n${dense}\n\`\`\`\n\n${'x'.repeat(131_073)}`,
    ]) {
      const once = markdownParseBudget(source);
      expect(once.overflow, source.slice(0, 20)).not.toBeNull();
      expect(markdownParseBudget(once.content)).toMatchObject({ overflow: null, content: once.content });
    }
  });

  it('skips code only where inline Markdown never reads it', () => {
    expect(markdownParseBudget(`\`\`\`\n${dense}\n\`\`\``).overflow).toBeNull();
    expect(markdownParseBudget(`Before\n\n    ${dense}`).overflow).toBeNull();
    expect(markdownParseBudget(`\`${dense}\``).overflow).toBeNull();
    // Four spaces continuing a paragraph are prose, not indented code.
    expect(markdownParseBudget(`Before\n    ${dense}`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 1 });
    // A code span pairs across the lines of its paragraph: here it closes on the next line, before the markers.
    expect(markdownParseBudget(`Open \`\n\` ${dense} \`x\``).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 1 });
    expect(markdownParseBudget(`Open \`code\n${dense} code\``).overflow).toBeNull();
    // A table splits cells before code spans (an escaped pipe doesn't), and an escaped backtick opens nothing.
    const head = '| h | h | h |\n| - | - | - |\n';
    expect(markdownParseBudget(`${head}| \`a | ${dense} | b\` |`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 3 });
    expect(markdownParseBudget(`${head}| \`a \\| ${dense} \\| b\` | c |`).overflow).toBeNull();
    // Outside a table a pipe is text, and a span holding one is code.
    expect(markdownParseBudget(`| \`a | ${dense} | b\` |`).overflow).toBeNull();
    // A paragraph that might hold a table this scan doesn't recognise (here the cell counts differ) reads such a span as text.
    expect(markdownParseBudget(`| a | b |\n| - |\n| \`a | ${dense} | b\` |`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 1 });
    expect(markdownParseBudget(`\\\`${dense}\``).overflow).toMatchObject({ limit: 'syntaxMarkers' });
    // Raw HTML binds before code: a backtick in an attribute is not a span.
    expect(markdownParseBudget(`<a title="\`">${dense}\``).overflow).toMatchObject({ limit: 'syntaxMarkers' });
    expect(markdownParseBudget(`Text <!-- \` -->${dense}\``).overflow).toMatchObject({ limit: 'syntaxMarkers' });
    // A line that starts an HTML block is raw HTML, not Markdown: none of it counts.
    expect(markdownParseBudget(`<!-- \` -->${dense}\``).overflow).toBeNull();
  });

  it('counts only real elements: HTML, registry components and tags closed on the page', () => {
    const open = (tag: string) => `${tag}\n`.repeat(65);
    expect(markdownParseBudget(open('Promise<User>')).overflow).toBeNull();
    expect(markdownParseBudget(open('<li>') + open('<br>') + open('<p>') + open('<img src="/a.png">')).overflow).toBeNull();
    expect(markdownParseBudget(open('<span>')).overflow).toMatchObject({ limit: 'nesting', nesting: 'tags', line: 65 });
    expect(markdownParseBudget(open('<Note>')).overflow).toMatchObject({ limit: 'nesting', nesting: 'tags' });
    expect(markdownParseBudget(`${open('<Custom>')}${'</Custom>\n'.repeat(65)}`).overflow).toMatchObject({ limit: 'nesting', nesting: 'tags' });
    expect(markdownParseBudget(open('<span/>')).overflow).toBeNull();
  });

  it('counts markers per paragraph, however many lines it runs over', () => {
    const half = '*a'.repeat(600);
    // The review's shape: lines of markers with no blank line between them are one paragraph.
    const lines = Array.from({ length: 4 }, () => half).join('\n');
    expect(markdownParseBudget(`Intro.\n\n${lines}\n\nAfter.`)).toMatchObject({
      overflow: { limit: 'syntaxMarkers', line: 3, amount: 2400 },
      regions: [[2, 5]],
    });
    // An ordered item other than 1 can't interrupt a paragraph, and a lazy line continues one.
    expect(markdownParseBudget(`${half}\n2. ${half}`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 1 });
    expect(markdownParseBudget(`> ${half}\n${half}`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 1 });
    // A setext underline the item can't take is text of the paragraph: the next line continues it.
    expect(markdownParseBudget(`- ${half}\n===\n${half}`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 1 });
    // Each list item, heading and table row is its own paragraph.
    expect(markdownParseBudget(`- ${half}\n- ${half}\n  - ${half}\n2. ${half}`).overflow).toBeNull();
    expect(markdownParseBudget(`# ${half}\n${half}\n## ${half}`).overflow).toBeNull();
    expect(markdownParseBudget(`${half}\n| a | b |\n| - | - |\n| ${half} | x |\n| ${half} | y |`).overflow).toBeNull();
  });

  it('ends a table where GFM ends it, and reads what follows as a paragraph', () => {
    const half = '*a'.repeat(600);
    // A lazy line can't continue a table in a quote: it starts a paragraph.
    expect(markdownParseBudget(`> | a | b |\n> | - | - |\n> | c | d |\n${half}\n${half}`).overflow).toMatchObject({
      limit: 'syntaxMarkers',
      line: 4,
    });
    // A header and delimiter row with different cell counts make no table.
    expect(markdownParseBudget(`| a | b |\n| - |\n| ${half} |\n| ${half} |`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 1 });
    // GFM ends a table at indented code, an ordered item or a footnote, though each reads like a paragraph line.
    for (const ender of ['    | c |', '2. x', '[^1]: note'])
      expect(markdownParseBudget(`| a |\n|-|\n| b |\n${ender}\n| ${half} |\n| ${half} |`).overflow, ender).toMatchObject({
        limit: 'syntaxMarkers',
        line: 4,
      });
    // `- | -` starts a list item, not a delimiter row.
    expect(markdownParseBudget(`a | b\n- | -\n${half} | x\n${half} | y`).overflow).toMatchObject({ limit: 'syntaxMarkers', line: 2 });
  });

  it('counts an emphasis run as the elements it can make, and raw HTML as no markers', () => {
    expect(markdownParseBudget('**bold** '.repeat(512)).overflow).toBeNull();
    expect(markdownParseBudget('**bold** '.repeat(513)).overflow).toMatchObject({ limit: 'syntaxMarkers', amount: 1026 });
    expect(markdownParseBudget(`Text ${'<span>a</span>'.repeat(2000)}`).overflow).toBeNull();
  });

  it('never takes an authored fence for a plain-text region', () => {
    const over = '*a* '.repeat(600);
    const authored = '```nibleaf-plain\ncode\n```\n\n```nibleaf-plain-7\nmore\n```';
    const budget = markdownParseBudget(`${authored}\n\n${over}`);
    expect(budget.plainLanguage).toBe('nibleaf-plain-8');
    expect(budget.content).toBe(`${authored}\n\n\`\`\`nibleaf-plain-8\n${over}\n\`\`\``);
    expect(markdownParseBudget(over).plainLanguage).toBe(MARKDOWN_PLAIN_LANGUAGE);
  });

  it('lets long prose lines and table delimiter rows through', () => {
    expect(markdownParseBudget('ع'.repeat(131_072)).overflow).toBeNull();
    expect(markdownParseBudget('ع'.repeat(131_073)).overflow).toEqual({ limit: 'lineCharacters', line: 1, amount: 131_073 });
    expect(markdownParseBudget(`| a | b |\n|${'-'.repeat(2000)}|${'-'.repeat(2000)}|`).overflow).toBeNull();
  });

  it('numbers lines as the editor does and shows a page over the size cap whole', () => {
    expect(markdownParseBudget(`a\r\nb\r\n\r\n${dense}`).overflow?.line).toBe(4);
    const large = 'word '.repeat(110_000);
    expect(markdownParseBudget(large)).toMatchObject({ whole: true, overflow: { limit: 'pageBytes', line: 0, amount: 550_000 } });
  });

  it('round-trips the publish check detail', () => {
    const overflow = { limit: 'nesting', line: 412, amount: 70, nesting: 'tags' } as const;
    expect(formatMarkdownParseOverflow(overflow)).toBe('nesting:412:70:tags');
    expect(parseMarkdownParseOverflow('nesting:412:70:tags')).toEqual(overflow);
    expect(parseMarkdownParseOverflow('syntaxMarkers:9:2000')).toEqual({ limit: 'syntaxMarkers', line: 9, amount: 2000 });
    expect(parseMarkdownParseOverflow('lineCharacters')).toBeNull();
    expect(parseMarkdownParseOverflow('toString:1:2')).toBeNull();
  });
});
