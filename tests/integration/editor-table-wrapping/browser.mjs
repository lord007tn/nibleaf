// Real-browser check that editor tables wrap their cells like the published
// reader's (#570): a narrow column never breaks inside a word, and the editor
// gives each column the width the reader gives it.
//
// The page loads the real content stylesheets (typeset.css, content-blocks.css
// and the editor's tiptap.css) as they are on disk, around the markup each
// surface renders for the same table: the reader's scroll region and the
// editor's table view. Chromium lays both out at a desktop measure and a phone
// width, in English and Arabic. No dev stack or build is needed:
//   node tests/integration/editor-table-wrapping/browser.mjs [screenshotDir]
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const appSrc = fileURLToPath(new URL('../../../apps/app/src/', import.meta.url));
const css = ['typeset.css', 'content-blocks.css', 'components/editor/tiptap.css'].map((file) => readFileSync(join(appSrc, file), 'utf8')).join('\n');
const screenshotDir = process.argv[2];
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });

const TABLES = {
  en: {
    head: ['Owner', 'What they do', 'Escalation'],
    rows: [
      ['Admin', 'Creates the workspace, invites the team and rotates the signing keys every quarter.', 'Support writer'],
      ['Editor', 'Drafts and reviews every guide before it is published to the documentation site.', 'Release manager'],
    ],
  },
  ar: {
    head: ['المالك', 'ما الذي يفعله', 'التصعيد'],
    rows: [
      ['المسؤول', 'ينشئ مساحة العمل ويدعو الفريق ويغيّر مفاتيح التوقيع كل ربع سنة دون انقطاع للخدمة.', 'كاتب الدعم'],
      ['المحرر', 'يكتب كل دليل ويراجعه قبل نشره على موقع التوثيق الخاص بالمشروع والفريق.', 'مدير الإصدار'],
    ],
  },
};

// Many columns of long words: narrower than its longest words allow at 390px, so it scrolls.
const WIDE = {
  en: {
    head: ['Environment', 'Configuration', 'Authentication', 'Replication', 'Observability', 'Availability'],
    rows: [['Production', 'Declarative', 'Federated', 'Synchronous', 'Distributed', 'Guaranteed']],
  },
  ar: {
    head: ['البيئة', 'الإعدادات', 'المصادقة', 'النسخ المتماثل', 'المراقبة', 'التوافرية'],
    rows: [['الإنتاجية', 'التصريحية', 'الاتحادية', 'المتزامنة', 'الموزّعة', 'المضمونة']],
  },
};

const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
/** The reader's markup (components/markdown.tsx, scroll-region.tsx). */
const readerTable = ({ head, rows }) =>
  `<div class="typeset-scroll"><table><thead><tr>${head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
/** The editor's markup (prosemirror-tables' table view: header cells are th, every cell holds a paragraph). */
const editorTable = ({ head, rows }) =>
  `<div class="tableWrapper"><table style="min-width: 75px"><colgroup>${head.map(() => '<col style="min-width: 25px">').join('')}</colgroup><tbody><tr>${head
    .map((cell) => `<th colspan="1" rowspan="1"><p>${escapeHtml(cell)}</p></th>`)
    .join(
      '',
    )}</tr>${rows.map((row) => `<tr>${row.map((cell) => `<td colspan="1" rowspan="1"><p>${escapeHtml(cell)}</p></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

const page = (lang, table) => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<style>${css}
:root { --border: #d4d4d8; --muted: #f4f4f5; --foreground: #18181b; }
body { margin: 0; font-family: Arial, sans-serif; }
/* One type size and face on both surfaces, so only wrapping is compared: by
   design the reader sets phones' text 1.125x larger and the editor uses its own
   Arabic face, which would move columns for reasons other than wrapping. */
.typeset, .pl-editor .ProseMirror { font-size: 16px !important; font-family: Arial, sans-serif !important; }
.surface { box-sizing: border-box; padding: 16px; }
.surface::before { content: attr(data-label); display: block; max-width: 720px; margin: 0 auto 8px; font: 12px Arial, sans-serif; color: #71717a; }
/* The same measure on both surfaces: the reader's article column, and the editor page (tiptap-editor.tsx:
   .pl-editor-document > .pl-document-scroll > .pl-document-page > EditorContent > .ProseMirror) at that width. */
.reader-column, .editor-column { max-width: 720px; margin: 0 auto; }
.editor-column .pl-document-page { padding: 0; }
</style></head><body>
<section class="surface" id="reader" data-label="Reader (published page)"><article class="reader-column"><div class="typeset nibleaf-content">${readerTable(table)}</div></article></section>
<section class="surface" id="editor" data-label="Editor"><div class="pl-editor pl-editor-document editor-column"><div class="pl-document-scroll"><div class="pl-document-page"><div><div class="ProseMirror nibleaf-content" contenteditable="true">${editorTable(table)}</div></div></div></div></div></section>
</body></html>`;

/** In the page: every word of every cell, with the number of line boxes it spans; and each column's width. */
const measure = (surface) => {
  const root = document.querySelector(`#${surface}`);
  const table = root.querySelector('table');
  const brokenWords = [];
  for (const cell of table.querySelectorAll('th, td')) {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of node.data.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const lines = new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top)));
        if (lines.size > 1) brokenWords.push(match[0]);
      }
    }
  }
  const firstRow = table.querySelector('tr');
  const wrapper = table.parentElement;
  return {
    brokenWords,
    columns: [...firstRow.children].map((cell) => Math.round(cell.getBoundingClientRect().width)),
    scrolls: wrapper.scrollWidth > wrapper.clientWidth + 1,
    overflowsPage: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
};

const failures = [];
await withLocalOnlyBrowser({}, async ({ browser, attempted }) => {
  for (const lang of ['en', 'ar']) {
    for (const [kind, table, width] of [
      ['narrow column', TABLES[lang], 1440],
      ['narrow column', TABLES[lang], 390],
      ['wide', WIDE[lang], 390],
    ]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const tab = await context.newPage();
      await tab.setContent(page(lang, table));
      const reader = await tab.evaluate(measure, 'reader');
      const editor = await tab.evaluate(measure, 'editor');
      const label = `${lang} ${kind} ${width}px`;
      console.log(label, JSON.stringify({ reader, editor }));
      if (screenshotDir)
        await tab.screenshot({ path: join(screenshotDir, `table-wrapping-${kind.replace(' ', '-')}-${lang}-${width}.png`), fullPage: true });
      const check = (what, fn) => {
        try {
          fn();
        } catch (error) {
          failures.push(`${label}: ${what}: ${error.message}`);
        }
      };
      check('reader keeps words whole', () => assert.deepEqual(reader.brokenWords, []));
      check('editor keeps words whole', () => assert.deepEqual(editor.brokenWords, []));
      check('editor columns match the reader', () => {
        assert.equal(editor.columns.length, reader.columns.length);
        for (const [index, column] of editor.columns.entries()) {
          assert.ok(Math.abs(column - reader.columns[index]) <= 2, `column ${index + 1}: editor ${column}px, reader ${reader.columns[index]}px`);
        }
      });
      check('a wide table scrolls in its wrapper, not the page', () => {
        assert.equal(editor.overflowsPage, false);
        assert.equal(editor.scrolls, reader.scrolls);
        if (kind === 'wide') assert.equal(editor.scrolls, true, 'the wide table should scroll at a phone width');
      });
      await context.close();
    }
  }
  console.log(`attempted outside the local stack: ${attempted.length}`);
});

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('editor tables wrap like the reader');
