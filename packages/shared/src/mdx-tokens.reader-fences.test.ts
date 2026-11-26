import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fencedMarkdownLines, markdownFenceLines, openingMarkdownFence } from './markdown-code';
import { buildMdxTree, mdxLineRoles, tokenizeMdx } from './mdx-tokens';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { normalizeMdxBlocks, readerLineView } from './reader-markdown';
import { exportCodeSamples, renderedActiveHtml } from './testing/export-guard';
import { FENCE_CONTAINER_REPROS } from './testing/fence-cases';
import { readerFenceDifferentialFamilies } from './testing/reader-fence-differential';
import {
  protectedLines,
  type ReaderFenceExportCase,
  readerFenceCommentCases,
  readerFenceExportCases,
  readerFenceLiteralCases,
} from './testing/reader-fence-export-cases';

/** The projections' component names that matter here. */
const COMPONENTS: ReadonlySet<string> = new Set(['note', 'warning', 'tip', 'info', 'check', 'danger', 'callout', 'steps', 'badge']);
const projectors = [normalizePublicMarkdownContent, portablePublicMdxMarkdown] as const;
const flags = (values: readonly boolean[]) => values.map((value) => (value ? '1' : '0')).join('');

interface MainFixture {
  revision: string;
  cases: Array<{ outputs: [string, string]; protection: string }>;
  families: Record<string, { count: number; protection: string; lines?: string[] }>;
  /** `readerFenceCommentCases`, recorded the same way (#917 review). */
  comments: Array<{ outputs: [string, string]; protection: string }>;
  /** `readerFenceLiteralCases`, recorded the same way (#917 re-check). */
  literals: Array<{ outputs: [string, string]; protection: string }>;
}
const main = JSON.parse(readFileSync(new URL('./__fixtures__/mdx-tokens.reader-fences.main.json', import.meta.url), 'utf8')) as MainFixture;

describe("#587's reader repros through the export tokenizer (#591)", () => {
  it.each(FENCE_CONTAINER_REPROS)('reads the fence lines as the reader does, and the Note after it as a component: %s', (_name, repro) => {
    const source = `${repro}\n\n<Note>After</Note>`;
    const lines = source.split('\n');
    expect(mdxLineRoles(source, COMPONENTS).reader.map((kind) => kind === 'code')).toEqual(fencedMarkdownLines(lines));
    const tokens = tokenizeMdx(source, COMPONENTS);
    expect(tokens.slice(-3)).toEqual([
      { kind: 'open', name: 'note', attributes: '', raw: '<Note>', selfClosing: false },
      { kind: 'text', value: 'After' },
      { kind: 'close', name: 'note', raw: '</Note>' },
    ]);
    expect(buildMdxTree(tokens).at(-1)).toMatchObject({ kind: 'element', name: 'note', children: [{ kind: 'text', value: 'After' }] });
    // Tokens still concatenate to the source, byte for byte.
    expect(tokens.map((token) => ('raw' in token ? token.raw : token.value)).join('')).toBe(source);
  });

  it('exports the issue page with the Note as a callout and every other byte as main wrote it', () => {
    const source = '1. >~~~md\n   > [Literal](/literal)\n   > ~~~\n\n<Note>After</Note>';
    expect(normalizePublicMarkdownContent(source)).toBe('1. &gt;~~~md\n   > [Literal](/literal)\n   > ~~~\n\n> After');
    expect(portablePublicMdxMarkdown(source)).toBe('1. >~~~md\n   > [Literal](/literal)\n   > ~~~\n\n> After');
  });
});

describe('the reader scanner and the export tokenizer agree on structure (#591 differential)', () => {
  it.each(readerFenceDifferentialFamilies())('$name: identical reader roles, and main protection kept byte for byte', ({ name, sources }) => {
    const mismatches: number[] = [];
    const tokenDrift: number[] = [];
    const protection: string[] = [];
    for (const [index, source] of sources.entries()) {
      const roles = mdxLineRoles(source, COMPONENTS);
      if (flags(roles.reader.map((kind) => kind === 'code')) !== flags(fencedMarkdownLines(source.split('\n')))) mismatches.push(index);
      const fromTokens = flags(protectedLines(tokenizeMdx(source, COMPONENTS), source.split('\n').length));
      if (fromTokens !== flags(roles.protected)) tokenDrift.push(index);
      protection.push(fromTokens);
    }
    const recorded = main.families[name];
    expect({ count: sources.length, mismatches, tokenDrift }).toEqual({ count: recorded?.count, mismatches: [], tokenDrift: [] });
    if (!recorded?.lines) {
      // No exceptions: none of these pages has a callout main kept as code.
      expect(createHash('sha256').update(protection.join('\n')).digest('hex')).toBe(recorded?.protection);
      return;
    }
    // The only exceptions are the five repros followed by `<Note>After</Note>`: their last
    // line, the Note, leaves the protection. Every other line keeps main's.
    const exceptions: string[] = [];
    for (const [index, head] of protection.entries()) {
      const before = recorded.lines[index] ?? '';
      if (head === before) continue;
      const lines = (sources[index] as string).split('\n');
      const changed = [...head].flatMap((bit, line) => (bit === before[line] ? [] : [`${line}:${before[line]}>${bit}:${lines[line]}`]));
      exceptions.push(`${index} ${changed.join(' ')}`);
    }
    expect(exceptions).toEqual(
      [2, 5, 8, 11, 14].map((index) => `${index} ${(sources[index] as string).split('\n').length - 1}:1>0:<Note>After</Note>`),
    );
  });

  it('runs #590 property generator (seed 0x58236b09) at its full size', () => {
    const family = readerFenceDifferentialFamilies().find(({ name }) => name.startsWith('fence property'));
    expect(family?.sources).toHaveLength(3072);
  });
});

const quoted = (line: string) => `> ${/^<\w+>(.*)<\/\w+>$/.exec(line)?.[1]?.trim() ?? ''}`;

/** Each case against main's recorded export: controls byte-identical, and only the named callout
 *  lines changed, with author text once each and in order, code unchanged and nothing newly active. */
const compareWithMain = (cases: readonly ReaderFenceExportCase[], recordings: MainFixture['cases']) => {
  const failures: Array<{ index: number; target: number; reason: string }> = [];
  let reshapedCases = 0;
  let reshapedLines = 0;
  for (const { index, source, reshaped, markers } of cases) {
    const recorded = recordings[index];
    if (!recorded) throw new Error(`missing main case ${index}`);
    // Protection: main's, except the reshaped lines.
    const lines = source.split('\n');
    const expectedProtection = [...recorded.protection].map((bit, line) => (reshaped.includes(lines[line] as string) ? '0' : bit)).join('');
    if (flags(mdxLineRoles(source, COMPONENTS).protected) !== expectedProtection) failures.push({ index, target: -1, reason: 'protection' });
    if (reshaped.length > 0) {
      reshapedCases++;
      reshapedLines += lines.filter((line) => reshaped.includes(line)).length;
    }
    for (const [target, project] of projectors.entries()) {
      const before = recorded.outputs[target] as string;
      const output = project(source);
      const expected = before
        .split('\n')
        .map((line) => (reshaped.includes(line) ? quoted(line) : line))
        .join('\n');
      if (output !== expected) failures.push({ index, target, reason: reshaped.length ? 'reshaped output' : 'control changed' });
      if (reshaped.length === 0) continue;
      // The whole page: author text once each and in order, code unchanged, nothing newly active.
      let cursor = -1;
      for (const marker of markers) {
        const at = output.indexOf(marker);
        if (at < 0) failures.push({ index, target, reason: `lost ${marker}` });
        else if (output.indexOf(marker, at + 1) >= 0) failures.push({ index, target, reason: `duplicated ${marker}` });
        else if (at <= cursor) failures.push({ index, target, reason: `reordered ${marker}` });
        cursor = Math.max(cursor, at);
      }
      if (JSON.stringify(exportCodeSamples(output)) !== JSON.stringify(exportCodeSamples(before)))
        failures.push({ index, target, reason: 'code changed' });
      if (renderedActiveHtml(output) > renderedActiveHtml(before)) failures.push({ index, target, reason: 'newly active HTML' });
    }
  }
  return { failures, reshapedCases, reshapedLines };
};

describe('export form changes only for the reader-shown callout (#591)', () => {
  const cases = readerFenceExportCases();

  it('was recorded on main for exactly these shapes', () => {
    expect(main.revision).toBe('1de838f64172b5a9f49c285d8cf9c3ade3888c9d');
    expect(main.cases).toHaveLength(cases.length);
    expect(cases).toHaveLength(891);
  });

  it('keeps every control byte-identical to main and changes only the named callout lines, losing nothing', () => {
    const { failures, reshapedCases, reshapedLines } = compareWithMain(cases, main.cases);
    expect(failures.slice(0, 12), `${failures.length} failures`).toEqual([]);
    // 8 overrun fences x 8 eligible tails x 3 openings; one tail has two callouts.
    expect({ reshapedCases, reshapedLines }).toEqual({ reshapedCases: 192, reshapedLines: 216 });
  }, 60_000);
});

/** Whether the published reader shows `line`, a one-line callout, as a component: the reader's
 *  normalized source holds its expanded form outside code. */
const readerShows = (source: string, line: string): boolean => {
  const [, name, body] = /^<(\w+)>(.*)<\/\w+>$/.exec(line) ?? [];
  const normalized = normalizeMdxBlocks(source).split('\n');
  const fenced = fencedMarkdownLines(normalized);
  return normalized.some((text, index) => text === `<${name}>` && normalized[index + 2] === body && !fenced[index] && !fenced[index + 2]);
};

describe('callouts the reader strips or does not render as prose keep main bytes (#917 review)', () => {
  const REVIEW_REPRO = ['1. >~~~md', '   > CODEMARK', '   > ~~~', '', '{/*', '', '<Note>ReviewText</Note>', '', '*/}'].join('\n');

  it('exports the review repro, a callout inside a multiline MDX comment, as main wrote it', () => {
    // The reader strips the comment, so it shows no callout.
    expect(readerShows(REVIEW_REPRO, '<Note>ReviewText</Note>')).toBe(false);
    expect(portablePublicMdxMarkdown(REVIEW_REPRO)).toBe(REVIEW_REPRO);
    expect(normalizePublicMarkdownContent(REVIEW_REPRO)).toBe(REVIEW_REPRO.replace('1. >~~~md', '1. &gt;~~~md'));
    expect(mdxLineRoles(REVIEW_REPRO, COMPONENTS).protected.slice(2)).toEqual(Array.from({ length: 7 }, () => true));
  });

  it.each([
    ['a single-line comment around the callout', '{/* <Note>ReviewText</Note> */}'],
    ['a comment opened in a list item', '- {/*\n\n<Note>ReviewText</Note>\n\n*/}'],
    ['a comment opened in a quote', '> {/*\n\n<Note>ReviewText</Note>\n\n*/}'],
    ['a comment closed in a list item', '{/*\n\n<Note>ReviewText</Note>\n\n- */}'],
    ['a single-line comment before a fence opener', '{/* aside */}~~~\n\n<Note>ReviewText</Note>'],
    ['a one-line block holding a fence opener', '<Tip>~~~</Tip>\n\n<Note>ReviewText</Note>'],
    ['a callout on the line after `*/}`', '{/*\naside\n*/}\n<Note>ReviewText</Note>'],
  ])('keeps main bytes in both exports after %s', (_name, tail) => {
    const source = `1. >~~~md\n   > CODEMARK\n   > ~~~\n\n${tail}`;
    expect(portablePublicMdxMarkdown(source)).toBe(source);
    expect(normalizePublicMarkdownContent(source)).toBe(source.replace('1. >~~~md', '1. &gt;~~~md'));
  });

  it.each([
    ['an unclosed comment before it', '{/*\n\n<Note>ReviewText</Note>'],
    ['a closed comment and a blank line before it', '{/*\naside\n*/}\n\n<Note>ReviewText</Note>'],
    ['a single-line comment before it', '{/* aside */}\n\n<Note>ReviewText</Note>'],
  ])('quotes the callout the reader shows, after %s, in both exports', (_name, tail) => {
    const source = `1. >~~~md\n   > CODEMARK\n   > ~~~\n\n${tail}`;
    expect(readerShows(source, '<Note>ReviewText</Note>')).toBe(true);
    const quotedSource = source.replace('<Note>ReviewText</Note>', '> ReviewText');
    expect(portablePublicMdxMarkdown(source)).toBe(quotedSource);
    expect(normalizePublicMarkdownContent(source)).toBe(quotedSource.replace('1. >~~~md', '1. &gt;~~~md'));
  });

  const cases = readerFenceCommentCases();

  it('was recorded on main for exactly these shapes', () => {
    expect(main.comments).toHaveLength(cases.length);
    expect(cases).toHaveLength(528);
  });

  it('keeps every control byte-identical to main and quotes only callouts the reader shows, losing nothing', () => {
    const { failures, reshapedCases, reshapedLines } = compareWithMain(cases, main.comments);
    expect(failures.slice(0, 12), `${failures.length} failures`).toEqual([]);
    // 8 overrun fences x 6 eligible tails x 3 openings.
    expect({ reshapedCases, reshapedLines }).toEqual({ reshapedCases: 144, reshapedLines: 144 });
    // Every quoted callout is one the published reader shows as a component.
    const unshown = cases.flatMap(({ index, source, reshaped }) =>
      reshaped.filter((line) => !readerShows(source, line)).map((line) => `${index} ${line}`),
    );
    expect(unshown).toEqual([]);
  }, 60_000);
});

describe("the reader's line view (#917 review)", () => {
  it('matches the shared scanner on every differential source without braces', () => {
    const drift: string[] = [];
    for (const { name, sources } of readerFenceDifferentialFamilies())
      for (const [index, source] of sources.entries()) {
        if (source.includes('{')) continue;
        const lines = source.split('\n');
        const view = readerLineView(lines);
        const scan = markdownFenceLines(lines);
        if (
          JSON.stringify(view.kinds) !== JSON.stringify(scan.kinds) ||
          JSON.stringify([...view.closers]) !== JSON.stringify([...scan.closers]) ||
          view.commented.some(Boolean)
        )
          drift.push(`${name} ${index}`);
      }
    expect(drift).toEqual([]);
  });

  it('marks the lines a stripped comment covers and reads the lines after it as the reader does', () => {
    const lines = ['Text {/* a', '', 'b */} more', '{/* c */}~~~', '<Note>X</Note>', '~~~', '`{/*`', '<Tip>~~~</Tip>', 'code'];
    const view = readerLineView(lines);
    expect(view.commented).toEqual([true, true, true, true, false, false, false, false, false]);
    // `{/* c */}~~~` opens a fence once the comment is stripped; `~~~` closes it.
    expect(view.kinds).toEqual(['prose', 'prose', 'prose', 'code', 'code', 'code', 'prose', 'prose', 'prose']);
    expect([...view.closers]).toEqual([5]);
    // The reader expands `<Tip>~~~</Tip>`, which opens a fence over the rest.
    expect(view.code).toEqual([false, false, false, true, true, true, false, true, true]);
  });
});

describe('callouts the reader renders literally keep main bytes (#917 re-check)', () => {
  const PREFIX = '1. >~~~md\n   > CODEMARK\n   > ~~~\n\n';
  const NOTE = '<Note>ReviewText</Note>';

  it.each([
    ['a math block', `${PREFIX}$$\n\n${NOTE}\n\n$$`],
    ['an upper-case textarea', `${PREFIX}<TEXTAREA>\n\n${NOTE}\n\n</TEXTAREA>`],
  ])('exports the re-check repro, a callout inside %s, as main wrote it', (_name, source) => {
    expect(portablePublicMdxMarkdown(source)).toBe(source);
    expect(normalizePublicMarkdownContent(source)).toBe(source.replace('1. >~~~md', '1. &gt;~~~md'));
    expect(mdxLineRoles(source, COMPONENTS).protected.slice(2)).toEqual(
      source
        .split('\n')
        .slice(2)
        .map(() => true),
    );
  });

  const cases = readerFenceLiteralCases();

  it('was recorded on main for exactly these shapes', () => {
    expect(main.literals).toHaveLength(cases.length);
    expect(cases).toHaveLength(462);
  });

  it('keeps every control byte-identical to main and quotes only callouts the reader shows as prose, losing nothing', () => {
    const { failures, reshapedCases, reshapedLines } = compareWithMain(cases, main.literals);
    expect(failures.slice(0, 12), `${failures.length} failures`).toEqual([]);
    // 8 overrun fences x 1 eligible tail x 3 openings.
    expect({ reshapedCases, reshapedLines }).toEqual({ reshapedCases: 24, reshapedLines: 24 });
  }, 60_000);
});

describe('large pages through both exports and the reader (#917 re-check)', () => {
  const PAGE = '1. >~~~md\n   > CODEMARK\n   > ~~~\n\n<Note>ReviewText</Note>\n\n';

  it.each(projectors)('keeps the original callouts past the parse caps even with a long tail', (project) => {
    const source = `${PAGE}${'<Note>ReviewText</Note>\n\n'.repeat(5999)}${'q'.repeat(90_000)}`;
    const expected = project === normalizePublicMarkdownContent ? source.replace('1. >~~~md', '1. &gt;~~~md') : source;
    expect(project(source)).toBe(expected);
  });

  it('quotes callouts within the caps when the page has a long tail', () => {
    const source = `${PAGE}${'q'.repeat(90_000)}`;
    const expected = source.replace('<Note>ReviewText</Note>', '> ReviewText');
    expect(portablePublicMdxMarkdown(source)).toBe(expected);
    expect(normalizePublicMarkdownContent(source)).toBe(expected.replace('1. >~~~md', '1. &gt;~~~md'));
  });

  it('exports a 260 KB page without exhausting the stack, quoting the callout the reader shows', () => {
    const source = `${PAGE}${'a\n'.repeat(130_000)}`;
    expect(source.length).toBeGreaterThan(260_000);
    const quotedSource = source.replace('<Note>ReviewText</Note>', '> ReviewText');
    expect(portablePublicMdxMarkdown(source)).toBe(quotedSource);
    expect(normalizePublicMarkdownContent(source)).toBe(quotedSource.replace('1. >~~~md', '1. &gt;~~~md').replace(/\n+$/, ''));
    expect(() => normalizeMdxBlocks(source)).not.toThrow();
  }, 30_000);

  it("exports a 2 MB page without exhausting the stack, in main's form past the reader's parse bound", () => {
    const source = `${PAGE}${'a\n'.repeat(1_000_000)}`;
    expect(source.length).toBeGreaterThan(2_000_000);
    expect(portablePublicMdxMarkdown(source)).toBe(source);
    expect(normalizePublicMarkdownContent(source)).toBe(source.replace('1. >~~~md', '1. &gt;~~~md').replace(/\n+$/, ''));
    expect(() => normalizeMdxBlocks(source)).not.toThrow();
  }, 30_000);

  it('renders every line of a 130,000-line fence instead of throwing, as main did (intended reader change)', () => {
    const source = `\`\`\`\n${'a\n'.repeat(130_000)}\`\`\``;
    expect(normalizeMdxBlocks(source)).toBe(source);
  }, 30_000);
});

it('keeps the original callout when the React reader drops the body of a File component', () => {
  const source = '<File name="file.txt">\n\n1. >~~~md\n   > CODEMARK\n   > ~~~\n\n<Note>ReviewText</Note>\n\n</File>';
  expect(portablePublicMdxMarkdown(source)).toBe(source);
  expect(normalizePublicMarkdownContent(source)).toBe(
    source.replace('<File name="file.txt">', '&lt;File name="file.txt"&gt;').replace('1. >~~~md', '1. &gt;~~~md'),
  );
});

describe('the fence opener reads lines as its regex did, in linear time (#917 re-check)', () => {
  const regex = (line: string, maxIndent: number) => {
    const match = /^( *)(`{3,}|~{3,})(.*)$/.exec(line);
    const delimiter = match?.[2];
    if (!delimiter || (match?.[1]?.length ?? 0) > maxIndent || (delimiter[0] === '`' && match?.[3]?.includes('`'))) return;
    return { marker: delimiter.charAt(0), length: delimiter.length };
  };

  it('agrees on every line of up to 6 characters over spaces, markers, text and line terminators', () => {
    const alphabet = [' ', '`', '~', 'a', '\t', '\r', String.fromCharCode(0x20_28), String.fromCharCode(0x20_29)];
    let lines = [''];
    const drift: string[] = [];
    for (let length = 0; length <= 6; length += 1) {
      for (const line of lines)
        for (const maxIndent of [0, 3, Number.POSITIVE_INFINITY])
          if (JSON.stringify(openingMarkdownFence(line, maxIndent)) !== JSON.stringify(regex(line, maxIndent)))
            drift.push(JSON.stringify([line, maxIndent]));
      lines = lines.flatMap((line) => alphabet.map((character) => line + character));
    }
    expect(drift).toEqual([]);
  });
});
