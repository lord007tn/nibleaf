import { createHash, randomUUID } from 'node:crypto';
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
for (const kind of ['link_open', 'image'] as const) {
  const original = parser.renderer.rules[kind];
  parser.renderer.rules[kind] = (tokens, at, options, env: { marker: string }, self) => {
    tokens[at]?.attrSet(env.marker, '');
    return original ? original(tokens, at, options, env, self) : self.renderToken(tokens, at, options);
  };
}
const analyzeExport = (source: string, render: boolean) => {
  const env = { marker: `data-export-${randomUUID()}` };
  while (source.includes(env.marker)) env.marker = `data-export-${randomUUID()}`;
  const tokens = parser.parse(source, env);
  const lines = source.split('\n');
  const code: string[] = [];
  const pending = [...tokens].reverse();
  while (pending.length) {
    const token = pending.pop();
    if (!token) continue;
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) code.push(lines.slice(...token.map).join('\n'));
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
    code,
    active: render ? countElements(parseFragment(parser.renderer.render(tokens, parser.options, env)), env.marker) : 0,
    literal: parser.utils.unescapeAll(source),
  };
};
export const exportCodeSamples = (source: string): string[] => analyzeExport(source, false).code;

const activeTags = ['script', 'style', 'iframe', 'object', 'embed'];
const dangerousUrl = (value: string): boolean => {
  const normalized = Array.from(value.toLowerCase())
    .filter((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127)
    .join('');
  // readerSanitizeSchema inherits href/src protocols that exclude every data: URL,
  // including raster images. There is no img-src exception in the reader.
  return normalized.startsWith('javascript:') || normalized.startsWith('vbscript:') || normalized.startsWith('data:');
};
const readerDropsUrl = (value: string, property: string): boolean => {
  const protocols = readerSanitizeSchema.protocols?.[property];
  const colon = value.indexOf(':');
  return (
    !!protocols?.length &&
    colon >= 0 &&
    !['/', '?', '#'].some((delimiter) => {
      const at = value.indexOf(delimiter);
      return at >= 0 && at < colon;
    }) &&
    !protocols.includes(value.slice(0, colon))
  );
};
const countElements = (root: DefaultTreeAdapterTypes.Node, marker: string): number => {
  const pending = [root];
  let count = 0;
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if ('tagName' in node && activeTags.includes(node.tagName)) count++;
    if ('attrs' in node) {
      const isMarkdown = node.attrs.some(({ name }) => name === marker);
      count += node.attrs.filter(
        ({ name, value }) =>
          name.startsWith('on') ||
          (['href', 'src', 'xlink:href'].includes(name) && (dangerousUrl(value) || (isMarkdown && readerDropsUrl(value, name)))),
      ).length;
    }
    if ('childNodes' in node) for (const child of node.childNodes) pending.push(child);
  }
  return count;
};

/** Render with raw HTML enabled, then count actual elements, handlers and URLs,
 * including entity-encoded attribute values. Code literals are inert. */
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
    const node = pending.pop() as { tagName?: string; properties?: Record<string, unknown>; children?: unknown[] };
    if (node.tagName && activeTags.includes(node.tagName)) active++;
    for (const [name, value] of Object.entries(node.properties ?? {})) {
      if (name.toLowerCase().startsWith('on') || (['href', 'src', 'xLinkHref'].includes(name) && dangerousUrl(String(value)))) active++;
    }
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
  return {
    sources: exportSourcesHash(cases),
    kept: cases.map(
      ({ markers }, index) =>
        outputs[index]?.map((output) => markers.reduce((bits, marker, bit) => bits | (output.includes(marker) ? 1 << bit : 0), 0)) as [
          number,
          number,
        ],
    ),
    active: outputs.map((pair) => pair.map(renderedActiveHtml) as [number, number]),
    outputs: outputs.map((pair) => pair.map(exportHash) as [string, string]),
    code: outputs.map((pair) => pair.map(exportCodeSamples) as [string[], string[]]),
  };
};

export const checkExportBaseline = (cases: readonly ExportGuardCase[], baseline: ExportGuardBaseline, projectors: ExportProjectors) => {
  const stats = [0, 1].map(() => ({
    lost: 0,
    lossShapes: 0,
    duplicated: 0,
    reordered: 0,
    changedCode: 0,
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
  if ([baseline.kept.length, baseline.active.length, baseline.outputs.length, baseline.code?.length].some((count) => count !== cases.length))
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
      const output = projectors[target](source);
      const tally = stats[target] as (typeof stats)[number];
      const code = baseline.code?.[index]?.[target] ?? [];
      tally.codeSamples += code.length;
      const unchanged = exportHash(output) === hash;
      if (active === 0) tally.inactiveChecks++;
      // A matching committed inactive output already proves every preservation
      // and activity assertion. No Markdown or reader parse is needed.
      if (unchanged && active === 0) continue;
      const mayBeActive = mayHaveActiveExportHtml(output);
      const needsCode = code.some((sample) => !output.includes(sample));
      const analysis = mayBeActive || needsCode ? analyzeExport(output, mayBeActive) : undefined;
      const outputCode = analysis?.code ?? [];
      for (const sample of code) {
        if (output.includes(sample) || outputCode.some((candidate) => candidate.includes(sample))) continue;
        tally.changedCode++;
        failures.push({ index, target, reason: `code bytes changed: ${JSON.stringify(sample.slice(0, 160))}` });
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
