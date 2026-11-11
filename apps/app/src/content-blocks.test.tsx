/** @vitest-environment jsdom */
/**
 * Tables, code blocks and task lists look the same in the editor and on the
 * published page because both surfaces carry `.nibleaf-content` and one
 * stylesheet styles them (content-blocks.css, AUTH-26). These tests pin the
 * reader markup that stylesheet keys on and keep the editor's own unlayered
 * stylesheet from drawing a second look (the editor half is in
 * components/editor/tiptap-editor.test.tsx).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '@/components/markdown';

const FENCE = '```';
const CONTENT = [
  '| Step | Owner |',
  '| --- | --- |',
  '| Create a key | Admin |',
  '',
  `${FENCE}bash`,
  'npx tidewater verify',
  FENCE,
  '',
  '- [x] Booked',
  '- [ ] Rotated',
].join('\n');

const source = (file: string) => readFileSync(resolve(import.meta.dirname, file), 'utf8');

/** Each `selector { body }` of a stylesheet without nesting. */
const rules = (css: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = '', body = '']) => ({
    selector: selector.trim(),
    body,
  }));

describe('content blocks shared by the editor and the reader', () => {
  it('renders the reader article with the markup content-blocks.css styles', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<MarkdownRenderer content={CONTENT} site={{ projectId: 'docs', lang: 'en' }} />);
    expect(host.firstElementChild?.classList.contains('nibleaf-content')).toBe(true);
    expect(host.querySelector('.nibleaf-content .typeset-scroll > table > thead + tbody')).not.toBeNull();
    const panel = host.querySelector('.nibleaf-content [data-theme-component="code"]');
    expect(panel?.querySelector(':scope > .content-code-language ~ pre > code.hljs')?.textContent).toBe('npx tidewater verify\n');
    // Utilities would beat the shared panel, so the wrapper must not bring its own.
    expect(panel?.className).not.toMatch(/(?:^|\s)(?:bg-|border|rounded-|shadow-)/);
    expect(panel?.querySelector('pre')?.className).not.toMatch(/(?:^|\s)(?:p-|pt-|text-|leading-)/);
    expect(host.querySelectorAll('.nibleaf-content ul.contains-task-list > li.task-list-item > input[type="checkbox"]')).toHaveLength(2);
  });

  it('loads after typeset so it replaces typeset’s table, code and task-list defaults', () => {
    const styles = source('styles.css');
    expect(styles.indexOf('@import "./typeset.css";')).toBeGreaterThan(-1);
    expect(styles.indexOf('@import "./content-blocks.css";')).toBeGreaterThan(styles.indexOf('@import "./typeset.css";'));
  });

  it('cancels highlight.js’s own box inside the code panel (the double frame)', () => {
    const reset = rules(source('content-blocks.css')).find(
      (rule) => rule.selector === '.nibleaf-content [data-theme-component="code"] pre code.hljs',
    );
    expect(reset?.body).toMatch(/padding: 0;/);
    expect(reset?.body).toMatch(/background: transparent;/);
  });

  it('leaves the look of tables, code blocks and task checkboxes out of the editor’s unlayered stylesheet', () => {
    const blockSelector = /\b(?:pre|th|td|table)\b|\[data-type="taskList"\]/;
    const editorOnly = /selectedCell|:not\(pre\)|:not\(\[data-type="taskList"\]\)/;
    const look = /^\s*(?:background|border|color|padding|font-size|font-family|accent-color|box-shadow|list-style|width|height)\b/m;
    const offenders = rules(source('components/editor/tiptap.css'))
      .filter(({ selector }) => blockSelector.test(selector) && !editorOnly.test(selector))
      .filter(({ selector, body }) => look.test(body) && !/^\.pl-editor \.ProseMirror table$/.test(selector))
      .map(({ selector }) => selector);
    expect(offenders).toEqual([]);
  });
});
