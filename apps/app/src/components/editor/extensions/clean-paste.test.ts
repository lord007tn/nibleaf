// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import { cleanPastedHTML } from './clean-paste';

const editors: Editor[] = [];
function paste(html: string) {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  editor.view.pasteHTML(html, new Event('paste') as ClipboardEvent);
  return editor;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const google =
  '<b id="docs-internal-guid-123" style="font-weight:normal"><h2 dir="rtl"><span style="font-weight:700">دليل الاستخدام</span></h2><p dir="rtl" class="c1"><span style="font-style:italic">مرحبًا، </span><span style="text-decoration:underline">بالعالم؟</span>\u200f <span style="text-decoration:line-through">قديم</span> H<span style="vertical-align:sub">2</span> E<span style="vertical-align:super">2</span></p><ul><li><p>خطوة أولى</p></li></ul></b>';
const word =
  '<!--[if gte mso 9]><xml>Office metadata</xml><![endif]--><p class="MsoNormal"><b>Overview</b><o:p>&nbsp;</o:p></p><p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1. <span>&nbsp;</span></span>First</p><p style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">• </span><span style="font-style:italic">Nested bullet</span></p><p style="mso-list:l0 level3 lfo1"><span style="mso-list:Ignore">1. </span>Nested number</p><p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2. </span>Second</p><p style="mso-margin-top-alt:auto"><span style="font-weight:bold;text-decoration:underline">End</span></p>';
const notion =
  '<div class="notion-page" data-block-id="abc"><nav>Workspace navigation</nav><h1 id="title">Guide</h1><p style="line-height:30px">&nbsp;<br></p><ul class="notion-to-do-list"><li><input type="checkbox" checked><p>Ready</p></li><li><input type="checkbox"><p>Review</p></li></ul><blockquote><p>Keep this</p></blockquote><pre class="code"><code class="language-typescript highlight">const n = 1;</code></pre><table class="database"><tr><th>Name</th><th>Role</th></tr><tr><td>Ada</td><td>Writer</td></tr></table><p><a data-link="x" href="/help">Help</a></p><img src="https://example.com/a.png" alt="Diagram"><hr></div>';

describe('clipboard HTML cleanup', () => {
  it('converts Google Docs inline marks without changing Arabic or bidi text', () => {
    const html = cleanPastedHTML(google);
    expect(html).toBe(
      '<h2><strong>دليل الاستخدام</strong></h2><p><em>مرحبًا، </em><u>بالعالم؟</u>\u200f <s>قديم</s> H<sub>2</sub> E<sup>2</sup></p><ul><li><p>خطوة أولى</p></li></ul>',
    );
    const markdown = getMarkdown(paste(google));
    expect(markdown).toContain('## **دليل الاستخدام**');
    expect(markdown).toContain('<u>بالعالم؟</u>\u200f');
    expect(markdown).toContain('~~قديم~~');
    expect(markdown).toContain('H<sub>2</sub> E<sup>2</sup>');
    expect(markdown).toContain('- خطوة أولى');
  });
  it('rebuilds Word numbered and bulleted nested lists, removing markers and Office noise', () => {
    expect(cleanPastedHTML(word)).toBe(
      '<p><b>Overview</b></p><ol><li>First<ul><li><em>Nested bullet</em><ol><li>Nested number</li></ol></li></ul></li><li>Second</li></ol><p><u><strong>End</strong></u></p>',
    );
    const markdown = getMarkdown(paste(word));
    expect(markdown).toMatch(/1\. First\n\s+- \*Nested bullet\*\n\s+1\. Nested number\n2\. Second/);
    expect(markdown).toContain('**<u>End</u>**');
    expect(markdown).not.toMatch(/mso|Office metadata|•/);
  });
  it('keeps a Word list item’s leading letter when its hidden marker is absent', () => {
    expect(cleanPastedHTML('<p style="mso-list:l0 level1 lfo1">Open settings</p>')).toBe('<ul><li>Open settings</li></ul>');
  });
  it('keeps Notion semantic content, task checkboxes, language and media', () => {
    const html = cleanPastedHTML(notion);
    expect(html).not.toMatch(/notion|data-block|line-height|<nav|&nbsp;/);
    expect(html).toContain('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Ready</p>');
    expect(html).toContain('<code class="language-typescript">');
    const markdown = getMarkdown(paste(notion));
    for (const text of [
      '# Guide',
      '- [x] Ready',
      '- [ ] Review',
      '> Keep this',
      '```typescript',
      '| Ada | Writer |',
      '[Help](/help)',
      '![Diagram](https://example.com/a.png)',
    ])
      expect(markdown).toContain(text);
  });
  it('unwraps unknown web markup and removes active links and page chrome', () => {
    const html =
      '<main><h3 class="title">Web</h3><custom-box>Unknown <span>text</span></custom-box><p><a href="javascript:alert(1)">Bad</a> <a href="data:text/html,x">Data</a> <a href="mailto:a@example.com">Email</a> <a href="tel:123">Call</a> <a href="../next">Next</a></p><script>evil()</script><style>body{}</style><form>Form</form><button>Menu</button></main>';
    expect(cleanPastedHTML(html)).toBe(
      '<h3>Web</h3>Unknown text<p><a>Bad</a> <a>Data</a> <a href="mailto:a@example.com">Email</a> <a href="tel:123">Call</a> <a href="../next">Next</a></p>',
    );
    const markdown = getMarkdown(paste(html));
    expect(markdown).toContain('Unknown text');
    expect(markdown).not.toContain('javascript:');
    expect(markdown).toContain('[Email](mailto:a@example.com)');
  });
  it('keeps alignment when cleaning a web table', () => {
    const editor = paste('<table><tr><th style="color:red;text-align:center">Name</th></tr><tr><td style="text-align:center">Ada</td></tr></table>');
    expect(getMarkdown(editor)).toContain('| :---: |');
  });
  it('keeps exported Notion checkbox state and relative image sources', () => {
    const editor = paste(
      '<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div><div>Done</div></li><li><div class="checkbox checkbox-off"></div><div>Next</div></li></ul><img src="images/diagram.png" alt="Diagram">',
    );
    expect(getMarkdown(editor)).toContain('- [x] Done');
    expect(getMarkdown(editor)).toContain('- [ ] Next');
    expect(getMarkdown(editor)).toContain('![Diagram](images/diagram.png)');
  });
  it('links selected text when pasting a URL and inserts a lone image URL on a blank line', () => {
    const editor = paste('<p>Read these docs</p>');
    editor.commands.setTextSelection({ from: 6, to: 16 });
    const pasteText = (text: string) =>
      editor.view.pasteText(
        text,
        Object.assign(new Event('paste'), {
          clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
        }) as unknown as ClipboardEvent,
      );
    pasteText('https://example.com/docs');
    expect(getMarkdown(editor)).toBe('Read [these docs](https://example.com/docs)');
    editor.commands.clearContent();
    pasteText('https://example.com/photo.png?width=600');
    expect(getMarkdown(editor)).toBe('![](https://example.com/photo.png?width=600)');
    expect(editor.state.selection.toJSON().type).toBe('node');
  });
  it('links a selection across paragraphs, while code blocks keep literal paste behavior', () => {
    const editor = paste('<p>One</p><p>Two</p>');
    const pasteText = (text: string) =>
      editor.view.pasteText(
        text,
        Object.assign(new Event('paste'), {
          clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
        }) as unknown as ClipboardEvent,
      );
    editor.commands.setTextSelection({ from: 1, to: 9 });
    pasteText('/help');
    expect(getMarkdown(editor)).toBe('[One](/help)\n\n[Two](/help)');
    editor.commands.setContent('```text\nReplace\n```', { emitUpdate: false });
    editor.commands.setTextSelection({ from: 1, to: 8 });
    pasteText('https://example.com');
    expect(getMarkdown(editor)).toBe('```text\nhttps://example.com\n```');
  });
});
