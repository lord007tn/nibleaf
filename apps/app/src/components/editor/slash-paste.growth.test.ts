// @vitest-environment jsdom
import type { MessageKey, MessageVariables } from '@nibleaf/i18n';
import { translateFn } from '@nibleaf/i18n';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { Editor } from '@tiptap/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const translate = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, 'en');
vi.mock('@nibleaf/i18n/react', async (original) => ({
  ...(await original<object>()),
  useT: () => translate,
  useLocale: () => ({ locale: 'en', t: translate, setLocale: () => undefined }),
}));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ projectId: 'project-1' }) }));
vi.mock('./active-branch-context', () => ({ useActiveBranchId: () => 'main' }));
vi.mock('@/hooks/api', () => ({ useLanguages: () => ({ data: [{ id: 'en', code: 'en' }] }), usePages: () => ({ data: [] }) }));

import { isSlashMenuOpen } from './extensions/slash-command';
import { buildEditorExtensions } from './tiptap-editor';

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('slash paste growth', () => {
  let editor: Editor;
  beforeAll(() => {
    editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  });
  afterAll(() => editor.destroy());

  /** Replace the page with `text` in one transaction, as a paste does, with the caret after it (kept out of undo history). */
  const paste = (text: string) => {
    const tr = editor.state.tr.insertText(text, 1, editor.state.doc.content.size - 1).setMeta('addToHistory', false);
    editor.view.dispatch(tr);
    return isSlashMenuOpen(editor.state);
  };

  it('handles a pasted slash followed by a long run of alternating combining marks in linear time', () => {
    // U+0300 and U+0315 have different combining classes, so normalizing the run
    // reorders all of it; the slash command rejects the over-long query before that.
    const pair = String.fromCodePoint(0x03_00, 0x03_15);
    const small = `/code${pair.repeat(2000)}`;
    const large = `/code${pair.repeat(8000)}`;
    expect(paste(large)).toBe(false);
    expect(editor.state.doc.textContent).toBe(large);
    const [smallMs, largeMs] = growthMs(paste, small, large);
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  });
});
