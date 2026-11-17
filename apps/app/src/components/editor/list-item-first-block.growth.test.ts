// @vitest-environment jsdom
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions } from './tiptap-editor';

describe.runIf(growthTestsEnabled)('list-item schema fitting growth (#604)', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  const parser = (editor.storage as unknown as { markdown: { parser: { parse(source: string): string } } }).markdown.parser;
  parser.parse('');
  afterAll(() => editor.destroy());

  it.each([
    ['bullet headings', '- # Heading\n'],
    ['ordered headings', '1. # Heading\n'],
    ['callouts left on main’s path', '- > [!NOTE]\n  > Body\n'],
  ])('fits %s in one pass', (_name, item) => {
    const [small, large] = growthMs((source: string) => parser.parse(source), item.repeat(500), item.repeat(2000), { budgetMs: 15_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
