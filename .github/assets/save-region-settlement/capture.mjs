// Isolated component fixture for #759: the real Site configuration → SEO
// section (an adopter of useServerDraftForm + SaveRegion) with the real design
// system, EN/AR catalogs, project query and config mutation, given a fictional
// site. It is built twice: "before" swaps in main's lib/forms/save-region.tsx,
// "after" is this branch. Every request is answered by interception on the
// fixture origin. Not the signed-in dashboard and not production. No server
// starts.
//
// A strip above the section (aria-hidden, labelled as fixture instrumentation)
// shows what the SaveRegion's polite live region holds, and the page records
// every value it took (including old values between commits). That is the DOM
// contract, not screen-reader speech.
//
// Run it while holding the repository's heavy-step lock; it takes no lock itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';
import { writeEvidenceJson } from '../../../tests/integration/lib/evidence-json.mjs';

const root = resolve(import.meta.dirname, '../../..');
const app = resolve(root, 'apps/app');
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git('merge-base', 'HEAD', 'origin/main');
const beforeProvider = git('show', `${baseline}:apps/app/src/lib/forms/save-region.tsx`);
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const origin = 'http://save-region.fixture.test';
const savedSeo = { metaTitle: 'Handbook Docs', metaDescription: 'Everything the Handbook team writes down.', socialImage: '' };
const titles = {
  en: { sent: 'Handbook Guides', extra: ' (beta)', clean: 'Handbook Library', theirs: 'Handbook Ops Docs' },
  ar: { sent: 'أدلة هاندبوك', extra: ' (تجريبي)', clean: 'مكتبة هاندبوك', theirs: 'وثائق عمليات هاندبوك' },
};

let harness;
try {
  harness = await mkdtemp(resolve(app, '.save-region-capture-'));
  await writeFile(resolve(harness, 'before-save-region.tsx'), beforeProvider);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-seo";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../src/components/ui";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SeoSettings } from '@/features/site-seo/components/seo-settings';
import { useProject } from '@/hooks/api';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('locale') === 'ar' ? 'ar' : 'en');
document.documentElement.classList.add('light');
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
// A background refetch (as a window refocus or another tab's write would cause), driven by the capture.
(window as unknown as { __refetch: () => Promise<void> }).__refetch = () => client.invalidateQueries();

// Every value the polite live region takes, old values between commits included.
const history: string[] = [];
(window as unknown as { __status: string[] }).__status = history;
const liveRegion = () => document.querySelector('[role="status"][aria-live="polite"]');
new MutationObserver((records) => {
  const region = liveRegion();
  if (!region) return;
  for (const record of records) {
    if (!region.contains(record.target)) continue;
    if (record.type === 'characterData' && record.oldValue !== null) history.push(record.oldValue);
    for (const node of record.removedNodes) history.push(node.textContent ?? '');
  }
  history.push(region.textContent ?? '');
}).observe(document.body, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });

/** Fixture instrumentation, not product UI: what the live region holds now. */
function Readout() {
  const [text, setText] = useState('');
  useEffect(() => {
    const observer = new MutationObserver(() => setText(liveRegion()?.textContent ?? ''));
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return (
    <div aria-hidden className="mb-4 rounded-md border border-dashed border-border px-3 py-2 font-mono text-muted-foreground text-xs" dir="ltr">
      fixture readout (not product UI) · role=status aria-live=polite: <span data-readout className="font-semibold text-foreground">{text ? '“' + text + '”' : '(empty)'}</span>
    </div>
  );
}

/** The editor's Configuration canvas: the site from the project query, then the section, keyed by site as the host does. */
function Canvas() {
  const { data: project } = useProject('site-1');
  return project ? <SeoSettings key={project.id} project={project} /> : null;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ConfirmProvider>
      <main className="mx-auto w-full max-w-4xl px-5 pt-7 pb-32 text-foreground sm:px-8"><Readout /><Canvas /></main>
    </ConfirmProvider>
    <Toaster theme="light" />
  </QueryClientProvider>,
);
`,
  );
  const { build } = await fromApp('vite');
  /** One build per phase: "before" resolves the provider to main's file; nothing else differs. */
  const buildPhase = async (phase) => {
    const outDir = resolve(harness, `dist-${phase}`);
    await build({
      configFile: false,
      root: harness,
      logLevel: 'error',
      resolve: {
        alias: [
          ...(phase === 'before' ? [{ find: /^@\/lib\/forms\/save-region$/, replacement: resolve(harness, 'before-save-region.tsx') }] : []),
          { find: /^@\//, replacement: `${resolve(app, 'src')}/` },
        ],
      },
      plugins: [
        // Without TanStack Start's plugin, the isomorphic API origin keeps its
        // server branch (and the server env); the browser only ever takes the client one.
        {
          name: 'client-api-origin',
          enforce: 'pre',
          resolveId: (source, importer) =>
            source === './api-origin' && importer?.replaceAll('\\', '/').endsWith('/src/services/api.ts') ? '\0client-api-origin' : undefined,
          load: (id) => (id === '\0client-api-origin' ? 'export const apiOrigin = () => window.location.origin;' : undefined),
        },
        (await fromApp('@vitejs/plugin-react')).default(),
        (await fromApp('@tailwindcss/vite')).default(),
      ],
      build: { outDir, target: 'esnext' },
    });
    return outDir;
  };
  const dists = { before: await buildPhase('before'), after: await buildPhase('after') };
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));

  /**
   * Opens the fixture over an in-page store. A PATCH is stored at once and
   * its response held for `server.saveDelay`; `server.otherWriter`, when set,
   * is someone else's meta title stored right after it, so a refetch while
   * the response is on its way reads their value. A PATCH merges `config.seo`
   * key by key, a stand-in for the API's merge.
   */
  async function open(context, { phase, locale }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = { seo: { ...savedSeo }, saveDelay: 0, otherWriter: null };
    const project = () => ({
      id: 'site-1',
      name: 'Handbook',
      description: 'Guides for the Handbook team.',
      slug: 'handbook',
      config: { theme: { preset: 'nib' }, seo: { ...server.seo } },
    });
    const languages = [
      { id: 'en', projectId: 'site-1', code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, position: 0, config: null },
    ];
    const json = (route, data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    const dist = dists[phase];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === 'GET /api/app/projects/site-1') {
        requests.push({ call, metaTitle: server.seo.metaTitle });
        return json(route, { data: project() });
      }
      if (call === 'GET /api/app/projects/site-1/languages') {
        requests.push({ call });
        return json(route, { data: languages });
      }
      if (call === 'PATCH /api/app/projects/site-1') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        server.seo = { ...server.seo, ...body.config.seo };
        const response = project();
        if (server.otherWriter) {
          server.seo = { ...server.seo, metaTitle: server.otherWriter };
          server.otherWriter = null;
        }
        // The response travels back slowly: a refetch meanwhile reads the store as it is now.
        await wait(server.saveDelay);
        return json(route, { data: response });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}`);
    await title(page, locale).waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const title = (page, locale) => page.getByRole('textbox', { name: catalogs[locale].settings_seo_metatitle_label, exact: true });
  const barButton = (page, label) => page.locator('[data-slot="save-region"]').getByRole('button', { name: label, exact: true });
  /** What a reviewer should see: the live region now and every value it took, the bar, the title, the conflict callout. */
  const state = async (page, locale) => ({
    dir: await page.evaluate(() => document.documentElement.dir),
    liveRegion: await page.evaluate(() => {
      const region = document.querySelector('[role="status"][aria-live="polite"]');
      return {
        text: region?.textContent ?? null,
        role: region?.getAttribute('role'),
        live: region?.getAttribute('aria-live'),
        count: document.querySelectorAll('[role="status"]').length,
      };
    }),
    statusHistory: await page.evaluate(() => [...new Set(window.__status)]),
    saveBar: await page
      .locator('[data-slot="save-region"]')
      .isVisible()
      .catch(() => false),
    title: await title(page, locale).inputValue(),
    conflict: (await page.getByRole('button', { name: catalogs[locale].forms_usetheirs, exact: true }).count()) > 0,
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  });
  /** Waits until the save bar is no longer saving. */
  const settle = async (page) => {
    await page.waitForFunction(() => !document.querySelector('[data-slot="save-region"] [aria-busy="true"]'), null, { timeout: 15_000 });
    await page.waitForTimeout(250);
  };
  /** Types a new title and saves with Enter; types `extra` while the save is in flight when given. */
  const saveTitle = async (page, locale, server, text, extra) => {
    await title(page, locale).fill(text);
    server.saveDelay = extra ? 1200 : 300;
    await title(page, locale).press('Enter');
    if (extra) {
      await page.waitForFunction(() => Boolean(document.querySelector('[data-slot="save-region"] [aria-busy="true"]')));
      await title(page, locale).press('End');
      await page.keyboard.type(extra, { delay: 40 });
    }
    await settle(page);
  };

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    // Per width, one sheet with an EN row and an AR row: an edit typed during the
    // save, on main and on this branch, then a clean save on this branch.
    const caption = {
      beforeUnsettled: 'before (main): edit typed during the save',
      afterUnsettled: 'after (this branch): edit typed during the save',
      afterClean: 'after (this branch): clean save',
    };
    const img = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
    for (const width of [1440, 390]) {
      const rows = [];
      for (const locale of ['en', 'ar']) {
        const shots = [];
        const seen = {};
        for (const [key, phase, extra] of [
          ['beforeUnsettled', 'before', true],
          ['afterUnsettled', 'after', true],
          ['afterClean', 'after', false],
        ]) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' });
          const { page, errors, requests, server } = await open(context, { phase, locale });
          const text = extra ? titles[locale].sent : titles[locale].clean;
          await saveTitle(page, locale, server, text, extra ? titles[locale].extra : undefined);
          await page.mouse.move(0, 0);
          seen[key] = { phase, ...(await state(page, locale)), requests, pageErrors: errors };
          assert.equal(seen[key].dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.equal(seen[key].overflow, false);
          assert.deepEqual(errors, []);
          // One status region (the toaster's notification list is the page's other, unrelated live region).
          assert.equal(seen[key].liveRegion.count, 1, 'one status region');
          assert.equal(requests.filter(({ call }) => call.startsWith('PATCH')).length, 1);
          shots.push({ key, buffer: await page.screenshot({ fullPage: true, animations: 'disabled' }) });
          await context.close();
        }
        const t = catalogs[locale];
        // main says "Saved" for a save that left an edit; this branch does not, and says it only once nothing is left.
        assert.equal(seen.beforeUnsettled.liveRegion.text, t.common_saved);
        assert.equal(seen.beforeUnsettled.saveBar, true);
        assert.equal(seen.afterUnsettled.liveRegion.text, t.forms_unsavedchanges);
        assert.equal(seen.afterUnsettled.saveBar, true);
        assert.equal(seen.afterUnsettled.title, titles[locale].sent + titles[locale].extra);
        assert.ok(!seen.afterUnsettled.statusHistory.includes(t.common_saved), 'no false "Saved" frame');
        assert.equal(seen.afterClean.liveRegion.text, t.common_saved);
        assert.equal(seen.afterClean.saveBar, false);
        assert.ok(!seen.afterClean.statusHistory.includes(t.forms_unsavedchanges));
        rows.push(
          `<div style="margin:12px 0 4px"><b>${locale.toUpperCase()}</b></div><div style="display:flex;gap:16px;align-items:flex-start">${shots
            .map(
              ({ key, buffer }) =>
                `<figure style="margin:0"><figcaption style="margin-bottom:4px">${caption[key]} · live region: <b>“${seen[key].liveRegion.text}”</b></figcaption><img src="${img(buffer)}" width="${width}"></figure>`,
            )
            .join('')}</div>`,
        );
        captures.push({ file: `settlement-${width}.png`, locale, width, theme: 'light', ...seen });
      }
      const sheet = await browser.newContext({ viewport: { width: width * 3 + 64, height: 600 }, deviceScaleFactor: 1 });
      const sheetPage = await sheet.newPage();
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Site configuration → SEO · ${width}px · light. The dashed strip is fixture instrumentation reading the SaveRegion's polite live region (DOM text, not screen-reader speech).</div>
${rows.join('')}</body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, `settlement-${width}.png`), fullPage: true });
      await sheet.close();
    }

    // This branch, EN 1440: edit during a save → "Unsaved changes"; Save again → "Saved"; a new edit takes "Saved" back
    // silently; someone else's change during a save → conflict and "Unsaved changes"; Use theirs → cleared, no "Saved".
    const locale = 'en';
    const width = 1440;
    const file = 'flow-en-1440.webm';
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 900 } },
    });
    const { page, errors, requests, server } = await open(context, { phase: 'after', locale });
    const t = catalogs[locale];
    const steps = [];
    const note = async (step) => {
      steps.push({ step, ...(await state(page, locale)) });
      await page.evaluate(() => {
        window.__status.length = 0;
      });
    };
    await page.waitForTimeout(600);
    await note('opened: the saved SEO, no save bar');

    await saveTitle(page, locale, server, titles.en.sent, titles.en.extra);
    await page.waitForTimeout(600);
    await note('Enter saved "Handbook Guides" while " (beta)" was typed: the request went through, the edit stays');

    await barButton(page, t.common_save).click();
    await settle(page);
    await page.waitForTimeout(600);
    await note('Save: the edit is saved, nothing left');

    await title(page, locale).press('End');
    await page.keyboard.type(' 2', { delay: 60 });
    await page.waitForTimeout(600);
    await note('typed again after "Saved": the earlier "Saved" is taken back without a new announcement');

    server.otherWriter = titles.en.theirs;
    server.saveDelay = 1500;
    await title(page, locale).fill(titles.en.sent);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => Boolean(document.querySelector('[data-slot="save-region"] [aria-busy="true"]')));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__refetch());
    await page.getByRole('button', { name: t.forms_usetheirs, exact: true }).waitFor();
    await settle(page);
    await page.waitForTimeout(600);
    await note('Ctrl+S while someone else renamed it: the save went through, their value is a conflict to resolve');

    await page.getByRole('button', { name: t.forms_usetheirs, exact: true }).click();
    await page.waitForTimeout(800);
    await note('Use their version: nothing left, "Unsaved changes" cleared, and no "Saved" invented');

    assert.deepEqual(errors, []);
    assert.equal(steps[0].saveBar, false);
    assert.equal(steps[1].liveRegion.text, t.forms_unsavedchanges);
    assert.equal(steps[1].saveBar, true);
    assert.ok(!steps[1].statusHistory.includes(t.common_saved));
    assert.equal(steps[2].liveRegion.text, t.common_saved);
    assert.equal(steps[2].saveBar, false);
    // Taken back silently: the region empties (its old "Saved" is the only other value seen) and stays empty while typing.
    assert.equal(steps[3].liveRegion.text, '');
    assert.deepEqual(
      steps[3].statusHistory.filter((value) => value !== t.common_saved),
      [''],
    );
    assert.equal(steps[4].conflict, true);
    assert.equal(steps[4].liveRegion.text, t.forms_unsavedchanges);
    assert.ok(!steps[4].statusHistory.includes(t.common_saved));
    assert.equal(steps[5].saveBar, false);
    assert.equal(steps[5].title, titles.en.theirs);
    assert.equal(steps[5].liveRegion.text, '');
    assert.ok(!steps[5].statusHistory.includes(t.common_saved));
    assert.equal(requests.filter(({ call }) => call.startsWith('PATCH')).length, 3);
    assert.ok(requests.some(({ call, metaTitle }) => call.startsWith('GET /api/app/projects/site-1') && metaTitle === titles.en.theirs));
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Component fixture: the real SEO section (useServerDraftForm + SaveRegion) with the real design system, EN/AR catalogs, project query and config mutation; before = main’s lib/forms/save-region.tsx, after = this branch; fictional site; project GET and config PATCH answered by interception; live region read from the DOM (not screen-reader speech); not the signed-in dashboard or production',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: ['apps/app/src/lib/forms/save-region.tsx'],
      attempted: attempted.length,
      captures,
      recordings,
    });
  });
  console.log(`${captures.length} captures on 2 sheets and ${recordings.length} recording; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
}
