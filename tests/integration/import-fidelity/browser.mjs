// Compare main and this branch using synthetic GitBook video blocks, paragraph
// dividers and page links. Seed converted source into disposable sites, open it
// in the real editor, publish through the UI, and exercise the published reader.
// Every profile runs in withLocalOnlyBrowser; providers are fulfilled in-process.
// The harness owns its :4310/:4410 process trees and the machine-wide lock.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { convertGitBookMarkdown } from '../../../apps/server/src/actions/importers/gitbook-markdown.ts';
import { rewriteMintlifyInternalLinks } from '../../../apps/server/src/actions/importers/mintlify-links.ts';
import { getDb } from '../../../packages/database/src/client.ts';
import { MESSAGE_IDS } from '../../../packages/i18n/src/message-ids.ts';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const APP = 'http://localhost:4310';
const API = 'http://localhost:4410';
const RECHECK = process.env.NIBLEAF_CAPTURE_RECHECK === '1';
const COUNCIL = process.env.NIBLEAF_CAPTURE_COUNCIL === '1' || RECHECK;
const OUTPUT = resolve(ROOT, '.github/assets/fix-import-fidelity', ...(RECHECK ? ['council-recheck'] : COUNCIL ? ['council-fix'] : []));
const LOGS = resolve(ROOT, '.tmp/import-fidelity');
const YT = 'M7lc1UVf-VE';

assert.ok(process.env.NIBLEAF_DEVSTACK_LOCK, 'Set the shared machine-wide NIBLEAF_DEVSTACK_LOCK');
assert.equal(new URL(process.env.POSTGRES_URL).pathname.slice(1), process.env.NIBLEAF_CAPTURE_DATABASE, 'explicit disposable database required');
assert.ok(process.env.NIBLEAF_CAPTURE_DATABASE?.includes('import_fidelity'), 'the disposable database name must contain import_fidelity');
assert.match(process.env.REDIS_DB ?? '', /^[1-9]\d*$/, 'Set REDIS_DB to the allocated capture Redis database');
assert.ok(Number.isSafeInteger(Number(process.env.REDIS_DB)), 'REDIS_DB must be a safe integer for the allocated capture Redis database');
assert.equal(process.env.REDIS_DB, process.env.NIBLEAF_CAPTURE_REDIS_DB, 'REDIS_DB must match the explicitly allocated NIBLEAF_CAPTURE_REDIS_DB');
assert.equal(process.env.API_PORT, '4410', 'the API must listen on 4410');

/** Every host a provider's player, thumbnails or media are served from. */
const PROVIDER_HOST = /(^|\.)(youtube(-nocookie)?\.com|youtu\.be|ytimg\.com|googlevideo\.com|vimeo(cdn)?\.com|loom(cdn)?\.com|wistia\.(com|net))$/;
const isProvider = (url) => PROVIDER_HOST.test(new URL(url).hostname);
/** Other off-site hosts the pages name (a video file, a poster, a map): answered locally. */
const isOtherSite = (url) => /(^|\.)example\.com$/.test(new URL(url).hostname);
/** Only these hosts are reached: everything else is aborted, or answered by the mocks here. */
const isLocal = (url) => {
  const { protocol, hostname } = new URL(url);
  return protocol === 'data:' || protocol === 'blob:' || hostname === 'localhost' || hostname === '127.0.0.1';
};
const STUB = (host) =>
  `<!doctype html><html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#111;color:#eee;font:16px system-ui">${host} (stubbed in this check)</body></html>`;

const db = getDb({ connectionString: process.env.POSTGRES_URL });
const children = new Set();
const logs = [];
let browser;
let session;
let cleaning;
/** Stop everything this run started. Safe to call twice; every step runs even when one fails. */
const cleanup = () => {
  cleaning ??= (async () => {
    const steps = [
      () => browser?.close(),
      async () => {
        for (const child of children) await stop(child);
      },
      () => session && db.session.delete({ where: { id: session.id } }),
      () => db.$disconnect(),
      () => {
        for (const log of logs) log.end();
      },
    ];
    const errors = [];
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Capture cleanup failed');
  })();
  return cleaning;
};

let lock;
for (;;) {
  try {
    lock = await acquireDevstackLock(`fix/import-fidelity\n${ROOT}`, { onInterrupt: cleanup });
    break;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log('Waiting for the shared dev-stack lock (checking every 2 minutes).');
    await new Promise((done) => setTimeout(done, 120_000));
  }
}

function start(name, entry, env = {}, cwd = ROOT) {
  const log = createWriteStream(resolve(LOGS, `${name}.log`));
  logs.push(log);
  const child = spawn(process.execPath, [`--env-file=${resolve(ROOT, '.env')}`, '--import', 'tsx', entry], {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.add(child);
  return child;
}
async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') {
      await new Promise((done, reject) => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', reject);
        killer.once('exit', done);
      });
    } else child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) await new Promise((done) => child.once('exit', done));
  }
  children.delete(child);
}
async function ready(url) {
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(5000) })).status < 500) return;
    } catch {
      // Booting.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Not ready: ${url}`);
}
const until = async (check, what, tries = 120) => {
  for (let attempt = 0; attempt < tries; attempt++) {
    const value = await check();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

const evidence = [];
/** The page a journey is on, for a screenshot when it fails. */
let current;
/** What the local-only browser recorded as attempted outside the stack (the PR's evidence; 0). */
let outsideAttempts = -1;
try {
  await mkdir(OUTPUT, { recursive: true });
  await mkdir(LOGS, { recursive: true });
  // The publish queue, worked with the worker's own processors and without its ops port.
  start(
    'publish-worker',
    resolve(import.meta.dirname, '../editor-video-blocks/publish-worker.mjs'),
    { WORKER_QUEUES: 'publish' },
    resolve(ROOT, 'apps/worker'),
  );

  const user = await db.user.findUniqueOrThrow({ where: { email: 'demo@nibleaf.test' } });
  const member = await db.member.findFirstOrThrow({ where: { userId: user.id } });
  const token = randomUUID();
  session = await db.session.create({
    data: { userId: user.id, token, expiresAt: new Date(Date.now() + 3_600_000), activeOrganizationId: member.organizationId },
  });
  const signed = encodeURIComponent(`${token}.${createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(token).digest('base64')}`);
  // #565's local-only browser: default-deny at Chromium's network layer, and any
  // attempt to reach outside the stack fails the run. Only the app is allowed; the
  // provider and example.com hosts are answered by this script's own routes.
  await withLocalOnlyBrowser(
    { allowedHosts: [hostKey(APP)], launch: { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false } },
    async ({ browser: local, attempted }) => {
      browser = local;
      await runPhases(signed, member);
      outsideAttempts = attempted.length;
      console.log(`Attempts outside the local stack: ${attempted.length}`);
    },
  );
  await writeFile(resolve(OUTPUT, 'request-log.json'), `${JSON.stringify({ outsideAttempts, profiles: evidence }, null, 2)}\n`);
} finally {
  try {
    await cleanup();
  } finally {
    await lock.release();
  }
}
console.log('\nAll import fidelity capture profiles passed.');

async function runPhases(signed, member) {
  const phases = process.env.NIBLEAF_BEFORE_APP ? ['before', 'after'] : ['after'];
  for (const phase of phases) {
    const before = phase === 'before';
    const api = start(`${phase}-api`, before ? process.env.NIBLEAF_BEFORE_API : 'apps/server/dist/index.mjs');
    const app = start(
      `${phase}-app`,
      before ? process.env.NIBLEAF_BEFORE_APP : resolve(ROOT, 'apps/app/.output/server/index.mjs'),
      { PORT: '4310' },
      before ? process.env.NIBLEAF_BEFORE_ROOT : ROOT,
    );
    await ready(`${API}/health`);
    await ready(`${APP}/`);
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390]) {
        const name = `${phase} ${locale} ${width}`;
        try {
          evidence.push(await journey({ phase, locale, width, member, signed }));
          console.log(`ok   ${name}`);
        } catch (error) {
          console.log(`FAIL ${name}: ${error.stack ?? error.message}`);
          const file = resolve(LOGS, `fail-${name.replaceAll(' ', '-')}.png`);
          await current?.screenshot({ path: file }).then(
            () => console.log(`     at ${current.url()}, see ${file}`),
            () => undefined,
          );
          await current
            ?.context()
            .close()
            .catch(() => undefined);
          throw error;
        }
      }
    await stop(app);
    await stop(api);
  }
}

async function journey({ phase, locale, width, member, signed }) {
  const before = phase === 'before';
  const ar = locale === 'ar';
  const messages = JSON.parse(await readFile(resolve(ROOT, `packages/i18n/messages/${locale}.json`), 'utf8'));
  const t = (key, variables = {}) => messages[MESSAGE_IDS[key]].replace(/\{(\w+)\}/g, (_, key) => String(variables[key]));
  const title = ar ? 'فيديو الشرح:' : 'Video tour:';
  const next = ar ? 'الخطوة التالية' : 'Next step';
  const example = RECHECK
    ? '    [Next](https://help.test/next)\n    [Missing](https://help.test/missing)'
    : '    [Demo](https://youtu.be/abcdefghijk)\n    /\n    \\---';
  const authoredVideo = RECHECK
    ? '<video src="https://media.example.com/training.mp4" poster="/api/public/assets/import-fidelity-poster.svg" title="Original" width="640" controls></video>\n\n'
    : '';
  const source = COUNCIL
    ? `${ar ? 'مثال' : 'Example'}:\n\n${example}\n\n${authoredVideo}- ${title}\n\n  [Demo](https://youtu.be/${YT})\n\n  ${next}.\n\n<p>---</p>\n\n[${next}](https://nibleaf.com/pages/next?lang=${locale}#start)`
    : `${title}\n\n{% video src="https://youtu.be/${YT}" title="${title}" %}\n\n/\n\n<p>---</p>\n\n[${next}](https://nibleaf.com/pages/next?lang=${locale}#start)`;
  const converter = before
    ? (await import(pathToFileURL(resolve(process.env.NIBLEAF_BEFORE_ROOT, 'apps/server/src/actions/importers/gitbook-markdown.ts')).href))
        .convertGitBookMarkdown
    : convertGitBookMarkdown;
  const linkConverter = before
    ? (await import(pathToFileURL(resolve(process.env.NIBLEAF_BEFORE_ROOT, 'apps/server/src/actions/importers/mintlify-links.ts')).href))
        .rewriteMintlifyInternalLinks
    : rewriteMintlifyInternalLinks;
  const importedContent = linkConverter(converter(source, { resolveFile: () => undefined }).content, 'intro', new Map([['next', '/next']]), {
    ...(RECHECK ? { sourceUrl: 'https://help.test' } : {}),
  });
  const project = await db.project.create({
    data: {
      organizationId: member.organizationId,
      name: ar ? 'دليل مستورد' : 'Imported guide',
      slug: `import-fidelity-${randomUUID().slice(0, 8)}`,
      config: { addons: { previewDeployments: true } },
      branches: { create: { name: 'main', isDefault: true } },
      languages: { create: { code: locale, label: ar ? 'العربية' : 'English', isDefault: true, direction: ar ? 'RTL' : 'LTR' } },
    },
    include: { branches: true, languages: true },
  });
  const pageData = { projectId: project.id, branchId: project.branches[0].id, languageId: project.languages[0].id };
  const imported = await db.page.create({
    data: { ...pageData, title: ar ? 'الجولة المستوردة' : 'Imported tour', slug: 'intro', path: 'intro', content: importedContent, position: 0 },
  });
  await db.page.create({
    data: {
      ...pageData,
      title: next,
      slug: 'next',
      path: 'next',
      content: `## ${ar ? 'البداية' : 'Start'}\n\n${ar ? 'تابع إعداد الموقع.' : 'Continue setting up your site.'}`,
      position: 1,
    },
  });
  const recording = !before && locale === 'en' && width === 1440;
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 1000 },
    locale,
    reducedMotion: 'reduce',
    ...(recording ? { recordVideo: { dir: LOGS, size: { width: 1440, height: 1000 } } } : {}),
  });
  await context.addCookies([
    { name: 'better-auth.session_token', value: signed, url: APP, httpOnly: true, sameSite: 'Lax' },
    { name: 'PARAGLIDE_LOCALE', value: locale, url: APP },
  ]);
  const requests = [];
  context.on('response', (response) => {
    if (response.status() >= 400) console.log('HTTP error:', response.status(), response.url());
  });
  context.on('console', (message) => {
    if (message.type() === 'error') console.log('Console error:', message.text());
  });
  context.on('request', (request) => requests.push(request.url()));
  if (RECHECK)
    await context.route(`${APP}/api/public/assets/import-fidelity-poster.svg`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#164e63"/><circle cx="320" cy="150" r="44" fill="#a5f3fc"/><path d="m310 125 35 25-35 25z" fill="#164e63"/><text x="320" y="250" text-anchor="middle" font-family="sans-serif" font-size="24" fill="white">Synthetic training poster</text></svg>',
      }),
    );
  await context.route(isProvider, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: STUB(new URL(route.request().url()).hostname) }),
  );
  await context.route(isOtherSite, (route) => route.fulfill({ status: 204 }));
  const page = await context.newPage();
  current = page;
  page.on('pageerror', (error) => console.log('Browser error:', error.message));
  page.on('requestfailed', (request) => console.log('Request failed:', request.url(), request.failure()?.errorText));
  page.setDefaultTimeout(30_000);
  const shot = async (step, target = page) => {
    await target.evaluate(() => document.fonts.ready);
    await target.mouse.move(1, 1);
    await target.waitForTimeout(300);
    await target.screenshot({ path: resolve(OUTPUT, `${phase}-${locale}-${width}-${step}.png`) });
  };
  await page.goto(`${APP}/app/projects/${project.id}/editor?page=${imported.id}`);
  await page
    .locator('[data-page-title]')
    .waitFor()
    .catch(async (error) => {
      console.log('Page requests:', JSON.stringify(requests));
      console.log('Page body:', (await page.locator('body').innerText()).slice(0, 800));
      throw error;
    });
  const closeTree = page.getByRole('button', { name: t('editor.hideSidebar'), exact: true }).filter({ visible: true });
  if (width === 390 && (await closeTree.count())) await closeTree.first().click();
  const prose = page.locator('.ProseMirror');
  await prose.waitFor();
  if (!before) {
    await prose.locator('[data-video-embed]').first().waitFor();
    assert.equal(await prose.locator('hr').count(), 1, 'a real divider in the editor');
    assert.ok((await prose.locator('a').all()).length > 0);
    if (COUNCIL) {
      assert.ok(
        (await prose.locator('pre').innerText()).includes(RECHECK ? '[Next](https://help.test/next)' : '[Demo](https://youtu.be/abcdefghijk)'),
      );
      assert.equal(await prose.locator('li [data-video-embed]').count(), 1);
    } else assert.ok(!(await prose.innerText()).split('\n').includes('/'));
  }
  await shot('editor');
  assert.equal((await db.page.findUniqueOrThrow({ where: { id: imported.id } })).content, importedContent);
  const popup = context.waitForEvent('page');
  const preview = page.getByRole('button', { name: t('project.preview'), exact: true }).filter({ visible: true });
  if (await preview.count()) await preview.first().click();
  else {
    await page
      .getByRole('button', { name: t('editor.pageActions', { title: imported.title }), exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page.getByRole('menuitem', { name: t('project.preview'), exact: true }).click();
  }
  const previewPage = await popup;
  await previewPage.waitForLoadState();
  await previewPage.getByRole('button', { name: t('project.publish'), exact: true }).click();
  await previewPage
    .getByRole('dialog')
    .getByRole('button', { name: t('publish.now'), exact: true })
    .click();
  await until(
    async () => {
      const latest = await db.deployment.findFirst({ where: { projectId: project.id }, orderBy: { version: 'desc' } });
      if (latest?.status === 'FAILED') throw new Error(`Publish failed: ${latest.error}`);
      return latest?.status === 'READY';
    },
    'published snapshot',
    240,
  );
  await previewPage.close();
  assert.equal(await db.domain.count({ where: { projectId: project.id } }), 0);
  const site = await (await context.request.get(`${APP}/api/public/sites/${project.id}`, { maxRedirects: 0 })).json();
  assert.equal(site.data?.primaryDomain ?? null, null);
  const reader = await context.newPage();
  current = reader;
  await reader.goto(`${APP}/sites/${project.id}/intro?lang=${locale}`);
  await reader.locator('article').waitFor();
  const declineAnalytics = reader.getByRole('button', { name: t('site.analyticsConsentDecline'), exact: true });
  if (await declineAnalytics.count()) await declineAnalytics.click();
  const play = reader.locator('[data-theme-component="video-embed"] button');
  if (!before) {
    await play.waitFor();
    assert.equal(await reader.locator('article hr').count(), 1);
    if (COUNCIL) {
      assert.ok(
        (await reader.locator('article pre').innerText()).includes(
          RECHECK ? '[Next](https://help.test/next)' : '[Demo](https://youtu.be/abcdefghijk)',
        ),
      );
      assert.equal(await reader.locator('article li [data-theme-component="video-embed"]').count(), 1);
      if (RECHECK) assert.equal(await reader.locator('article video').getAttribute('poster'), '/api/public/assets/import-fidelity-poster.svg');
    }
    assert.equal(await reader.evaluate(() => document.documentElement.dir), ar ? 'rtl' : 'ltr');
    assert.ok((await reader.getByRole('link', { name: next, exact: true }).last().getAttribute('href')).includes(`/next?lang=${locale}#start`));
  }
  assert.deepEqual(
    requests.filter((url) => !isLocal(url)),
    [],
    'no off-site requests before play',
  );
  await shot('reader', reader);
  if (!before) {
    await reader.getByRole('link', { name: next, exact: true }).last().click();
    await reader.waitForURL(/\/next/);
    await reader.getByRole('heading', { name: next, exact: true }).waitFor();
    await reader.goBack();
    await play.waitFor();
    await play.click();
    await reader.locator('iframe').waitFor();
    await reader.waitForTimeout(500);
  }
  await writeFile(resolve(OUTPUT, `${phase}-${locale}-${width}.md`), `Source fixture:\n\n${source}\n\nImported Markdown:\n\n${importedContent}\n`);
  const video = reader.video();
  await context.close();
  if (recording) await video.saveAs(resolve(OUTPUT, 'after-en-1440-reader.webm'));
  return {
    phase,
    locale,
    width,
    projectId: project.id,
    editorAndReaderChecked: true,
    requests: requests.length,
    mockedProviderRequests: requests.filter(isProvider),
    outsideAttempts: 0,
  };
}
