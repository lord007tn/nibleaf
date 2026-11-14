// @vitest-environment jsdom
import { constantGrowthLimit, growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import type { EditorLinks, EditorLinkTarget } from './editor-links';
import { brokenLinkDecorations, updateBrokenLinks } from './extensions/broken-link-flags';
import { findFixMatches } from './publish-fix';
import { buildEditorExtensions } from './tiptap-editor';

/** `n` paragraphs with a link to a page that exists; every paragraph, or only the first two, also links to a missing page. */
const page = (n: number, brokenEverywhere: boolean) =>
  Array.from({ length: n }, (_, index) => {
    const broken = brokenEverywhere || index < 2 ? ` and <a href="/configuration">the configuration</a>` : '';
    return `<p>Step ${index}: read <a href="/guide">the guide</a>${broken}.</p>`;
  }).join('');

const resolve = (href: string): EditorLinkTarget => (href === '/guide' ? { kind: 'page', pageId: 'guide' } : { kind: 'missing' });
const links = { resolve } as unknown as EditorLinks;

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('Publish check Fix and broken-link flag growth', () => {
  const editors: Editor[] = [];
  const open = (content: string) => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ getLinks: () => links }), content });
    editors.push(editor);
    return editor.state;
  };
  afterAll(() => {
    for (const editor of editors) editor.destroy();
  });
  /** A character typed in the first paragraph, against the page's current flags. */
  const keystroke = (state: Editor['state']) => ({ previous: brokenLinkDecorations(state.doc, resolve, 'en'), tr: state.tr.insertText('x', 3) });
  const update = ({ previous, tr }: ReturnType<typeof keystroke>) => updateBrokenLinks(previous, tr, resolve, 'en');

  it('finds every place a Fix names in one linear walk of the page', () => {
    const [smallMs, largeMs] = growthMs(
      (state) => findFixMatches(state.doc, 'broken-internal-link', '/configuration'),
      open(page(300, true)),
      open(page(1200, true)),
      { budgetMs: 10_000 },
    );
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  });

  it('a keystroke looks again only at the paragraph it changed, whatever the page’s length', () => {
    const [smallMs, largeMs] = growthMs(update, keystroke(open(page(300, false))), keystroke(open(page(1200, false))), {
      budgetMs: 10_000,
      minMs: 12,
    });
    expect(largeMs).toBeLessThanOrEqual(constantGrowthLimit(smallMs));
  });

  it('a keystroke on a page full of broken links stays linear in the flags it moves', () => {
    const [smallMs, largeMs] = growthMs(update, keystroke(open(page(300, true))), keystroke(open(page(1200, true))), { budgetMs: 10_000 });
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  });
});
