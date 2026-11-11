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

  describe('table cell alignment', () => {
    // The shared table rules sit in one block at one specificity, so among
    // those a cell matches, the last in source order wins.
    const tableRules = rules(source('content-blocks.css'));
    const winningTextAlign = (cell: Element): string[] => {
      let winner: string[] = [];
      for (const { selector, body } of tableRules) {
        let matches = false;
        try {
          matches = cell.matches(selector.replaceAll('&', ''));
        } catch {
          // Selectors jsdom cannot parse (:has) never target table cells.
        }
        const values = [...body.matchAll(/text-align:\s*([^;]+);/g)].map(([, value]) => value?.trim() ?? '');
        if (matches && values.length > 0) winner = values;
      }
      return winner;
    };
    const cellsOf = (html: string) => {
      const host = document.createElement('div');
      host.innerHTML = html;
      return [...host.querySelectorAll('th, td')];
    };

    it('lines a cell up with its column by the table’s direction, whatever its own dir (Chromium needs the prefixed keyword)', () => {
      const markdown = ['| الخطوة | البيئة | العدد |', '| --- | :---: | ---: |', '| إنشاء مفتاح | live | 3 |'].join('\n');
      const html = renderToStaticMarkup(<MarkdownRenderer content={markdown} site={{ projectId: 'docs', lang: 'ar' }} />);
      const host = document.createElement('div');
      host.innerHTML = html;
      expect(host.querySelector('table')?.getAttribute('dir')).toBe('rtl');
      const [heading, , , name, value, count] = cellsOf(html);
      // Unaligned cells carry their own dir; the shared default is followed by match-parent.
      for (const cell of [heading, name]) {
        expect(cell?.hasAttribute('dir')).toBe(true);
        expect(winningTextAlign(cell as Element)).toEqual(['match-parent', '-webkit-match-parent']);
      }
      // The reader writes an authored column alignment inline, which beats any rule.
      expect((value as HTMLElement).getAttribute('dir')).toBe('auto');
      expect((value as HTMLElement).style.textAlign).toBe('center');
      expect((count as HTMLElement).style.textAlign).toBe('right');
    });

    it('keeps an authored column alignment the editor writes as an align attribute', () => {
      const [left, center, right] = cellsOf(
        '<table><tbody><tr><td dir="ltr" align="left">a</td><td dir="ltr" align="center">b</td><td dir="rtl" align="right">ج</td></tr></tbody></table>',
      );
      expect(winningTextAlign(left as Element)).toEqual(['left']);
      expect(winningTextAlign(center as Element)).toEqual(['center']);
      expect(winningTextAlign(right as Element)).toEqual(['right']);
    });

    it('lets the editor’s cells and their paragraphs take that alignment instead of their own start', () => {
      const editor = rules(source('components/editor/tiptap.css'));
      const start = editor.filter(({ selector, body }) => selector.includes('[data-auto-direction]') && /text-align:\s*start/.test(body));
      expect(start.map(({ selector }) => selector)).toEqual(['.pl-editor .ProseMirror [data-auto-direction]:not(td, th)']);
      expect(editor.find(({ selector }) => selector === '.pl-editor .ProseMirror :is(td, th) > [data-auto-direction]')?.body).toMatch(
        /text-align: inherit;/,
      );
    });
  });

  describe('task checkboxes', () => {
    const css = source('content-blocks.css');
    const all = rules(css);
    const checkboxes = /li\.task-list-item > input\[type="checkbox"\][\s\S]*ul\[data-type="taskList"\] > li > label > input\[type="checkbox"\]/;
    /** The body of the first block that opens with `header`, braces matched. */
    const block = (header: string) => {
      const start = css.indexOf(header);
      let depth = 0;
      for (let index = css.indexOf('{', start); index < css.length; index += 1) {
        if (css[index] === '{') depth += 1;
        if (css[index] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, index);
      }
      return '';
    };

    it('never masks the input, so its focus ring shows: the tick is a separate box over it', () => {
      const masked = all.filter(({ body }) => /^\s*mask(?:-image)?:/m.test(body));
      expect(masked.length).toBeGreaterThan(0);
      for (const { selector } of masked) {
        for (const part of selector.split(/,(?![^(]*\))/)) expect(part.trim()).toMatch(/::(?:before|after)$/);
      }
      const tick = masked[0];
      expect(tick?.selector).toMatch(/li\.task-list-item\):has\(> input\[type="checkbox"\]:checked\)::before/);
      expect(tick?.selector).toMatch(/label\):has\(\s*> input\[type="checkbox"\]:checked\s*\)::after/);
      expect(tick?.body).toMatch(/background-color: var\(--primary-foreground\);/);
    });

    it('draws a visible keyboard focus ring on both surfaces’ checkboxes', () => {
      const focus = all.find(({ selector }) => selector.endsWith(':focus-visible') && checkboxes.test(selector));
      expect(focus?.body).toMatch(/outline: 2px solid var\(--ring, currentColor\);/);
      expect(focus?.body).toMatch(/outline-offset: 2px;/);
    });

    it('falls back to the native checkbox in forced colours and print, where the fill or the tick would not show', () => {
      const forced = block('@media (forced-colors: active), print');
      const inner = rules(forced);
      expect(inner.find(({ selector }) => checkboxes.test(selector) && !selector.includes('::'))?.body).toMatch(/appearance: auto;/);
      // Same selectors as the tick, so the same specificity, and later: it wins.
      const tick = all.find(({ body }) => /^\s*mask:/m.test(body));
      const hidden = inner.find(({ body }) => /content: none;/.test(body));
      expect(hidden?.selector.replace(/\s+/g, '')).toBe(tick?.selector.replace(/\s+/g, ''));
    });
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
