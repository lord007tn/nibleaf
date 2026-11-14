import { createHash } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import { parse, postprocess, preprocess } from 'micromark';
import { gfm } from 'micromark-extension-gfm';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
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
}
export type ExportProjectors = readonly [(source: string) => string, (source: string) => string];
const exportHash = (source: string) => createHash('sha256').update(source).digest('hex');
const exportSourcesHash = (cases: readonly ExportGuardCase[]) => exportHash(cases.map(({ source }) => source).join('\0'));

/** Independent CommonMark token oracle. The tokenizer's serialization removes
 * container markup, retaining code bytes (including fences and span delimiters). */
export const exportCodeSamples = (source: string): string[] =>
  postprocess(
    parse({ extensions: [gfm()] })
      .document()
      .write(preprocess()(source, undefined, true)),
  )
    .filter(([kind, token]) => kind === 'enter' && ['codeFenced', 'codeIndented', 'codeText'].includes(token.type))
    .map(([, token, context]) => context.sliceSerialize(token));

const markdown = new MarkdownIt({ html: true });
const activeTags = ['script', 'style', 'iframe', 'object', 'embed'];
const dangerousUrl = (value: string): boolean => {
  const normalized = Array.from(value.toLowerCase())
    .filter((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127)
    .join('');
  // readerSanitizeSchema inherits href/src protocols that exclude every data: URL,
  // including raster images. There is no img-src exception in the reader.
  return normalized.startsWith('javascript:') || normalized.startsWith('vbscript:') || normalized.startsWith('data:');
};
const countElements = (root: DefaultTreeAdapterTypes.Node): number => {
  const pending = [root];
  let count = 0;
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if ('tagName' in node && activeTags.includes(node.tagName)) count++;
    if ('attrs' in node) {
      count += node.attrs.filter(
        ({ name, value }) => name.startsWith('on') || (['href', 'src', 'xlink:href'].includes(name) && dangerousUrl(value)),
      ).length;
    }
    if ('childNodes' in node) for (const child of node.childNodes) pending.push(child);
  }
  return count;
};

/** Render with raw HTML enabled, then count actual elements, handlers and URLs,
 * including entity-encoded attribute values. Code literals are inert. */
export const renderedActiveHtml = (source: string): number => countElements(parseFragment(markdown.render(source)));

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
  };
};

export const checkExportBaseline = (cases: readonly ExportGuardCase[], baseline: ExportGuardBaseline, projectors: ExportProjectors) => {
  const stats = [0, 1].map(() => ({
    lost: 0,
    lossShapes: 0,
    duplicated: 0,
    reordered: 0,
    changedCode: 0,
    codeSamples: 0,
    newlyActive: 0,
    exceedsReader: 0,
    differences: 0,
  }));
  const failures: Array<{ index: number; target: number; reason: string }> = [];
  const metadata: string[] = [];
  if (baseline.revision !== EXPORT_BASELINE_REVISION) metadata.push('wrong main revision');
  if (baseline.sources !== exportSourcesHash(cases)) metadata.push('generated sources changed');
  if ([baseline.kept.length, baseline.active.length, baseline.outputs.length].some((count) => count !== cases.length))
    metadata.push('missing baseline cases');
  for (const { index, source, markers } of cases) {
    const readerActive = readerSanitizedActiveHtml(source);
    const code = exportCodeSamples(source);
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
      const outputCode = exportCodeSamples(output);
      tally.codeSamples += code.length;
      for (const sample of code) {
        if (output.includes(sample) || outputCode.some((candidate) => candidate.includes(sample))) continue;
        tally.changedCode++;
        failures.push({ index, target, reason: `code bytes changed: ${JSON.stringify(sample.slice(0, 160))}` });
      }
      let lost = 0;
      let previous = -1;
      let duplicated = false;
      let reordered = false;
      for (const [bit, marker] of markers.entries()) {
        if ((expected & (1 << bit)) === 0) continue;
        const at = output.indexOf(marker);
        if (at === -1) lost++;
        else {
          if (output.indexOf(marker, at + marker.length) !== -1) duplicated = true;
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
      const outputActive = renderedActiveHtml(output);
      if (outputActive > active) {
        tally.newlyActive++;
        failures.push({ index, target, reason: 'newly active HTML' });
      }
      if (outputActive > readerActive) {
        tally.exceedsReader++;
        failures.push({ index, target, reason: 'active HTML exceeds sanitized reader' });
      }
      if (exportHash(output) !== hash) tally.differences++;
    }
  }
  return { metadata, stats, failures };
};
