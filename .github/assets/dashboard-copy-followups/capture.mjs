// Catalog copy specimens, not full dashboard or production captures.
// No server, account, key, or external request is used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { acquireDevstackLock, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';
import { writeEvidenceJson } from '../../../tests/integration/lib/evidence-json.mjs';

const root = resolve(import.meta.dirname, '../../..');
const baseline = 'da1a096ee1274d9e11c23cdd973799ab3596eeee';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const keys = [
  'settings_import_ghost_title',
  'settings_import_ghost_url',
  'oauth_project_noprojects',
  'settings_aiassistants_noaccess',
  'settings_smartai_scope',
  'settings_smartai_step_enable',
  'settings_smartai_modelsverified',
];
const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const lock = await acquireDevstackLock('dashboard copy follow-ups: isolated catalog specimens');
try {
  const captures = [];
  await withLocalOnlyBrowser({ allowedHosts: [] }, async ({ browser, attempted }) => {
    for (const locale of ['en', 'ar', 'zh-CN']) {
      const path = `packages/i18n/messages/${locale}.json`;
      const catalogs = {
        before: JSON.parse(git('show', `${baseline}:${path}`)),
        after: JSON.parse(await readFile(resolve(root, path), 'utf8')),
      };
      for (const phase of ['before', 'after'])
        for (const theme of ['light', 'dark'])
          for (const width of [1440, 390]) {
            const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
            try {
              const page = await context.newPage();
              const errors = [];
              page.on('pageerror', (error) => errors.push(error.message));
              await page.setContent(`<!doctype html><html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">
                <head><meta charset="utf-8"><style>
                *{box-sizing:border-box}body{margin:0;background:${theme === 'dark' ? '#151515' : '#fafafa'};
                color:${theme === 'dark' ? '#eeeeee' : '#202020'};font:16px/1.6 system-ui,sans-serif}
                main{max-width:800px;margin:auto;padding:24px}h1{font-size:20px}p{margin:0}
                section{border-block-end:1px solid #8886;padding-block:16px;overflow-wrap:anywhere}
                .note{font-size:13px;opacity:.75}</style></head><body><main>
                <h1>Catalog copy specimens · ${locale} · ${phase}</h1>
                <p class="note">Isolated text wrapping evidence. These are not dashboard screenshots.</p>
                ${keys.map((key) => `<section><p>${escapeHtml(catalogs[phase][key])}</p></section>`).join('')}
                </main></body></html>`);
              await page.evaluate(() => document.fonts.ready);
              const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
              assert.equal(overflow, false);
              assert.deepEqual(errors, []);
              const file = `${phase}-${locale}-${theme}-${width}.png`;
              await page.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, animations: 'disabled' });
              captures.push({ file, locale, phase, theme, width, overflow, errors });
            } finally {
              await context.close();
            }
          }
    }
    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: 'Isolated catalog copy specimens; system fonts; not the dashboard or production. Arabic is an unchanged RTL control.',
      baseline,
      sourceHead: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain'),
      keys,
      outsideAttempts: attempted.length,
      browser: 'Repository local-only Playwright wrapper; installed headless Chromium',
      captures,
    });
  });
  console.log(`${captures.length} copy specimens; no overflow, page errors, or outside requests`);
} finally {
  await lock.release();
}
