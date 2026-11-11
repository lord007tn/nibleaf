// Run through the shared-service namespace wrapper with node --import tsx.
// Real API + editor, fictional session/rows, isolated headless Chromium. No worker
// is needed: the published fixture is immutable and already READY.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '../../..');
const assets = join(root, '.github/assets/feat-page-history');
const framesRoot = join(tmpdir(), 'nibleaf-page-history-frames');
const appUrl = 'http://localhost:4810';
const apiUrl = 'http://localhost:4811';
assert.ok(process.env.DATABASE_URL?.includes('/nibleaf_page_history'), 'Use the owned nibleaf-page-history namespace');
process.env.POSTGRES_URL = process.env.DATABASE_URL;
const redis = new URL(process.env.REDIS_URL);
Object.assign(process.env, {
  NODE_ENV: 'development',
  PORT: '4810',
  API_PORT: '4811',
  APP_URL: appUrl,
  API_URL: apiUrl,
  BETTER_AUTH_URL: appUrl,
  BETTER_AUTH_SECRET: 'fictional-page-history-capture-session-secret',
  VITE_API_URL: apiUrl,
  TRUSTED_ORIGINS: `${appUrl},${apiUrl}`,
  CORS_ALLOWED_ORIGINS: appUrl,
  ANALYTICS_MODE: 'disabled',
  QUEUE_CLUSTER: 'true',
  REDIS_HOST: redis.hostname,
  REDIS_PORT: redis.port,
  REDIS_DB: redis.pathname.slice(1),
  REDIS_PASSWORD: decodeURIComponent(redis.password),
  STORAGE_ENDPOINT: process.env.S3_ENDPOINT,
  STORAGE_PUBLIC_ENDPOINT: process.env.S3_ENDPOINT,
  STORAGE_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  STORAGE_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  STORAGE_BUCKET: process.env.S3_BUCKET,
  STORAGE_REGION: 'us-east-1',
  STORAGE_CORS_ALLOWED_ORIGINS: appUrl,
});
delete process.env.SKIP_ENV_VALIDATION;
const { prisma } = await import('@nibleaf/database');
const { buildSnapshot } = await import('../../../packages/shared/src/site.ts');
const userIds = [],
  orgIds = [],
  children = [];
let browser;
mkdirSync(assets, { recursive: true });
mkdirSync(framesRoot, { recursive: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checkPort = (port) =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
const start = (name, args, cwd) => {
  const log = createWriteStream(join(tmpdir(), `nibleaf-page-history-${name}.log`));
  const child = spawn(process.execPath, args, { cwd, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push(child);
  console.log(`${name} PID ${child.pid}`);
  return child;
};
const ready = async (url, child) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Process ${child.pid} exited: ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
    } catch {
      /* The listener has not bound yet. */
    }
    await pause(500);
  }
  throw new Error(`Not ready: ${url}`);
};

try {
  await checkPort(4810);
  await checkPort(4811);
  const user = await prisma.user.create({ data: { name: 'Maya Haddad', email: `page-history-${randomUUID()}@nibleaf.test`, emailVerified: true } });
  userIds.push(user.id);
  const org = await prisma.organization.create({ data: { name: 'Meridian Studio', slug: `history-${randomUUID()}` } });
  orgIds.push(org.id);
  await prisma.member.create({ data: { organizationId: org.id, userId: user.id, role: 'owner', orgRole: 'owner' } });
  const project = await prisma.project.create({ data: { organizationId: org.id, name: 'Meridian Docs', slug: `history-${randomUUID()}` } });
  const branch = await prisma.branch.create({ data: { projectId: project.id, name: 'main', isDefault: true } });
  const languages = await Promise.all(
    ['en', 'ar'].map((code, i) =>
      prisma.language.create({
        data: {
          projectId: project.id,
          code,
          label: code === 'en' ? 'English' : 'العربية',
          direction: code === 'en' ? 'LTR' : 'RTL',
          isDefault: i === 0,
          position: i,
        },
      }),
    ),
  );
  const pages = [];
  for (const locale of ['en', 'ar'])
    for (const width of [1440, 390]) {
      const language = languages.find((item) => item.code === locale);
      const title = locale === 'en' ? 'Quick start' : 'دليل البدء السريع';
      const content =
        locale === 'en'
          ? 'Welcome to Meridian.\n\n## Install the SDK\n\nRun `npm install @meridian/sdk`.\n\n## Next steps\n\nCreate your first workspace and invite your team.'
          : 'مرحبًا بك في ميريديان.\n\n## تثبيت المكتبة\n\nشغّل الأمر `npm install @meridian/sdk`.\n\n## الخطوات التالية\n\nأنشئ مساحة عملك الأولى وادعُ فريقك إليها.';
      const restored =
        locale === 'en'
          ? 'Welcome to Meridian.\n\n## Install the SDK\n\nRun `pnpm add @meridian/sdk`.\n\n## Next steps\n\nCreate your first workspace, then generate an API key.'
          : 'مرحبًا بك في ميريديان.\n\n## تثبيت المكتبة\n\nشغّل الأمر `pnpm add @meridian/sdk`.\n\n## الخطوات التالية\n\nأنشئ مساحة عملك الأولى، ثم أنشئ مفتاحًا لواجهة البرمجة.';
      const page = await prisma.page.create({
        data: {
          projectId: project.id,
          branchId: branch.id,
          languageId: language.id,
          title,
          content,
          slug: `quick-start-${width}`,
          path: `quick-start-${width}`,
        },
      });
      await prisma.pageRevision.create({
        data: {
          projectId: project.id,
          pageId: page.id,
          userId: user.id,
          title,
          content: restored,
          contentBytes: Buffer.byteLength(title + restored),
          reason: 'autosave',
          createdAt: new Date(Date.now() - 45 * 60_000),
        },
      });
      pages.push({ ...page, languageCode: locale, width, restored });
    }
  const snapshot = buildSnapshot(
    { ...project, branches: [branch], languages },
    pages.map((page) => ({ ...page, createdAt: page.createdAt.toISOString(), updatedAt: page.updatedAt.toISOString() })),
    new Date().toISOString(),
  );
  await prisma.deployment.create({
    data: { projectId: project.id, version: 1, status: 'READY', snapshot, pagesCount: pages.length, createdById: user.id },
  });
  const token = randomUUID();
  await prisma.session.create({ data: { userId: user.id, token, activeOrganizationId: org.id, expiresAt: new Date(Date.now() + 3_600_000) } });
  const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(token).digest('base64');
  const cookie = encodeURIComponent(`${token}.${signature}`);
  const api = start('api', ['--import', 'tsx', 'dist/index.mjs'], join(root, 'apps/server'));
  await ready(`${apiUrl}/health`, api);
  const app = start(
    'app',
    [join(root, 'node_modules/vite/bin/vite.js'), 'dev', '--force', '--port', '4810', '--strictPort', '--host', '127.0.0.1'],
    join(root, 'apps/app'),
  );
  await ready(appUrl, app);
  browser = await chromium.launch({
    executablePath: `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1248/chrome-win64/chrome.exe`,
    headless: true,
  });
  const results = [];
  for (const fixture of pages) {
    const locale = fixture.languageCode;
    const width = fixture.width;
    const label = `${locale}-${width}`;
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 960 : 844 }, locale, reducedMotion: 'reduce' });
    await context.addCookies([
      { name: 'better-auth.session_token', value: cookie, url: appUrl, httpOnly: true, sameSite: 'Lax' },
      { name: 'NIBLEAF_LOCALE', value: locale, url: appUrl },
    ]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const strings = JSON.parse(readFileSync(join(root, `packages/i18n/messages/${locale}.json`), 'utf8'));
    const text = (key) => strings[key];
    const frames = [];
    const capture = async (step, duration = 1000) => {
      await page.waitForTimeout(300);
      const path = join(framesRoot, `${label}-${String(frames.length).padStart(2, '0')}-${step}.png`);
      await page.screenshot({ path });
      frames.push({ path, duration });
      return path;
    };
    try {
      await page.goto(`${appUrl}/app/projects/${project.id}/editor?page=${fixture.id}`, { waitUntil: 'load' });
      await page.locator('[data-page-title]').waitFor({ timeout: 90_000 });
      await page.screenshot({ path: join(assets, `${label}-before.png`) });
      await capture('editor');
      await page.getByRole('button', { name: text('editor_moreactions'), exact: true }).click();
      await capture('menu');
      await page.getByRole('menuitem', { name: text('editor_history_title'), exact: true }).click();
      await page
        .getByRole('button', { name: text('editor_history_compare'), exact: true })
        .first()
        .waitFor();
      await capture('history');
      await page
        .getByRole('button', { name: text('editor_history_compare'), exact: true })
        .first()
        .click();
      const diff = page.getByRole('region', { name: text('editor_history_diff'), exact: true }).last();
      await diff.waitFor();
      await diff.locator('bdi').filter({ hasText: 'pnpm add @meridian/sdk' }).waitFor();
      assert.ok((await diff.textContent()).includes('pnpm add @meridian/sdk'));
      await diff.scrollIntoViewIfNeeded();
      await capture('diff', 1800);
      await page.screenshot({ path: join(assets, `${label}-diff.png`) });
      await page.getByRole('button', { name: text('editor_history_restore'), exact: true }).click();
      await capture('confirm');
      const restoreResponse = page.waitForResponse(
        (response) => response.url().endsWith('/history/restore') && response.request().method() === 'POST',
      );
      await page
        .getByRole('dialog')
        .last()
        .getByRole('button', { name: text('editor_history_restore'), exact: true })
        .click();
      assert.equal((await restoreResponse).status(), 200);
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const stored = await prisma.page.findUniqueOrThrow({ where: { id: fixture.id } });
      assert.equal(stored.content, fixture.restored);
      assert.ok((await page.locator('.tiptap').textContent()).includes('pnpm add @meridian/sdk'), 'editor displays restored body');
      await capture('restored', 1600);
      await page.screenshot({ path: join(assets, `${label}-after.png`) });
      assert.equal(await prisma.pageRevision.count({ where: { pageId: fixture.id, reason: 'before-restore', content: fixture.content } }), 1);
      assert.equal(await page.locator('html').getAttribute('dir'), locale === 'ar' ? 'rtl' : 'ltr');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `${label} has no document overflow`);
      assert.deepEqual(errors, [], `${label} has no page errors`);
      results.push({ locale, width, restored: true, undoCopy: true, errors });
      writeFileSync(join(framesRoot, `${label}.json`), JSON.stringify(frames));
    } catch (error) {
      await page.screenshot({ path: join(tmpdir(), `nibleaf-history-failure-${label}.png`) });
      writeFileSync(join(tmpdir(), `nibleaf-history-failure-${label}.txt`), await page.locator('body').innerText());
      throw error;
    } finally {
      await context.close();
    }
  }
  writeFileSync(join(assets, 'capture-results.json'), JSON.stringify({ source: 'real local editor and API; fictional fixtures', results }, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser?.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGTERM');
      console.log(`Stopped exact PID ${child.pid}`);
    }
  }
  await prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}
