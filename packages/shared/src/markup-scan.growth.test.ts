import { describe, expect, it } from 'vitest';
import {
  markdownAndHtmlImages,
  matchTags,
  replaceMarkdownImages,
  replaceMarkdownImageTargets,
  replaceMarkdownLinksWithLabels,
  replaceScriptAndStyleElements,
  replaceTagAttributes,
  replaceTags,
} from './markup-scan';
import { normalizePublicMarkdownContent as md, portablePublicMdxMarkdown as portable } from './public-markdown-content';
import { pageContentFacts } from './publish-checks';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

// Timing bounds, run on their own (pnpm test:growth; see testing/growth). Linear
// work measures about 4x for 4x the input; quadratic work, 16x.
describe.runIf(growthTestsEnabled)('linear tag and link scanning: growth', () => {
  const unique = (input: string, rep: number) => `${input} ${rep}`;
  it.each([
    ['case A', (text: string) => replaceTags(text, /<\/?[A-Za-z][^>]*>/g, ' '), (n: number) => '<a b'.repeat(n)],
    ['case B', (text: string) => matchTags(text, /<img\b[^>]*>/gi), (n: number) => '<img a'.repeat(n)],
    [
      'case C',
      (text: string) => replaceTagAttributes(text, /<a\b/gi, /(<a\b[^>]*\bhref=")([^"]*)(")/giy, (match) => match),
      (n: number) => `${'<a b '.repeat(n)}>`,
    ],
    ['case D', (text: string) => replaceMarkdownImages(text, ' '), (n: number) => '![a'.repeat(n)],
    ['case E', (text: string) => replaceMarkdownImages(text, ' '), (n: number) => `${'![a'.repeat(n)}]`],
    ['case F', (text: string) => replaceMarkdownLinksWithLabels(text), (n: number) => '[a'.repeat(n)],
    ['case G', (text: string) => replaceMarkdownImageTargets(text, (a, b, c) => a + b + c), (n: number) => '![](a "t'.repeat(n)],
    ['case H', (text: string) => markdownAndHtmlImages(text), (n: number) => '![a<img b'.repeat(n)],
    ['case I', (text: string) => replaceScriptAndStyleElements(text, ' '), (n: number) => '<script a'.repeat(n)],
  ] as const)(
    'stays linear on %s',
    (_label, run, build) => {
      const [small, large] = growthMs(run, build(4000), build(16_000), { vary: unique });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );

  it('stays linear on case J (normalizePublicMarkdownContent, portablePublicMdxMarkdown)', () => {
    const project = (source: string) => [md(source), portable(source)];
    for (const build of [(n: number) => `<script>\n${'<script "'.repeat(n)}`, (n: number) => `<style>\n${'<style a'.repeat(n)}`]) {
      const [small, large] = growthMs(project, build(500), build(2000), { vary: unique });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    }
  }, 60_000);

  it('stays linear on case K (pageContentFacts)', () => {
    const [small, large] = growthMs(
      (source: string) => pageContentFacts(source, false),
      `<p>${'<img a'.repeat(4000)}`,
      `<p>${'<img a'.repeat(16_000)}`,
      {
        vary: unique,
      },
    );
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  }, 60_000);
});
