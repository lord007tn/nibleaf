import { createHash } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { mayHaveActiveExportHtml } from '../export-html';
import { captureExportStructure, compareExportStructure, type ExportStructure, exportSourceLines } from '../export-structure';
import { normalizeMdxBlocks } from '../reader-markdown';
import { readerSanitizeSchema } from '../reader-sanitize';

/** @public Used by `__fixtures__/markdown-export.guard.generate.mjs`, which knip.jsonc keeps out of analysis. */
export const EXPORT_BASELINE_REVISION = '2cf12d3fe325057c586fd1f6abd05247a1af6813';
export interface ExportGuardCase {
  index: number;
  source: string;
  markers: string[];
}
export interface ExportGuardBaseline {
  revision: string;
  seed?: number;
  sources: string;
  kept: [number, number][];
  active: [number, number][];
  outputs: [string, string][];
  code: [string[], string[]][];
  /** Hashes of ordered [role, content, markup, info] token tuples. */
  codeTokens: [string, string][];
  structure: [string | null, string | null][];
}
export type ExportProjectors = readonly [(source: string) => string, (source: string) => string];
const exportHash = (source: string) => createHash('sha256').update(source).digest('hex');
const exportSourcesHash = (cases: readonly ExportGuardCase[]) => exportHash(cases.map(({ source }) => source).join('\0'));

/** Literal code tokens in the same Markdown dialect as the activity oracle.
 * Blocks include their original prefixes/delimiters; spans keep their raw bytes. */
const parser = new MarkdownIt({ html: true });
const codeSpans = new WeakMap<Token, { source: string; start: number }>();
const BaseInlineState = parser.inline.State;
parser.inline.State = class extends BaseInlineState {
  override push(type: string, tag: string, nesting: Token['nesting']): Token {
    const token = super.push(type, tag, nesting);
    if (type === 'code_inline') codeSpans.set(token, { source: this.src, start: this.pos });
    return token;
  }
};
const analyzeExport = (source: string, render: boolean) => {
  const env = {};
  const tokens = parser.parse(source, env);
  const lines = exportSourceLines(source);
  const code: string[] = [];
  const codeTokens: string[] = [];
  const pending = [...tokens].reverse();
  while (pending.length) {
    const token = pending.pop();
    if (!token) continue;
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
      const raw = source.slice(lines[token.map[0]]?.start ?? source.length, lines[token.map[1]]?.start ?? source.length);
      code.push(raw.endsWith('\n') || raw.endsWith('\r') ? raw.slice(0, -1) : raw);
    }
    if (['fence', 'code_block', 'code_inline'].includes(token.type))
      codeTokens.push(JSON.stringify([token.type, token.content, token.markup, token.info]));
    const span = codeSpans.get(token);
    if (span) {
      let at = span.start + token.markup.length;
      for (;;) {
        const next = span.source.indexOf('`', at);
        if (next < 0) throw new Error('Missing closing code delimiter');
        at = next;
        while (span.source[at] === '`') at++;
        if (at - next === token.markup.length) break;
      }
      code.push(span.source.slice(span.start, at));
    }
    if (token.children)
      for (let at = token.children.length - 1; at >= 0; at--) {
        const child = token.children[at];
        if (child) pending.push(child);
      }
  }
  return {
    tokens,
    code,
    codeTokens,
    active: render ? countElements(parseFragment(parser.renderer.render(tokens, parser.options, env))) : 0,
    literal: parser.utils.unescapeAll(source),
  };
};
export const exportCodeSamples = (source: string): string[] => analyzeExport(source, false).code;

const activeTags = ['script', 'style', 'iframe', 'object', 'embed'];
const countElements = (root: DefaultTreeAdapterTypes.Node): number => {
  const pending = [root];
  let count = 0;
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if ('tagName' in node && activeTags.includes(node.tagName)) count++;
    if ('childNodes' in node) for (const child of node.childNodes) pending.push(child);
  }
  return count;
};

/** Render with raw HTML enabled, then count only the five active elements. Handler/URL hardening is tracked in #664.
 * Code literals are inert. */
export const renderedActiveHtml = (source: string): number => analyzeExport(source, true).active;

const reader = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, readerSanitizeSchema);
/** Independent reader oracle: the same normalization, HTML parser and schema as the rich reader. */
export const readerSanitizedActiveHtml = (source: string): number => {
  const tree = reader.runSync(reader.parse(normalizeMdxBlocks(source)));
  const pending: unknown[] = [tree];
  let active = 0;
  while (pending.length) {
    const node = pending.pop() as { tagName?: string; children?: unknown[] };
    if (node.tagName && activeTags.includes(node.tagName)) active++;
    pending.push(...(node.children ?? []));
  }
  return active;
};

/** @public Used by `__fixtures__/markdown-export.guard.generate.mjs`, which knip.jsonc keeps out of analysis. */
export const recordExportBaseline = (
  cases: readonly ExportGuardCase[],
  projectors: ExportProjectors,
): Omit<ExportGuardBaseline, 'revision' | 'seed'> => {
  const outputs = cases.map(({ source }) => projectors.map((project) => project(source)) as [string, string]);
  const analyses = outputs.map((pair) => pair.map((output) => analyzeExport(output, true)));
  return {
    sources: exportSourcesHash(cases),
    kept: cases.map(
      ({ markers }, index) =>
        outputs[index]?.map((output) => markers.reduce((bits, marker, bit) => bits | (output.includes(marker) ? 1 << bit : 0), 0)) as [
          number,
          number,
        ],
    ),
    active: analyses.map((pair) => pair.map((analysis) => analysis.active) as [number, number]),
    outputs: outputs.map((pair) => pair.map(exportHash) as [string, string]),
    code: analyses.map((pair) => pair.map((analysis) => analysis.code) as [string[], string[]]),
    codeTokens: analyses.map((pair) => pair.map((analysis) => exportHash(JSON.stringify(analysis.codeTokens))) as [string, string]),
    structure: analyses.map(
      (pair, index) =>
        pair.map((analysis, target) =>
          analysis.active ? JSON.stringify(captureExportStructure(outputs[index]?.[target] ?? '', analysis.tokens)) : null,
        ) as [string | null, string | null],
    ),
  };
};

const isSourceText = (samples: readonly string[], source: string): boolean => {
  let cursor = 0;
  for (const sample of samples) {
    let found = source.indexOf(sample, cursor);
    let length = sample.length;
    const parts = exportSourceLines(sample);
    if (parts.length > 1 && parts.at(-1)?.text === '' && parts.at(-1)?.ending === '') parts.pop();
    const lines = parts.map((line) => line.text);
    const first = lines[0] ?? '';
    // A parsed container consumes at most four spaces and a marker per level.
    // Bound candidate prefixes by the parser's nesting limit, not code length.
    const nesting = 'maxNesting' in parser.options && typeof parser.options.maxNesting === 'number' ? parser.options.maxNesting : 100;
    const limit = Math.min(first.length, nesting * 5 + 4);
    for (let end = 1; end <= limit; end++) {
      if (first[end - 1] !== '>' && first[end - 1] !== ' ') break;
      const prefix = first.slice(0, end);
      const blank = prefix.trimEnd();
      if (!lines.every((line) => line.startsWith(prefix) || line === blank)) continue;
      const literal = parts
        .map(({ text, ending }) => (text.startsWith(prefix) ? text.slice(prefix.length) : text.slice(blank.length)) + ending)
        .join('');
      const at = source.indexOf(literal, cursor);
      if (at >= 0 && (found < 0 || at < found)) {
        found = at;
        length = literal.length;
      }
    }
    if (found < 0) return false;
    cursor = found + length;
  }
  return true;
};
export const checkExportBaseline = (cases: readonly ExportGuardCase[], baseline: ExportGuardBaseline, projectors: ExportProjectors) => {
  const stats = [0, 1].map(() => ({
    lost: 0,
    lossShapes: 0,
    duplicated: 0,
    reordered: 0,
    changedCode: 0,
    structuralChanges: 0,
    exceptions: 0,
    inactiveChanged: 0,
    inactiveChecks: 0,
    active: 0,
    codeSamples: 0,
    newlyActive: 0,
    exceedsReader: 0,
    differences: 0,
  }));
  const failures: Array<{ index: number; target: number; reason: string }> = [];
  const metadata: string[] = [];
  if (baseline.revision !== EXPORT_BASELINE_REVISION) metadata.push('wrong main revision');
  if (baseline.sources !== exportSourcesHash(cases)) metadata.push('generated sources changed');
  if (
    [
      baseline.kept.length,
      baseline.active.length,
      baseline.outputs.length,
      baseline.code?.length,
      baseline.codeTokens?.length,
      baseline.structure?.length,
    ].some((count) => count !== cases.length)
  )
    metadata.push('missing baseline cases');
  for (const { index, source, markers } of cases) {
    for (const target of [0, 1] as const) {
      const expected = baseline.kept[index]?.[target];
      const active = baseline.active[index]?.[target];
      const hash = baseline.outputs[index]?.[target];
      if (typeof expected !== 'number' || typeof active !== 'number' || typeof hash !== 'string') {
        failures.push({ index, target, reason: 'missing baseline' });
        continue;
      }
      const tally = stats[target] as (typeof stats)[number];
      let output: string;
      try {
        output = projectors[target](source);
      } catch (error) {
        tally.exceptions++;
        failures.push({ index, target, reason: `export threw: ${String(error)}` });
        continue;
      }
      const code = baseline.code?.[index]?.[target] ?? [];
      tally.codeSamples += code.length;
      const unchanged = exportHash(output) === hash;
      if (active === 0) tally.inactiveChecks++;
      // A matching committed inactive output already proves every preservation
      // and activity assertion. No Markdown or reader parse is needed.
      if (unchanged && active === 0) continue;
      const mayBeActive = mayHaveActiveExportHtml(output);
      // Any changed output is parsed: an empty code baseline must still reject
      // code that the change introduced.
      const analysis = !unchanged || mayBeActive || code.length ? analyzeExport(output, mayBeActive) : undefined;
      const outputCode = analysis?.code ?? [];
      const expectedTokens = baseline.codeTokens[index]?.[target];
      const actualTokens = analysis?.codeTokens ?? [];
      const recordedStructure = baseline.structure?.[index]?.[target];
      const structure = recordedStructure ? (JSON.parse(recordedStructure) as ExportStructure) : undefined;
      if (active > 0 && !structure) {
        tally.structuralChanges++;
        failures.push({ index, target, reason: 'missing structural baseline' });
      }
      if (structure && analysis && !compareExportStructure(structure, output, analysis.tokens).equal) {
        tally.structuralChanges++;
        failures.push({ index, target, reason: 'formatting changed outside the HTML run and its bounded separators' });
      }
      // An edited HTML run may reveal a fence that main swallowed into raw
      // HTML. The structural comparison still pins all outside tokens. When
      // main had no code, accept revealed samples only as contiguous source
      // spans in order, removing at most one uniform container prefix.
      const revealed = code.length === 0 && active > 0 && isSourceText(outputCode, source);
      if (!revealed && (JSON.stringify(outputCode) !== JSON.stringify(code) || exportHash(JSON.stringify(actualTokens)) !== expectedTokens)) {
        tally.changedCode++;
        failures.push({ index, target, reason: 'code tokens changed (bytes, role, content, order or occurrences)' });
      }
      // Literalizing an unsafe HTML span may entity-escape punctuation in a
      // marker. Decode escapes only for prose preservation; code stays exact.
      const literalOutput = analysis?.literal ?? parser.utils.unescapeAll(output);
      let lost = 0;
      let previous = -1;
      let duplicated = false;
      let reordered = false;
      for (const [bit, marker] of markers.entries()) {
        if ((expected & (1 << bit)) === 0) continue;
        const at = literalOutput.indexOf(marker);
        if (at === -1) lost++;
        else {
          if (literalOutput.indexOf(marker, at + marker.length) !== -1) duplicated = true;
          if (at <= previous) reordered = true;
          previous = at;
        }
      }
      tally.lost += lost;
      if (lost > 0) {
        tally.lossShapes++;
        failures.push({ index, target, reason: `${lost} lost markers` });
      }
      if (duplicated) {
        tally.duplicated++;
        failures.push({ index, target, reason: 'duplicated markers' });
      }
      if (reordered) {
        tally.reordered++;
        failures.push({ index, target, reason: 'reordered markers' });
      }
      // A matching hash also retains a known-active main count: never let a
      // preflight decision override the committed activity evidence.
      const outputActive = unchanged ? active : (analysis?.active ?? 0);
      tally.active += outputActive;
      if (outputActive !== 0) failures.push({ index, target, reason: 'active HTML remains' });
      if (outputActive > active) {
        tally.newlyActive++;
        failures.push({ index, target, reason: 'newly active HTML' });
      }
      // Zero is no greater than any sanitized-reader count. Enforce that
      // stronger target without reparsing every source through the reader.
      if (outputActive > 0) {
        tally.exceedsReader++;
        failures.push({ index, target, reason: 'active HTML exceeds sanitized reader' });
      }
      if (!unchanged) {
        tally.differences++;
        if (active === 0) {
          tally.inactiveChanged++;
          failures.push({ index, target, reason: 'inactive main output changed' });
        }
      }
    }
  }
  return { metadata, stats, failures };
};
