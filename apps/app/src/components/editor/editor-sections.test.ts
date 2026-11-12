/** @vitest-environment jsdom */
/**
 * #553: a link to `page#section` lands on the element the reader gives the id
 * `section`. The editor takes those ids from the reader's own heading pass over
 * the page's Markdown (`@nibleaf/shared/reader-headings`, what the search index
 * records, #534) and places each on the block it shows it in. Differential:
 * every case compares with `readerHeadings` on the same Markdown, never with
 * ids written here by hand alone.
 */
import { readerHeadings } from '@nibleaf/shared/reader-headings';
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { editorSectionAnchors, sectionFragment } from './editor-sections';
import { buildEditorExtensions, seedMarkdown } from './tiptap-editor';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** The editor's anchors for `markdown`: each reader id, and what it lands on (a heading's text, or the whole block's type). */
const landings = async (markdown: string) => {
  const editor = new Editor({ extensions: buildEditorExtensions() });
  editors.push(editor);
  seedMarkdown(editor, markdown);
  const anchors = await editorSectionAnchors(editor);
  return anchors.map(({ id, position, heading }) => {
    const node = editor.state.doc.nodeAt(position);
    return { id, on: heading ? `${node?.type.name}:${node?.textContent}` : `block:${node?.type.name}` };
  });
};
const readerIds = (markdown: string) => readerHeadings(markdown).map((heading) => heading.id);

const page = (...blocks: string[]) => blocks.join('\n\n');

describe('the editor lands on the reader’s anchors (#553)', () => {
  it('English headings, duplicates included', async () => {
    const markdown = page(
      '# Getting started',
      '## Setup',
      'Text.',
      '### Setup',
      '## Setup',
      "## What's new in v2.0?",
      '## Use `deploy` with **care**',
    );
    const placed = await landings(markdown);
    expect(placed.map((anchor) => anchor.id)).toEqual(readerIds(markdown));
    expect(placed).toEqual([
      { id: 'getting-started', on: 'heading:Getting started' },
      { id: 'setup', on: 'heading:Setup' },
      { id: 'setup-1', on: 'heading:Setup' },
      { id: 'setup-2', on: 'heading:Setup' },
      { id: 'whats-new-in-v20', on: "heading:What's new in v2.0?" },
      { id: 'use-deploy-with-care', on: 'heading:Use deploy with care' },
    ]);
  });

  it('Arabic headings, duplicates included', async () => {
    const markdown = page('# البدء', '## الإعداد', 'نص.', '## الإعداد', '## ما الجديد في الإصدار ٢؟', '## البدء');
    const placed = await landings(markdown);
    expect(placed.map((anchor) => anchor.id)).toEqual(readerIds(markdown));
    expect(placed.map((anchor) => anchor.id)).toEqual(['البدء', 'الإعداد', 'الإعداد-1', 'ما-الجديد-في-الإصدار-٢', 'البدء-1']);
  });

  it('an explicit id is the reader’s (prefixed), and does not count toward the duplicates', async () => {
    for (const [explicit, plain] of [
      ['<h2 id="custom-id">Hello</h2>', '## Hello'],
      ['<h2 id="مخصص">مرحبا</h2>', '## مرحبا'],
    ] as const) {
      const markdown = page(explicit, plain);
      const placed = await landings(markdown);
      expect(placed.map((anchor) => anchor.id)).toEqual(readerIds(markdown));
      expect(placed[0]?.id).toMatch(/^user-content-/);
      // The heading written after it is the first plain one: no "-1".
      expect(placed[1]?.id).toBe(plain === '## Hello' ? 'hello' : 'مرحبا');
    }
  });

  it('math in a heading', async () => {
    const markdown = page('## Energy $E = mc^2$', 'Text.', '## الطاقة $E = mc^2$', '## Next');
    const placed = await landings(markdown);
    expect(placed.map((anchor) => anchor.id)).toEqual(readerIds(markdown));
    expect(placed[0]?.on).toBe('heading:Energy $E = mc^2$');
    expect(placed[2]).toEqual({ id: 'next', on: 'heading:Next' });
  });

  it('an inline image in a heading', async () => {
    const markdown = page(
      '## Logo ![the logo](https://example.com/logo.png) setup',
      '## الشعار ![شعار](https://example.com/logo.png) هنا',
      '## Logo',
    );
    const placed = await landings(markdown);
    expect(placed.map((anchor) => anchor.id)).toEqual(readerIds(markdown));
    // The editor shows the image as its own block: the anchor lands on the heading before it.
    expect(placed[0]?.on).toBe('heading:Logo');
    expect(placed[1]?.on).toBe('heading:الشعار');
    expect(placed[2]).toEqual({ id: 'logo', on: 'heading:Logo' });
  });

  it('a heading inside a component the editor keeps whole lands on that block', async () => {
    const markdown = page('<Widget kind="a">\n\n## Inside\n\n</Widget>', '<Widget kind="b">\n\n## في الداخل\n\n</Widget>');
    const placed = await landings(markdown);
    expect(placed.map((anchor) => anchor.id)).toEqual(readerIds(markdown));
    expect(placed.map((anchor) => anchor.on)).toEqual(['block:mdxOpaqueBlock', 'block:mdxOpaqueBlock']);
  });

  it('duplicates after a component the editor keeps whole keep the reader’s suffixes', async () => {
    const markdown = page('<Widget>\n\n## Setup\n\n## الإعداد\n\n</Widget>', '## Setup', '## الإعداد', '## Setup');
    const placed = await landings(markdown);
    expect(placed.map((anchor) => anchor.id)).toEqual(readerIds(markdown));
    expect(placed.slice(2)).toEqual([
      { id: 'setup-1', on: 'heading:Setup' },
      { id: 'الإعداد-1', on: 'heading:الإعداد' },
      { id: 'setup-2', on: 'heading:Setup' },
    ]);
  });

  it('once the writer edits the page, anchors follow what it will be saved as', async () => {
    const editor = new Editor({ extensions: buildEditorExtensions() });
    editors.push(editor);
    seedMarkdown(editor, page('## Setup', 'Text.'));
    editor.commands.insertContentAt(editor.state.doc.content.size, '<h2>Setup</h2>');
    expect((await editorSectionAnchors(editor)).map((anchor) => anchor.id)).toEqual(['setup', 'setup-1']);
  });
});

describe('fragments (#553)', () => {
  it('reads a fragment as the browser does: without the #, decoded', () => {
    expect(sectionFragment('#install')).toBe('install');
    expect(sectionFragment('install')).toBe('install');
    expect(sectionFragment('%D8%A7%D9%84%D8%A5%D8%B9%D8%AF%D8%A7%D8%AF')).toBe('الإعداد');
    // A malformed escape is kept as written.
    expect(sectionFragment('100%')).toBe('100%');
    expect(sectionFragment('')).toBe('');
    expect(sectionFragment('#')).toBe('');
  });
});
