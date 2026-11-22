import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fencedMarkdownLines } from './markdown-code';
import { buildMdxTree, mdxLineRoles, tokenizeMdx } from './mdx-tokens';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { exportCodeSamples, renderedActiveHtml } from './testing/export-guard';
import { FENCE_CONTAINER_REPROS } from './testing/fence-cases';
import { readerFenceDifferentialFamilies } from './testing/reader-fence-differential';
import { protectedLines, readerFenceExportCases } from './testing/reader-fence-export-cases';

/** The projections' component names that matter here. */
const COMPONENTS: ReadonlySet<string> = new Set(['note', 'warning', 'tip', 'info', 'check', 'danger', 'callout', 'steps', 'badge']);
const projectors = [normalizePublicMarkdownContent, portablePublicMdxMarkdown] as const;
const flags = (values: readonly boolean[]) => values.map((value) => (value ? '1' : '0')).join('');

interface MainFixture {
  revision: string;
  cases: Array<{ outputs: [string, string]; protection: string }>;
  families: Record<string, { count: number; protection: string; lines?: string[] }>;
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

describe('export form changes only for the reader-shown callout (#591)', () => {
  const cases = readerFenceExportCases();
  const quoted = (line: string) => `> ${/^<\w+>(.*)<\/\w+>$/.exec(line)?.[1]?.trim() ?? ''}`;

  it('was recorded on main for exactly these shapes', () => {
    expect(main.revision).toBe('1de838f64172b5a9f49c285d8cf9c3ade3888c9d');
    expect(main.cases).toHaveLength(cases.length);
    expect(cases).toHaveLength(891);
  });

  it('keeps every control byte-identical to main and changes only the named callout lines, losing nothing', () => {
    const failures: Array<{ index: number; target: number; reason: string }> = [];
    let reshapedCases = 0;
    let reshapedLines = 0;
    for (const { index, source, reshaped, markers } of cases) {
      const recorded = main.cases[index];
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
    expect(failures.slice(0, 12), `${failures.length} failures`).toEqual([]);
    // 8 overrun fences x 8 eligible tails x 3 openings; one tail has two callouts.
    expect({ reshapedCases, reshapedLines }).toEqual({ reshapedCases: 192, reshapedLines: 216 });
  }, 60_000);
});
