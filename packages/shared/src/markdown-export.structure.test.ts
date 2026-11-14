import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';
import { expect, it, vi } from 'vitest';
import { captureExportStructure, compareExportStructure } from './export-structure';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { expandedExportStructureCases, exportContentHazardCases } from './testing/export-structure-cases';
import { markdownCorpus } from './testing/markdown-corpus';

const mode = vi.hoisted(() => ({ main: false }));
vi.mock('./export-html', async (original) => {
  const actual = await original<typeof import('./export-html')>();
  return { ...actual, escapeDisallowedExportHtml: (source: string) => (mode.main ? source : actual.escapeDisallowedExportHtml(source)) };
});
const md = new MarkdownIt({ html: true });
const active = ['script', 'style', 'iframe', 'object', 'embed'];
const inspect = (source: string) => {
  const tokens = md.parse(source, {});
  const pending: DefaultTreeAdapterTypes.Node[] = [parseFragment(md.renderer.render(tokens, md.options, {}))];
  const features: string[] = [];
  let elements = 0;
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if ('tagName' in node) {
      if (active.includes(node.tagName)) elements++;
      for (const attribute of node.attrs) {
        const value = Array.from(attribute.value.toLowerCase())
          .filter((c) => c.charCodeAt(0) > 32 && c.charCodeAt(0) !== 127)
          .join('');
        if (
          attribute.name.startsWith('on') ||
          (['href', 'src', 'xlink:href'].includes(attribute.name) && ['javascript:', 'vbscript:', 'data:'].some((scheme) => value.startsWith(scheme)))
        )
          features.push(`${node.tagName}:${attribute.name}:${attribute.value}`);
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) pending.push(child);
  }
  return { tokens, features, elements };
};

it.each([
  ['expanded HTML classes 1-7, seed 0x633652bb', expandedExportStructureCases, 19_800],
  ['inert content, closing injections, case and inline hazards', exportContentHazardCases, 3030],
  ['352-page repository corpus', () => markdownCorpus(fileURLToPath(new URL('../../..', import.meta.url))).map(([, source]) => source), 352],
] as const)(
  'preserves structure, source text and inert content: %s',
  (_label, build, count) => {
    const cases = build();
    const failures: unknown[] = [];
    const totals = { exports: 0, live: 0, newFeatures: 0, structure: 0, textLoss: 0, inactiveChanges: 0, bounded: 0 };
    for (const source of cases)
      for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
        mode.main = true;
        const baseline = project(source);
        mode.main = false;
        const output = project(source);
        const before = inspect(baseline);
        const after = inspect(output);
        const comparison = compareExportStructure(captureExportStructure(baseline, before.tokens), output, after.tokens);
        const allowed = [...before.features];
        let newlyLive = 0;
        for (const feature of after.features) {
          const at = allowed.indexOf(feature);
          if (at < 0) newlyLive++;
          else allowed.splice(at, 1);
        }
        totals.exports++;
        totals.live += after.elements;
        totals.newFeatures += newlyLive;
        totals.structure += Number(!comparison.equal);
        totals.textLoss += Number(!comparison.preserved);
        totals.inactiveChanges += Number(!before.elements && baseline !== output);
        totals.bounded += Number(comparison.boundaryCount > 0);
        if ((after.elements || newlyLive || !comparison.equal || (!before.elements && baseline !== output)) && failures.length < 8)
          failures.push({ source, baseline, output, live: after.elements, newlyLive, structure: comparison.equal, preserved: comparison.preserved });
      }
    console.info(_label, totals);
    expect(cases.length).toBe(count);
    expect({
      failures,
      live: totals.live,
      newFeatures: totals.newFeatures,
      structure: totals.structure,
      textLoss: totals.textLoss,
      inactiveChanges: totals.inactiveChanges,
    }).toEqual({ failures: [], live: 0, newFeatures: 0, structure: 0, textLoss: 0, inactiveChanges: 0 });
  },
  240_000,
);

const reviewedBoundaries = [
  '> <script></script>\n> <a>\n\tCODE',
  '- <pre><script></script>\n\n  TEXT\n- NEXT',
  '- <script></script>\n  <a>\n- NEXT',
  '- <script></script>\n      CODE\n- NEXT',
  '-\t<script></script>\n        CODE\n- NEXT',
  '- <script data-x="\0"></script>\n      CODE\n- NEXT',
  '- <script>BODY\n  </textarea>\n      CODE\n  <img onerror="NEW_ATTACK()">\n  </script>\n- NEXT',
];
it.each(
  reviewedBoundaries.flatMap((source) =>
    [
      ['LF', '\n'],
      ['CRLF', '\r\n'],
      ['CR', '\r'],
    ].map(([label, ending]) => ({ label, source: source.replaceAll('\n', ending ?? '\n') })),
  ),
)('pins the reviewed boundary ($label): $source', ({ source }) => {
  mode.main = true;
  const baseline = portablePublicMdxMarkdown(source);
  mode.main = false;
  const output = portablePublicMdxMarkdown(source);
  const before = inspect(baseline),
    after = inspect(output);
  expect(after.elements).toBe(0);
  expect(compareExportStructure(captureExportStructure(baseline, before.tokens), output, after.tokens).equal).toBe(true);
});
