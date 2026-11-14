import { createHash } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';

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
export const exportHash = (source: string) => createHash('sha256').update(source).digest('hex');
export const exportSourcesHash = (cases: readonly ExportGuardCase[]) => exportHash(cases.map(({ source }) => source).join('\0'));

const markdown = new MarkdownIt({ html: true });
const activeTags = ['script', 'style', 'iframe', 'object', 'embed'];
const countElements = (node: DefaultTreeAdapterTypes.Node): number =>
  ('tagName' in node && activeTags.includes(node.tagName) ? 1 : 0) +
  ('childNodes' in node ? node.childNodes.reduce((sum, child) => sum + countElements(child), 0) : 0);

/** Same rendered-Markdown check as Sol's probe. The default renderer cannot
 * synthesize these five tags; skip parsing only when none can occur in source.
 * Candidates are still fully rendered and parsed, including fenced literals. */
export const renderedActiveHtml = (source: string): number => {
  const lower = source.toLowerCase();
  if (!activeTags.some((tag) => lower.includes(`<${tag}`))) return 0;
  return countElements(parseFragment(markdown.render(source)));
};

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
  const stats = [0, 1].map(() => ({ lost: 0, lossShapes: 0, duplicated: 0, reordered: 0, newlyActive: 0, differences: 0 }));
  const failures: Array<{ index: number; target: number; reason: string }> = [];
  const metadata: string[] = [];
  if (baseline.revision !== EXPORT_BASELINE_REVISION) metadata.push('wrong main revision');
  if (baseline.sources !== exportSourcesHash(cases)) metadata.push('generated sources changed');
  if ([baseline.kept.length, baseline.active.length, baseline.outputs.length].some((count) => count !== cases.length))
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
      if (renderedActiveHtml(output) > active) {
        tally.newlyActive++;
        failures.push({ index, target, reason: 'newly active HTML' });
      }
      if (exportHash(output) !== hash) tally.differences++;
    }
  }
  return { metadata, stats, failures };
};
