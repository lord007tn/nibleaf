// Real-browser check of the editor's Video block (AUTH-11, PR 2): a writer
// inserts a YouTube video from the slash menu, sets its title, start and caption,
// saves, publishes, and the published page shows the reader's click-to-load
// player. Neither the editor nor the reader contacts YouTube, the video file's
// host or a poster host before play.
//
// The real built app (:4310) and API (:4410) run on a disposable database; the
// publish queue is worked in this process, so no other port is opened. Takes the
// machine-wide dev-stack lock first. See README.md here.
//   node --env-file=.env --import tsx tests/integration/editor-video-blocks/browser.mjs
//
// Provider and example.com responses are stubbed with `route`, so the run never
// reaches them; every request the pages make is still recorded.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { getDb } from '../../../packages/database/src/client.ts';
import { MESSAGE_IDS } from '../../../packages/i18n/src/message-ids.ts';
import { acquireDevstackLock, chromiumExecutable } from '../lib/capture-env.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const APP = 'http://localhost:4310';
const API = 'http://localhost:4410';
const OUTPUT = resolve(ROOT, '.github/assets/feat-editor-video-blocks');
const LOGS = resolve(ROOT, '.tmp/editor-video-blocks');
const YT = 'M7lc1UVf-VE';
const LOOM = '0123456789abcdef0123456789abcdef';

assert.ok(process.env.NIBLEAF_DEVSTACK_LOCK, 'Set the shared machine-wide NIBLEAF_DEVSTACK_LOCK');
assert.equal(new URL(process.env.POSTGRES_URL).pathname.slice(1), process.env.NIBLEAF_CAPTURE_DATABASE, 'explicit disposable database required');
assert.ok(process.env.NIBLEAF_CAPTURE_DATABASE?.includes('video_blocks'), 'the disposable database name must contain video_blocks');
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

/** Mintlify's documented iframe shape, as a page imported from Mintlify holds it. */
const IMPORTED = (caption) =>
  `Imported from Mintlify.\n\n<Frame caption="${caption}">\n  <iframe\n    className="w-full aspect-video rounded-xl"\n    src="https://www.loom.com/embed/${LOOM}"\n    title="Loom walkthrough"\n    frameBorder="0"\n    allowFullScreen\n  ></iframe>\n</Frame>\n\nThe text after it.`;

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
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        console.error('Cleanup step failed:', error);
      }
    }
  })();
  return cleaning;
};

let lock;
for (;;) {
  try {
    lock = await acquireDevstackLock(`feat/editor-video-blocks\n${ROOT}`, { onInterrupt: cleanup });
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
    child.kill();
    await new Promise((done) => child.once('exit', done));
  }
  children.delete(child);
}
async function ready(url) {
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      if ((await fetch(url)).status < 500) return;
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

const failures = [];
const evidence = [];
/** The page a journey is on, for a screenshot when it fails. */
let current;
try {
  await mkdir(OUTPUT, { recursive: true });
  await mkdir(LOGS, { recursive: true });
  // The publish queue, worked with the worker's own processors and without its ops port.
  start('publish-worker', resolve(import.meta.dirname, 'publish-worker.mjs'), { WORKER_QUEUES: 'publish' }, resolve(ROOT, 'apps/worker'));

  const user = await db.user.findUniqueOrThrow({ where: { email: 'demo@nibleaf.test' } });
  const member = await db.member.findFirstOrThrow({ where: { userId: user.id } });
  const token = randomUUID();
  session = await db.session.create({
    data: { userId: user.id, token, expiresAt: new Date(Date.now() + 3_600_000), activeOrganizationId: member.organizationId },
  });
  const signed = encodeURIComponent(`${token}.${createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(token).digest('base64')}`);
  browser = await chromium.launch({
    executablePath: chromiumExecutable(),
    headless: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

  const phases = process.env.NIBLEAF_BEFORE_APP ? ['before', 'after'] : ['after'];
  for (const phase of phases) {
    const before = phase === 'before';
    const api = start(`${phase}-api`, before ? process.env.NIBLEAF_BEFORE_API : 'apps/server/dist/index.mjs');
    const app = start(`${phase}-app`, before ? process.env.NIBLEAF_BEFORE_APP : 'apps/app/.output/server/index.mjs', { PORT: '4310' });
    await ready(`${API}/health`);
    await ready(`${APP}/`);
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390]) {
        const name = `${phase} ${locale} ${width}`;
        try {
          evidence.push(await journey({ phase, locale, width, member, signed }));
          console.log(`ok   ${name}`);
        } catch (error) {
          failures.push(name);
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
        }
      }
    await stop(app);
    await stop(api);
  }
  await writeFile(resolve(OUTPUT, 'request-log.json'), `${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await cleanup();
  await lock.release();
}
if (failures.length) {
  console.log(`\n${failures.length} failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nAll editor video block checks passed.');

async function journey({ phase, locale, width, member, signed }) {
  const before = phase === 'before';
  const messages = JSON.parse(await readFile(resolve(ROOT, `packages/i18n/messages/${locale}.json`), 'utf8'));
  const t = (key, variables = {}) => {
    const message = messages[MESSAGE_IDS[key]];
    if (message === undefined) throw new Error(`No message ${key}`);
    return message.replace(/\{(\w+)\}/g, (_, variable) => String(variables[variable]));
  };
  const ar = locale === 'ar';
  const words = {
    tour: ar ? 'جولة المنتج' : 'Product tour',
    imported: ar ? 'جولة مستوردة' : 'Imported tour',
    intro: ar ? 'شاهد الجولة قبل أن تبدأ.' : 'Watch the tour before you start.',
    query: ar ? 'فيديو' : 'video',
    title: ar ? 'جولة في المنتج' : 'Tidewater product tour',
    caption: ar ? 'من التسجيل إلى أول نشر' : 'From sign-up to first publish',
  };
  const suffix = randomUUID().slice(0, 8);
  const project = await db.project.create({
    data: {
      organizationId: member.organizationId,
      name: ar ? 'دليل الفيديو' : 'Video guide',
      slug: `video-blocks-${suffix}`,
      config: { addons: { previewDeployments: true } },
      branches: { create: { name: 'main', isDefault: true } },
      languages: { create: { code: locale, label: ar ? 'العربية' : 'English', isDefault: true, direction: ar ? 'RTL' : 'LTR' } },
    },
    include: { branches: true, languages: true },
  });
  const pageData = (title, slug, content, position) => ({
    projectId: project.id,
    branchId: project.branches[0].id,
    languageId: project.languages[0].id,
    title,
    slug,
    path: slug,
    content,
    position,
  });
  const tour = await db.page.create({ data: pageData(words.tour, 'video-tour', words.intro, 0) });
  const importedContent = IMPORTED(words.caption);
  const imported = await db.page.create({ data: pageData(words.imported, 'imported-tour', importedContent, 1) });

  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    isMobile: width === 390,
    hasTouch: width === 390,
    locale,
    reducedMotion: 'reduce',
  });
  await context.addCookies([
    { name: 'better-auth.session_token', value: signed, url: APP, httpOnly: true, sameSite: 'Lax' },
    { name: 'PARAGLIDE_LOCALE', value: locale, url: APP },
  ]);
  let stage = 'editor';
  const requests = [];
  const offLocalNavigations = [];
  context.on('request', (request) => {
    requests.push({ stage, url: request.url() });
    // A page never leaves localhost. (The player's frame after play is the mocked request counted below.)
    if (request.isNavigationRequest() && !request.frame().parentFrame() && !isLocal(request.url())) offLocalNavigations.push(request.url());
  });
  // A redirect that would leave localhost (a custom domain's 301, say) fails the run.
  context.on('response', (response) => {
    const location = response.headers().location;
    if (
      response.request().isNavigationRequest() &&
      response.status() >= 300 &&
      response.status() < 400 &&
      location &&
      !isLocal(new URL(location, response.url()).href)
    )
      offLocalNavigations.push(`${response.url()} → ${location}`);
  });
  // Default deny: every request to a host other than localhost is aborted. Routes
  // added later take precedence, so the in-process mocks below still answer the
  // provider and example.com hosts; nothing leaves the machine.
  await context.route('**/*', (route) => (isLocal(route.request().url()) ? route.fallback() : route.abort('blockedbyclient')));
  await context.route(isProvider, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: STUB(new URL(route.request().url()).hostname) }),
  );
  await context.route(isOtherSite, (route) => route.fulfill({ status: 204 }));
  /** Requests at a stage that went anywhere but localhost. */
  const offSite = (which) => requests.filter((request) => request.stage === which && !isLocal(request.url)).map((request) => request.url);

  const page = await context.newPage();
  current = page;
  page.setDefaultTimeout(30_000);
  const shot = async (step, target = page) => {
    await target.evaluate(() => document.fonts.ready);
    // No hover state in the pictures.
    await target.mouse.move(1, 1);
    await target.waitForTimeout(300);
    await target.screenshot({ path: resolve(OUTPUT, `${phase}-${locale}-${width}-${step}.png`) });
  };
  const openEditor = async (pageId) => {
    await page.goto(`${APP}/app/projects/${project.id}/editor?page=${pageId}`);
    await page.locator('[data-page-title]').waitFor();
    const closeTree = page.getByRole('button', { name: t('editor.hideSidebar'), exact: true }).filter({ visible: true });
    if (width === 390 && (await closeTree.count())) await closeTree.first().click();
    await page.locator('.ProseMirror').waitFor();
  };

  // 1. Find the block from the slash menu.
  await openEditor(tour.id);
  const prose = page.locator('.ProseMirror');
  await prose.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.keyboard.type(words.query);
  const menu = page.getByRole('listbox');
  await menu.waitFor();
  await shot('slash');
  const block = page.locator('[data-video-embed]');
  const youtube = `https://www.youtube.com/watch?v=${YT}&t=30`;
  if (before) {
    assert.equal(await menu.getByRole('option').count(), 0, 'main has no Video block');
    await page.keyboard.press('Escape');
    for (let index = 0; index <= words.query.length; index++) await page.keyboard.press('Backspace');
    // 2. Before: a pasted video link is only a link.
    await prose.evaluate((element, text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, youtube);
    await page.waitForTimeout(500);
    await shot('insert');
  } else {
    const first = menu.getByRole('option').first();
    assert.ok((await first.innerText()).includes(t('editor.slash.video.title')), 'Video is the first match');
    await page.keyboard.press('Enter');
    // 2. Inserted with the address field focused.
    const url = block.getByLabel(t('editor.video.url'), { exact: true });
    await until(() => url.evaluate((element) => element === document.activeElement), 'the address field to take focus', 20);
    await shot('insert');
    await url.fill('https://example.com/not-a-video');
    await url.press('Tab');
    assert.equal(await block.getByRole('alert').innerText(), t('editor.video.invalidUrl'));
    await url.fill(youtube);
    await url.press('Tab');
    // 3. The settings: a required title, the start, and a caption.
    const title = block.getByRole('textbox', { name: t('editor.video.title') });
    assert.equal(await title.evaluate((element) => element === document.activeElement), true, 'Tab moves from the address to the title');
    assert.equal(await title.getAttribute('aria-required'), 'true');
    await title.fill(words.title);
    assert.equal(await block.getByLabel(t('editor.video.start'), { exact: true }).inputValue(), '0:30');
    await block.getByLabel(t('editor.video.caption'), { exact: true }).fill(words.caption);
    await block.getByRole('button', { name: t('editor.video.done'), exact: true }).scrollIntoViewIfNeeded();
    await shot('settings');
    await block.getByRole('button', { name: t('editor.video.done'), exact: true }).click();
    // 4. The facade in the editor: the reader's poster, nothing loaded.
    await block.locator('[data-theme-component="video-embed"]').waitFor();
    assert.equal(await block.getAttribute('aria-label'), t('editor.video.blockLabel', { name: words.title }));
    assert.equal(await page.locator('.ProseMirror iframe').count(), 0, 'no iframe in the editor');
    if (ar) assert.equal(await prose.evaluate((element) => getComputedStyle(element).direction), 'rtl');
    const box = await block.locator('[data-theme-component="video-embed"]').boundingBox();
    assert.ok(box && Math.abs(box.width / box.height - 16 / 9) < 0.05, 'a 16:9 box');
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= width, 'no horizontal scroll');
    await block.scrollIntoViewIfNeeded();
    await shot('facade-editor');
  }

  // The save reaches the database as canonical HTML.
  const saved = await until(async () => {
    const row = await db.page.findUniqueOrThrow({ where: { id: tour.id } });
    return before ? row.content.includes('youtube.com/watch') && row.content : row.content.includes('youtube-nocookie.com/embed/') && row.content;
  }, 'the page to save');
  if (!before)
    assert.ok(
      saved.includes(
        `<Frame caption="${words.caption}">\n  <iframe src="https://www.youtube-nocookie.com/embed/${YT}?start=30" title="${words.title}"></iframe>\n</Frame>`,
      ),
      `saved canonical storage, got: ${saved}`,
    );
  await page.waitForTimeout(1500);
  const editorOffSite = offSite('editor');
  assert.deepEqual(editorOffSite, [], 'the editor made no provider, video or poster request');

  // 5. A page imported from Mintlify opens as the block (after) and saves unchanged.
  await openEditor(imported.id);
  if (!before) {
    await block.locator('[data-theme-component="video-embed"]').waitFor();
    assert.ok((await block.innerText()).includes(words.caption));
  }
  await page.waitForTimeout(800);
  await shot('imported');
  assert.equal((await db.page.findUniqueOrThrow({ where: { id: imported.id } })).content, importedContent, 'the imported page is unchanged');

  // 6. Publish from the preview, as a writer does.
  await openEditor(tour.id);
  stage = 'publish';
  const popup = context.waitForEvent('page');
  const preview = page.getByRole('button', { name: t('project.preview'), exact: true }).filter({ visible: true });
  if (await preview.count()) await preview.first().click();
  else {
    await page
      .getByRole('button', { name: t('editor.pageActions', { title: words.tour }), exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page.getByRole('menuitem', { name: t('project.preview'), exact: true }).click();
  }
  const previewPage = await popup;
  await previewPage.waitForLoadState();
  await previewPage.getByRole('button', { name: t('project.publish'), exact: true }).click();
  const publishDialog = previewPage.getByRole('dialog');
  await publishDialog.getByRole('button', { name: t('publish.now'), exact: true }).click();
  const deployment = await until(
    async () => {
      const latest = await db.deployment.findFirst({ where: { projectId: project.id }, orderBy: { version: 'desc' } });
      if (latest?.status === 'FAILED') throw new Error(`Publish failed: ${latest.error}`);
      return latest?.status === 'READY' && latest;
    },
    'the deployment',
    240,
  );
  assert.equal(deployment.status, 'READY');
  await previewPage.close();
  assert.deepEqual(offSite('publish'), [], 'publishing made no request off localhost');

  // 7. The published page: the facade, and still no request until play. Only a
  // site made here, with no custom domain, is opened, and only on localhost.
  assert.equal(await db.domain.count({ where: { projectId: project.id } }), 0, 'the site has no custom domain');
  const site = await (await context.request.get(`${APP}/api/public/sites/${project.id}`, { maxRedirects: 0 })).json();
  assert.equal(site.data?.primaryDomain ?? null, null, 'the site has no primary domain to redirect to');
  stage = 'reader';
  const reader = await context.newPage();
  await reader.goto(`${APP}/sites/${project.id}/video-tour`, { waitUntil: 'load' });
  await reader.locator('article').waitFor();
  const play = reader.locator('[data-theme-component="video-embed"] button');
  let afterPlay = [];
  if (!before) {
    await play.waitFor();
    await reader.waitForTimeout(1500);
    assert.deepEqual(offSite('reader'), [], 'the reader made no provider, video or poster request before play');
    assert.equal(await reader.locator('iframe').count(), 0);
    assert.equal(await play.getAttribute('aria-label'), t('site.videoPlay', { title: words.title, provider: 'YouTube' }));
    if (ar) assert.equal(await reader.evaluate(() => document.documentElement.dir), 'rtl');
    await play.scrollIntoViewIfNeeded();
  }
  await shot('reader', reader);
  if (!before) {
    stage = 'play';
    await play.click();
    await reader.locator('iframe').waitFor();
    await reader.waitForTimeout(800);
    afterPlay = offSite('play');
    assert.deepEqual(afterPlay, [`https://www.youtube-nocookie.com/embed/${YT}?start=30&autoplay=1`], 'play loads exactly the chosen player');
  }
  await context.close();
  assert.deepEqual(offLocalNavigations, [], 'no navigation or redirect left localhost');
  return {
    phase,
    locale,
    width,
    projectId: project.id,
    saved: saved.slice(saved.indexOf(words.intro) + words.intro.length).trim(),
    editorRequests: requests.filter((request) => request.stage === 'editor').length,
    editorOffSiteRequests: editorOffSite,
    publishOffSiteRequests: offSite('publish'),
    readerRequestsBeforePlay: requests.filter((request) => request.stage === 'reader').length,
    readerOffSiteRequestsBeforePlay: offSite('reader'),
    requestsMadeByPlay: afterPlay,
  };
}
