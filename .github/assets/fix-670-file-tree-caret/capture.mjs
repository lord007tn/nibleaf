// Canvas fixture using production editor extensions, node views, Fix bar and
// design-system styles. Router/page lookup hooks are mocked; no database.
// Run under the editor/670 heavy lock: PR=670 PHASE=before|after.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { freemem, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.CAPTURE_ROOT ?? process.cwd();
const { acquireDevstackLock, withLocalOnlyBrowser } = await import(pathToFileURL(resolve(root, 'tests/integration/lib/capture-env.mjs')));
const app = resolve(root, 'apps/app');
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd();
const { PR, PHASE } = process.env;
assert.ok(['668', '670'].includes(PR));
assert.ok(['before', 'after'].includes(PHASE));
assert.match(await readFile(join(tmpdir(), 'nibleaf-heavy.lock'), 'utf8'), /^editor\/670 /);
assert.ok(freemem() >= 5 * 1024 ** 3, '5 GiB free RAM');
const baseline = process.env.BASE ?? git('rev-parse', 'origin/main');
const out = resolve(root, '.github/assets', PR === '668' ? 'fix-668-fix-bar-390' : 'fix-670-file-tree-caret');
const origin = 'http://editor-canvas.fixture.test';
const results = [];
let workspaceOutputs = [];
const devstack = await acquireDevstackLock('editor/670');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.editor-capture-'));
  const source = PHASE === 'before' ? resolve(harness, 'editor') : resolve(app, 'src/components/editor');
  if (PHASE === 'before') {
    for (const file of git('ls-tree', '-r', '--name-only', baseline, 'apps/app/src/components/editor').split('\n')) {
      if (/\.test\.|__fixtures__/.test(file)) continue;
      const target = resolve(source, file.replace('apps/app/src/components/editor/', ''));
      await mkdir(resolve(target, '..'), { recursive: true });
      await writeFile(target, `${git('show', `${baseline}:${file}`)}\n`);
    }
  }
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/components/editor";\n@source "../../../packages/design-system/src";\nbody {margin:0;}\n',
  );
  await writeFile(resolve(harness, 'api.ts'), 'export const useLanguages=()=>({data:[{id:"en",code:"en"}]}); export const usePages=()=>({data:[]});');
  await writeFile(resolve(harness, 'router.ts'), 'export const useParams=()=>({projectId:"fixture"});');
  const path = (file) => `${source.replaceAll('\\', '/')}/${file}`;
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import {createRoot} from 'react-dom/client';
import {useRef} from 'react';
import {Editor} from '@tiptap/core';
import {EditorContent} from '@tiptap/react';
import {DirectionProvider,useDirection} from '@nibleaf/design-system/components/ui/direction';
import {setLanguage} from '@nibleaf/i18n/locale-state';
import {translateFn} from '@nibleaf/i18n';
import {buildEditorExtensions,getMarkdown,seedMarkdown} from '${path('tiptap-editor')}';
import {PublishFixBar} from '${path('publish-fix-bar')}';
const params=new URLSearchParams(location.search),locale=params.get('locale')==='ar'?'ar':'en',scenario=params.get('scenario');
const direction=locale==='ar'?'rtl':'ltr';
await setLanguage(locale);
document.documentElement.classList.add(params.get('theme')==='dark'?'dark':'light');
const long=Array.from({length:24},(_,i)=>'Paragraph '+(i+1)+' of the upgrade guide, long enough to push what follows well down the page.').join('\\n\\n');
const content=scenario==='tree'?'':scenario==='landing'?long+'\\n\\nThen read [the settings](/configuration) and continue.\\n\\n'+long:long+'\\n\\n<LegacyNotice>\\n\\nRead [the old guide](/configuration) before you upgrade.\\n\\n</LegacyNotice>\\n\\nThe rest of the page.\\n\\n'+long;
const editor=new Editor({extensions:buildEditorExtensions({dir:locale==='ar'?'rtl':'ltr'})});
seedMarkdown(editor,content);
window.fixtureEditor=editor;window.fixtureTitle=translateFn('editor.slash.fileTree.title',undefined,locale);window.fixtureMarkdown=()=>getMarkdown(editor);
window.fixtureDirections=()=>{const root=document.querySelector('[data-fixture-root]'),menu=document.querySelector('[cmdk-root]');return {html:getComputedStyle(document.documentElement).direction,root:root?getComputedStyle(root).direction:null,provider:root?.getAttribute('data-provider-direction'),editor:getComputedStyle(editor.view.dom).direction,menu:menu?getComputedStyle(menu).direction:null};};
function Fixture(){const canvas=useRef(null),providerDirection=useDirection();return <div className="h-dvh flex flex-col bg-background text-foreground" dir={direction} lang={locale} data-fixture-root="" data-provider-direction={providerDirection}>
<header className="flex h-14 shrink-0 items-center border-b border-border px-4 font-medium">{locale==='ar'?'محرر المستندات':'Documentation editor'}</header>
{scenario==='tree'?null:<PublishFixBar arrival={{code:'broken-internal-link',target:'/configuration',pageId:'fixture'}} group={false} canvas={()=>canvas.current} markdown={()=>getMarkdown(editor)} onEditSource={()=>{}} onFocusTitle={()=>{}} onOpenSettings={()=>{}} onHandled={()=>{}} onBackToPublish={()=>{}} onDismiss={()=>{}}/>}
<div ref={canvas} className="pl-editor pl-editor-document flex-1" dir={direction} lang={locale}><div className="pl-document-scroll"><div className="pl-document-page"><h1 className="pl-document-title text-3xl font-semibold">{scenario==='tree'?(locale==='ar'?'بنية المشروع':'Project structure'):(locale==='ar'?'دليل الترقية':'Upgrade guide')}</h1><EditorContent editor={editor}/></div></div></div></div>}
createRoot(document.getElementById('root')).render(<DirectionProvider direction={direction}><Fixture/></DirectionProvider>);
`,
  );
  const explanations = Object.fromEntries(
    ['en', 'ar'].map((locale) => [
      locale,
      JSON.parse(PHASE === 'before' ? git('show', `${baseline}:packages/i18n/messages/${locale}.json`) : '{}').editor_fix_insideblock ?? '',
    ]),
  );
  await writeFile(
    resolve(harness, 'i18n-react.ts'),
    `import {useLocale as realUseLocale} from '${resolve(root, 'packages/i18n/src/react.ts').replaceAll('\\', '/')}';
const explanations=${JSON.stringify(explanations)};
export const useLocale=()=>{const value=realUseLocale();return {...value,t:(key,vars)=>${PHASE === 'before'}&&key==='editor.fix.insideBlock'?explanations[value.locale]:value.t(key,vars)}};
export const useT=()=>useLocale().t;
export {translateFn} from '@nibleaf/i18n';
`,
  );
  const { build } = await fromApp('vite');
  await build({
    configFile: false,
    root: harness,
    logLevel: 'error',
    resolve: {
      alias: [
        { find: '@nibleaf/i18n/react', replacement: resolve(harness, 'i18n-react.ts') },
        { find: '@/hooks/api', replacement: resolve(harness, 'api.ts') },
        { find: '@tanstack/react-router', replacement: resolve(harness, 'router.ts') },
        { find: /^@\//, replacement: `${resolve(app, 'src').replaceAll('\\', '/')}/` },
      ],
    },
    plugins: [
      {
        name: 'capture-provenance',
        generateBundle() {
          const modules = [...this.getModuleIds()].map((id) => id.replaceAll('\\', '/'));
          assert.ok(!modules.some((id) => id.includes('t3-89fd4b9f-50aa0b3ec1e75565')), 'no imports from the previous worktree');
          workspaceOutputs = modules.filter((id) => /\/(?:apps\/server|packages\/(?:search|database|clickhouse|usage))\/dist\//.test(id));
          assert.ok(
            workspaceOutputs.every((id) => id.startsWith(root.replaceAll('\\', '/'))),
            'workspace outputs belong to this worktree',
          );
        },
      },
      {
        name: 'baseline-editor-neighbors',
        resolveId(specifier, importer) {
          const copied = source.replaceAll('\\', '/');
          const importing = importer?.replaceAll('\\', '/');
          if (PHASE !== 'before' || !importing?.startsWith(copied) || !specifier.startsWith('.')) return;
          if (resolve(dirname(importing), specifier).replaceAll('\\', '/').startsWith(copied)) return;
          return this.resolve(specifier, importing.replace(copied, resolve(app, 'src/components/editor').replaceAll('\\', '/')), { skipSelf: true });
        },
      },
      (await fromApp('@vitejs/plugin-react')).default(),
      (await fromApp('@tailwindcss/vite')).default(),
    ],
    build: { outDir: resolve(harness, 'dist'), target: 'esnext', chunkSizeWarningLimit: 5000 },
  });
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
  await withLocalOnlyBrowser({ allowedHosts: ['editor-canvas.fixture.test:80'], launch: { headless: true } }, async ({ browser }) => {
    const cases =
      PR === '668'
        ? [
            ...[390, 1440].flatMap((width) => ['light', 'dark'].map((theme) => ({ width, theme, locale: 'en', scenario: 'opaque' }))),
            { width: 390, theme: 'light', locale: 'ar', scenario: 'opaque' },
            ...[390, 1440].map((width) => ({ width, theme: 'light', locale: 'en', scenario: 'landing' })),
          ]
        : [
            { width: 1440, theme: 'light', locale: 'en', scenario: 'tree' },
            { width: 390, theme: 'light', locale: 'ar', scenario: 'tree' },
          ];
    for (const item of cases) {
      const { width, theme, locale, scenario } = item,
        height = width === 390 ? 844 : 900;
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
        locale,
        colorScheme: theme,
        reducedMotion: 'reduce',
        ...(PR === '670' ? { recordVideo: { dir: resolve(out, '.video'), size: { width, height } } } : {}),
      });
      await context.route(`${origin}/**`, async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        const file = resolve(harness, 'dist', pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
        await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => console.error(error.message));
      await page.goto(`${origin}/?${new URLSearchParams({ theme, locale, scenario })}`);
      await page.locator('.ProseMirror').waitFor({ timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
      const name = `${PHASE}-${locale}-${width}-${theme}`;
      if (PR === '670') {
        await page.locator('.ProseMirror').click();
        const title = await page.evaluate(() => window.fixtureTitle);
        await page.keyboard.type(`/${title}`, { delay: 80 });
        const option = page
          .locator('[cmdk-item]')
          .filter({ has: page.locator('.font-medium', { hasText: title }) })
          .first();
        await option.waitFor();
        const menuShot = `menu-${name}.png`;
        const directions = await page.evaluate(() => window.fixtureDirections());
        for (const key of ['html', 'root', 'provider', 'editor', 'menu']) assert.equal(directions[key], locale === 'ar' ? 'rtl' : 'ltr', key);
        await page.screenshot({ path: resolve(out, menuShot) });
        results.push({ ...item, phase: PHASE, shot: menuShot, directions });
        await page.waitForTimeout(500);
        await option.click();
        await page.waitForTimeout(500);
        await page.keyboard.type(locale === 'ar' ? 'دليل.md' : 'index.ts', { delay: 140 });
      } else await page.waitForFunction(() => document.querySelector('[data-testid="publish-fix-status"]')?.textContent?.trim());
      await page.waitForTimeout(800);
      const state = await page.evaluate(() => {
        const bar = document.querySelector('[data-publish-fix]'),
          block = document.querySelector('.pl-mdx-opaque-block'),
          source = block && [...block.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        let sourceTop = null;
        if (source) {
          const range = document.createRange(),
            start = source.textContent.search(/\S/);
          range.setStart(source, start);
          range.setEnd(source, start + 1);
          sourceTop = range.getBoundingClientRect().top;
        }
        const label = block && getComputedStyle(block, '::before'),
          style = block && getComputedStyle(block),
          labelTop = block
            ? label.position === 'absolute'
              ? block.getBoundingClientRect().top + Number.parseFloat(label.top)
              : block.getBoundingClientRect().top + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop)
            : null;
        const link = document.querySelector('.pl-fix-current'),
          scroller = document.querySelector('.pl-document-scroll'),
          anchor = window.getSelection()?.anchorNode,
          element = anchor instanceof Element ? anchor : anchor?.parentElement;
        const at = window.fixtureEditor.view.domAtPos(window.fixtureEditor.state.selection.from).node;
        const revealed = at instanceof Element ? at : at?.parentElement;
        return {
          directions: window.fixtureDirections(),
          barHeight: bar?.getBoundingClientRect().height ?? null,
          sourceTop,
          labelBottom: labelTop === null ? null : labelTop + Number.parseFloat(label.height),
          labelPosition: label?.position ?? null,
          landingGap: link && scroller ? link.getBoundingClientRect().top - scroller.getBoundingClientRect().top : null,
          revealedGap: revealed && scroller ? revealed.getBoundingClientRect().top - scroller.getBoundingClientRect().top : null,
          revealedTag: revealed?.tagName,
          caretInFileName: Boolean(element?.closest('.pl-file-name')),
          document: window.fixtureEditor.getJSON(),
          markdown: window.fixtureMarkdown(),
          overflowX: document.documentElement.scrollWidth > innerWidth,
        };
      });
      for (const key of ['html', 'root', 'provider', 'editor']) assert.equal(state.directions[key], locale === 'ar' ? 'rtl' : 'ltr', key);
      if (PHASE === 'after') {
        assert.equal(state.overflowX, false);
        if (PR === '670') assert.equal(state.caretInFileName, true);
        if (scenario === 'opaque') {
          assert.ok(state.barHeight <= 120);
          assert.ok(state.sourceTop > state.labelBottom);
        }
        if (scenario === 'landing') assert.ok(Math.abs(state.revealedGap - 16) <= 1, JSON.stringify(state));
      }
      const shot = `${PR === '670' ? 'typed' : scenario}-${name}.png`;
      await page.screenshot({ path: resolve(out, shot) });
      results.push({ ...item, phase: PHASE, shot, ...state });
      const recording = page.video();
      await context.close();
      if (recording) await rename(await recording.path(), resolve(out, `flow-${name}.webm`));
    }
  });
  await writeFile(
    resolve(out, `measurements-${PHASE}.json`),
    `${JSON.stringify({ baseline, head: git('rev-parse', 'HEAD'), fixture: 'production canvas; mocked router and page lookup hooks', workspaceOutputs, results }, null, 2)}\n`,
  );
  console.log(results.map(({ shot, barHeight, landingGap, caretInFileName }) => ({ shot, barHeight, landingGap, caretInFileName })));
} finally {
  try {
    if (harness) await rm(harness, { recursive: true, force: true });
  } finally {
    await devstack.release();
  }
}
