/** @vitest-environment jsdom */
/**
 * #553: a link to `page#section` lands on the heading whose anchor is
 * `section`. The editor must name its headings exactly as the reader gives
 * them ids (and as the search index records them, #534), or a link that works
 * on the published site would land nowhere in the editor.
 */
import { readerHeadings } from '@nibleaf/shared/reader-headings';
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { editorHeadingAnchors, sectionFragment } from './editor-sections';
import { buildEditorExtensions, seedMarkdown } from './tiptap-editor';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const editorAnchors = (markdown: string) => {
  const editor = new Editor({ extensions: buildEditorExtensions() });
  editors.push(editor);
  seedMarkdown(editor, markdown);
  return editorHeadingAnchors(editor.state.doc).map((heading) => heading.id);
};
const readerAnchors = (markdown: string) => readerHeadings(markdown).map((heading) => heading.id);

const ENGLISH = [
  '# Getting started',
  'Intro.',
  '## Install the CLI',
  'Text.',
  '## Setup',
  'First.',
  '### Setup',
  'Second, one level down: the count runs across levels.',
  '## Setup',
  'Third.',
  "## What's new in v2.0?",
  '## Use `nibleaf deploy` with **care**',
  '## [Linked heading](https://example.com)',
  '## Café & naïve façade',
  '## Getting started',
].join('\n\n');

const ARABIC = [
  '# البدء',
  'مقدمة.',
  '## تثبيت الأداة',
  'نص.',
  '## الإعداد',
  'أول.',
  '## الإعداد',
  'ثانٍ.',
  '### خطوات (اختيارية)',
  '## ما الجديد في الإصدار ٢؟',
  '## استخدم `nibleaf deploy` بحذر',
  '## البدء',
].join('\n\n');

describe('the editor names headings as the reader does (#553)', () => {
  it('gives the same anchors as the reader for English headings, duplicates included', () => {
    const anchors = editorAnchors(ENGLISH);
    expect(anchors).toEqual(readerAnchors(ENGLISH));
    expect(anchors).toEqual([
      'getting-started',
      'install-the-cli',
      'setup',
      'setup-1',
      'setup-2',
      'whats-new-in-v20',
      'use-nibleaf-deploy-with-care',
      'linked-heading',
      'café--naïve-façade',
      'getting-started-1',
    ]);
  });

  it('gives the same anchors as the reader for Arabic headings, duplicates included', () => {
    const anchors = editorAnchors(ARABIC);
    expect(anchors).toEqual(readerAnchors(ARABIC));
    expect(anchors).toContain('الإعداد');
    expect(anchors).toContain('الإعداد-1');
    expect(anchors.at(-1)).toBe('البدء-1');
  });

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
