// @vitest-environment jsdom
import { siteContentT } from '@nibleaf/i18n/site-content';
import { Editor } from '@tiptap/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import RichMarkdown from '../markdown-rich';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

const editors: Editor[] = [];
const createEditor = (content: string) => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  editor.commands.setContent(content, { emitUpdate: false });
  return editor;
};
const firstNode = (editor: Editor, type: string) => {
  let found: { attrs: Record<string, unknown> } | undefined;
  editor.state.doc.descendants((node) => {
    if (!found && node.type.name === type) found = node;
    return !found;
  });
  return found;
};
const render = (markdown: string) =>
  renderToStaticMarkup(createElement(RichMarkdown, { content: markdown, site: { projectId: 'p1', lang: 'en', defaultLanguage: 'en' } }));

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('boolean MDX attributes in pasted HTML', () => {
  it.each([
    ['a plain attribute', '<accordion title="FAQ" defaultopen="false"><p>Body</p></accordion>'],
    ['an editor data attribute', '<div data-mdx="Accordion" data-title="FAQ" data-defaultopen="false"><p>Body</p></div>'],
  ])('reads defaultOpen="false" on %s as closed', (_label, html) => {
    const editor = createEditor(html);
    expect(firstNode(editor, 'mdxAccordion')?.attrs.defaultOpen).toBe(false);
    expect(getMarkdown(editor)).not.toContain('defaultOpen');
  });

  it.each([
    ['presence', '<accordion title="FAQ" defaultopen><p>Body</p></accordion>'],
    ['"true"', '<accordion title="FAQ" defaultopen="true"><p>Body</p></accordion>'],
  ])('reads defaultOpen %s as open', (_label, html) => {
    const editor = createEditor(html);
    expect(firstNode(editor, 'mdxAccordion')?.attrs.defaultOpen).toBe(true);
    expect(getMarkdown(editor)).toContain('<Accordion title="FAQ" defaultOpen>');
  });
});

describe('paired atoms', () => {
  it('saves a paired File and Icon well-formed so the reader keeps the content after them', () => {
    const editor = createEditor(
      [
        'Intro paragraph.',
        '',
        '<File name="paired.ts"></File>',
        '',
        'Inline <Icon icon="star"></Icon> after-icon text.',
        '',
        'Following paragraph.',
      ].join('\n'),
    );
    // Edit another block so the page is re-serialized.
    editor.commands.insertContentAt(1, 'Edited. ');
    const saved = getMarkdown(editor);
    expect(saved).toContain('Edited. Intro paragraph.');
    expect(saved).not.toMatch(/<File name="paired\.ts">(?!<\/File>)/);
    expect(saved).not.toMatch(/<Icon icon="star">(?!<\/Icon>)/);
    const html = render(saved);
    expect(html).toContain('paired.ts');
    expect(html).toContain('after-icon text.');
    expect(html).toContain('Following paragraph.');
  });
});

describe('presence-only API field flags', () => {
  it.each([
    ['ParamField', '<paramfield name="id" type="string" required deprecated><p>The id.</p></paramfield>'],
    ['ResponseField', '<responsefield name="id" type="string" required deprecated><p>The id.</p></responsefield>'],
  ])('keeps bare required/deprecated on a pasted %s', (tag, html) => {
    const saved = getMarkdown(createEditor(html));
    expect(saved).toContain(`<${tag} name="id" type="string" required deprecated>`);
    const rendered = render(saved);
    const t = siteContentT('en');
    expect(rendered).toContain(t('required'));
    expect(rendered).toContain(t('deprecated'));
  });
});
