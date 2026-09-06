import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));

import { MarkdownSourceEditor } from './markdown-source-editor';

describe('MarkdownSourceEditor', () => {
  it('keeps Markdown source LTR even when the document prose is Arabic', () => {
    const markup = renderToStaticMarkup(
      <MarkdownSourceEditor dir="rtl" label="Markdown" onChange={vi.fn()} placeholder="Write Markdown" value={'## التثبيت\n\n- الخطوة الأولى'} />,
    );

    expect(markup).toContain('<textarea aria-label="Markdown" dir="ltr"');
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('text-left');
    expect(markup).toContain('## التثبيت');
  });

  it('renders a full-width formatting toolbar and title inside the source canvas', () => {
    const markup = renderToStaticMarkup(
      <MarkdownSourceEditor
        label="Markdown"
        onChange={vi.fn()}
        placeholder="Write Markdown"
        titleSlot={<input aria-label="Document title" defaultValue="Full screen" />}
        value="Body"
      />,
    );

    expect(markup).toContain('role="toolbar"');
    expect(markup).toContain('aria-label="editor.mode.markdown"');
    expect(markup).toContain('aria-label="Document title"');
    expect(markup).toContain('data-slot="button"');
  });
});
