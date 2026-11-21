// Canvas fixture using the production editor extensions, node views and
// design-system styles. Router/page lookup hooks are mocked; no server, no
// database. The cut and paste are real ClipboardEvents dispatched in the page
// with their own DataTransfer, so the machine's clipboard is never touched.
// Run under the shared dev-stack lock: PHASE=before|after [BASE=<sha>].
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { freemem } from 'node:os';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.CAPTURE_ROOT ?? process.cwd();
const { acquireDevstackLock, withLocalOnlyBrowser } = await import(pathToFileURL(resolve(root, 'tests/integration/lib/capture-env.mjs')));
const app = resolve(root, 'apps/app');
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd();
const { PHASE } = process.env;
assert.ok(['before', 'after'].includes(PHASE));
assert.ok(process.env.NIBLEAF_DEVSTACK_LOCK, 'Set NIBLEAF_DEVSTACK_LOCK to the shared dev-stack lock');
assert.ok(freemem() >= 5 * 1024 ** 3, '5 GiB free RAM');
const baseline = process.env.BASE ?? git('merge-base', 'HEAD', 'origin/main');
const out = resolve(root, '.github/assets/fix-870-file-tree-cut-paste');
const origin = 'http://editor-canvas.fixture.test';
const SOURCE = '<FileTree>\n\n<File name="index.ts" />\n\n<File name="util.ts" />\n\n</FileTree>';
const results = [];
const devstack = await acquireDevstackLock('editor/870');
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
import {useEffect,useState} from 'react';
import {Editor} from '@tiptap/core';
import {NodeSelection} from '@tiptap/pm/state';
import {EditorContent} from '@tiptap/react';
import {DirectionProvider} from '@nibleaf/design-system/components/ui/direction';
import {setLanguage} from '@nibleaf/i18n/locale-state';
import {buildEditorExtensions,getMarkdown,seedMarkdown} from '${path('tiptap-editor')}';
const params=new URLSearchParams(location.search),locale=params.get('locale')==='ar'?'ar':'en';
const direction=locale==='ar'?'rtl':'ltr';
await setLanguage(locale);
document.documentElement.classList.add('light');
const editor=new Editor({extensions:buildEditorExtensions({dir:direction})});
seedMarkdown(editor,${JSON.stringify(SOURCE)});
const clipboard=new DataTransfer();
const send=(type)=>editor.view.dom.dispatchEvent(new ClipboardEvent(type,{clipboardData:clipboard,bubbles:true,cancelable:true}));
window.fixture={
  markdown:()=>getMarkdown(editor),
  names:()=>{const names=[];editor.state.doc.descendants((node)=>{if(node.type.name==='mdxFile')names.push(node.textContent);});return names;},
  selectFirstFile:()=>{let at=-1;editor.state.doc.descendants((node,pos)=>{if(at<0&&node.type.name==='mdxFile')at=pos;});editor.view.focus();editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc,at)));},
  cut:()=>send('cut'),
  paste:()=>send('paste'),
  direction:()=>getComputedStyle(editor.view.dom).direction,
};
function Saved(){const [text,setText]=useState(getMarkdown(editor));useEffect(()=>{const update=()=>setText(getMarkdown(editor));editor.on('update',update);return()=>{editor.off('update',update);};},[]);return <pre dir="ltr" data-saved="" className="m-4 rounded-md border border-border bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{text}</pre>;}
function Fixture(){return <div className="min-h-dvh flex flex-col bg-background text-foreground" dir={direction} lang={locale}>
<header className="flex h-14 shrink-0 items-center border-b border-border px-4 font-medium">{locale==='ar'?'بنية المشروع':'Project structure'}</header>
<div className="pl-editor pl-editor-document" dir={direction} lang={locale}><div className="pl-document-page"><EditorContent editor={editor}/></div></div>
<Saved/></div>}
createRoot(document.getElementById('root')).render(<DirectionProvider direction={direction}><Fixture/></DirectionProvider>);
`,
  );
  const { build } = await fromApp('vite');
  await build({
    configFile: false,
    root: harness,
    logLevel: 'error',
    resolve: {
      alias: [
        { find: '@/hooks/api', replacement: resolve(harness, 'api.ts') },
        { find: '@tanstack/react-router', replacement: resolve(harness, 'router.ts') },
        { find: /^@\//, replacement: `${resolve(app, 'src').replaceAll('\\', '/')}/` },
      ],
    },
    plugins: [
      {
        // A copied baseline editor file imports its baseline neighbors; anything outside the editor comes from this worktree.
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
  let attempted = 0;
  await withLocalOnlyBrowser(
    { allowedHosts: ['editor-canvas.fixture.test:80'], launch: { headless: true } },
    async ({ browser, attempted: outside }) => {
      for (const { width, locale } of [
        { width: 1440, locale: 'en' },
        { width: 390, locale: 'ar' },
      ]) {
        const height = width === 390 ? 844 : 900;
        const context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: 1,
          locale,
          colorScheme: 'light',
          reducedMotion: 'reduce',
          recordVideo: { dir: resolve(out, '.video'), size: { width, height } },
        });
        await context.route(`${origin}/**`, async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          const file = resolve(harness, 'dist', pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
          await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => console.error(error.message));
        await page.goto(`${origin}/?${new URLSearchParams({ locale })}`);
        await page.locator('.ProseMirror').waitFor({ timeout: 60_000 });
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.evaluate(() => window.fixture.direction()), locale === 'ar' ? 'rtl' : 'ltr');
        const name = `${PHASE}-${locale}-${width}`;
        const step = async (label) => {
          await page.waitForTimeout(700);
          const shot = `${label}-${name}.png`;
          await page.screenshot({ path: resolve(out, shot) });
          const state = await page.evaluate(() => ({ names: window.fixture.names(), markdown: window.fixture.markdown() }));
          results.push({ phase: PHASE, locale, width, step: label, shot, ...state });
          return state;
        };
        await page.evaluate(() => window.fixture.selectFirstFile());
        await step('selected');
        await page.evaluate(() => window.fixture.cut());
        await step('cut');
        await page.evaluate(() => window.fixture.paste());
        const pasted = await step('pasted');
        if (PHASE === 'after') {
          assert.equal(pasted.markdown, SOURCE);
          assert.deepEqual(pasted.names, ['index.ts', 'util.ts']);
        }
        const recording = page.video();
        await context.close();
        if (recording) await rename(await recording.path(), resolve(out, `flow-${name}.webm`));
      }
      attempted = outside.length;
    },
  );
  await rm(resolve(out, '.video'), { recursive: true, force: true });
  await writeFile(
    resolve(out, `measurements-${PHASE}.json`),
    `${JSON.stringify({ baseline, head: git('rev-parse', 'HEAD'), fixture: 'production editor canvas; mocked router and page lookup hooks', outsideNetworkAttempts: attempted, results }, null, 2)}\n`,
  );
  console.log(results.map(({ shot, names }) => ({ shot, names })));
} finally {
  try {
    if (harness) await rm(harness, { recursive: true, force: true });
  } finally {
    await devstack.release();
  }
}
