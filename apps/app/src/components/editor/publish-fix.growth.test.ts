// @vitest-environment jsdom
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { findFixMatches, loadFixCounter } from './publish-fix';
import { buildEditorExtensions, seedMarkdown } from './tiptap-editor';

/** `n` paragraphs, each with a link to a missing page and one to a page that exists. */
const page = (n: number) =>
  Array.from(
    { length: n },
    (_, index) => `<p>Step ${index}: read <a href="/guide">the guide</a> and <a href="/configuration">the configuration</a>.</p>`,
  ).join('');

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('Publish check Fix growth', () => {
  const editors: Editor[] = [];
  const editorWith = () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    editors.push(editor);
    return editor;
  };
  afterAll(() => {
    for (const editor of editors) editor.destroy();
  });

  it('finds every place a Fix names in one linear walk of the page', () => {
    const open = (n: number) => {
      const editor = editorWith();
      editor.commands.setContent(page(n), { emitUpdate: false });
      return editor.state;
    };
    const [smallMs, largeMs] = growthMs((state) => findFixMatches(state.doc, 'broken-internal-link', '/configuration'), open(300), open(1200), {
      budgetMs: 10_000,
    });
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  });

  it('a long malformed block kept as source is read once, with the check’s own count', async () => {
    const counter = await loadFixCounter('broken-internal-link', '/configuration');
    if (!counter) throw new Error('The check could not be loaded');
    /** A broken link, then an unsupported component full of unfinished iframe tags. */
    const malformed = (n: number) => {
      const editor = editorWith();
      seedMarkdown(editor, `Read [the configuration](/configuration).\n\n<Unknown>${'<iframe {'.repeat(n)}</Unknown>`);
      return editor.state;
    };
    const [smallMs, largeMs] = growthMs(
      (state) => findFixMatches(state.doc, 'broken-internal-link', '/configuration', counter),
      malformed(500),
      malformed(2000),
      {
        budgetMs: 10_000,
      },
    );
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  });
});
