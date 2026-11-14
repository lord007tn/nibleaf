import { describe, expect, it } from 'vitest';
import { normalizePublicMarkdownContent as md, portablePublicMdxMarkdown as portable } from './public-markdown-content';
import { renderedActiveHtml } from './testing/export-guard';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

// Timing bounds, run on their own (pnpm test:growth; see testing/growth). Linear
// work measures about 4x for 4x the input (deep nesting about 5x, an n log n-like
// term that stays flat from 5k to 320k); quadratic work 16x. Inputs stay small
// (a large call takes 3 to 10 ms) and samples last at least 20 ms, so each
// spans several scheduler slices on a busy runner rather than one.
describe.runIf(growthTestsEnabled)('projection robustness (#341): growth', () => {
  it.each([
    ['unmatched backticks', (n: number) => 'a ` b '.repeat(n), 2000],
    ['unclosed tags', (n: number) => '<Note title="x" '.repeat(n), 100],
    ['unclosed quotes', (n: number) => '<Card title="'.repeat(n), 300],
    ['unbalanced braces', (n: number) => 'x { y '.repeat(n), 1500],
    ['deep quote markers', (n: number) => `${'> '.repeat(n)}x`, 50_000],
    ['deep nesting', (n: number) => `${'<Note>'.repeat(n)}x${'</Note>'.repeat(n)}`, 375],
    ...(['quotes', 'lists', 'components'] as const).map(
      (kind) =>
        [
          `deep ${kind} with HTML`,
          (n: number) => {
            const body =
              '<sup>SAFE</sup><sub>SAFE</sub><u>SAFE</u><video src="/SAFE.mp4"></video><mdxembed provider="youtube" videoid="abcdefghijk"></mdxembed><img src="x" onerror="SAFE()"><script>SAFE</script>\n\n![SAFE](data:image/png;base64,SAFE)';
            return kind === 'quotes'
              ? '> '.repeat(n) + body
              : kind === 'lists'
                ? '- '.repeat(n) + body
                : '<Note>'.repeat(n) + body + '</Note>'.repeat(n);
          },
          1000,
        ] as const,
    ),
    [
      'export HTML safety',
      (n: number) =>
        `> <div>\n> ~~~\n${'<div onclick="run()"><sup>2</sup><img src="javascript:x"></div>\n\n![image](data:image/png;base64,AAAA)\n\n'.repeat(n)}`,
      250,
    ],
  ] as const)(
    'scales linearly on %s',
    (label, build, n) => {
      const project = (source: string) => [md(source), portable(source)];
      const [small, large] = growthMs(project, build(n), build(4 * n), { minMs: 20 });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
      if (label === 'export HTML safety') {
        console.info(`Export safety growth n=${n}, 4n=${4 * n}: ${small.toFixed(1)} / ${large.toFixed(1)} ms`);
        expect(project(build(n)).map(renderedActiveHtml)).toEqual([0, 0]);
      }
      if (label.startsWith('deep ') && label.endsWith(' with HTML')) {
        console.info(`${label}, n=${n}, 4n=${4 * n}: ${small.toFixed(1)} / ${large.toFixed(1)} ms`);
        for (const output of project(build(4 * n))) {
          expect(output).toContain('SAFE');
          expect(output).not.toContain('<');
          expect(renderedActiveHtml(output)).toBe(0);
        }
      }
    },
    60_000,
  );
});
