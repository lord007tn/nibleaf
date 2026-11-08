import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// Manual integration regression: run only against the supplied local council seed.
// COOKIE_FILE uses the same name=value lines as shots.mjs. This marks the fixture inbox read.
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const dir = process.env.OUT_DIR ?? `${repo}/output/playwright/dashboard-shell`;
const base = process.env.BASE ?? 'http://localhost:4510';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local fixture host required');
assert(process.env.COOKIE_FILE, 'COOKIE_FILE is required');
const lines = readFileSync(process.env.COOKIE_FILE, 'utf8')
  .trim()
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/);
const cookies = lines.map((line) => {
  const index = line.indexOf('=');
  assert(index > 0, 'Expected name=value cookie lines');
  return { name: line.slice(0, index), value: line.slice(index + 1), domain: new URL(base).hostname, path: '/' };
});
const session = await fetch(`${base}/api/auth/get-session`, { headers: { Cookie: lines.join('; ') } }).then((response) => response.json());
assert.equal(session.user?.email, 'demo@nibleaf.test', 'Council owner fixture required');
const projects = await fetch(`${base}/api/app/projects`, { headers: { Cookie: lines.join('; ') } }).then((response) => response.json());
const projectId = projects.data?.find((project) => project.name === 'Acme API Reference')?.id;
const secondId = projects.data?.find((project) => project.name === 'Help Center')?.id;
assert(projectId && secondId, 'Run the supplied council seed first');
const api = base;
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ?? (process.platform === 'win32' ? `${process.env.ProgramFiles}/Google/Chrome/Application/chrome.exe` : undefined),
  headless: true,
});
const report = [];
mkdirSync(`${dir}/video`, { recursive: true });
const bounded = async (page, name) => {
  const popup = page.locator('[data-slot="popover-content"][data-open]');
  await popup.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-slot="popover-content"][data-open]');
    return element && !element.hasAttribute('data-starting-style') && element.getAnimations().every((animation) => animation.playState !== 'running');
  });
  const box = await popup.boundingBox();
  const viewport = page.viewportSize();
  assert(box && box.x >= -1 && box.x + box.width <= viewport.width + 1, `${name}: horizontal bounds ${JSON.stringify(box)}`);
  assert(box.y >= -1 && box.y + box.height <= viewport.height + 1, `${name}: vertical bounds ${JSON.stringify(box)}`);
  report.push({ name, viewport, box });
};
try {
  for (const locale of ['en', 'ar', 'de']) {
    const catalog = JSON.parse(readFileSync(`${repo}/packages/i18n/messages/${locale}.json`, 'utf8'));
    const context = await browser.newContext({
      viewport: { width: 320, height: 720 },
      locale,
      recordVideo: locale === 'ar' ? { dir: `${dir}/video`, size: { width: 320, height: 720 } } : undefined,
    });
    await context.addCookies([...cookies, { name: 'NIBLEAF_LOCALE', value: locale, domain: new URL(base).hostname, path: '/' }]);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    const visit = async (path) => {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.locator('header').waitFor();
    };
    const openSheet = async () => {
      await page.locator('[data-slot="sidebar-trigger"]').click();
      const dialog = page.getByRole('dialog', { name: catalog.nav_sidebartitle, exact: true });
      await dialog.waitFor();
      assert.equal(
        await dialog.getAttribute('aria-describedby').then((id) => page.locator(`[id="${id}"]`).textContent()),
        catalog.nav_sidebardescription,
      );
      return dialog;
    };
    const bell = () => page.locator('header button:has(svg.lucide-bell)');
    await visit('/app');
    const workspaceHeight = (await page.locator('header').boundingBox()).height;
    assert.equal(workspaceHeight, 48);
    await page.getByRole('navigation', { name: catalog.nav_breadcrumb, exact: true }).waitFor();
    await openSheet();
    await page.keyboard.press('Escape');
    await visit(`/app/projects/${projectId}/analytics/search`);
    assert.equal((await page.locator('header').boundingBox()).height, workspaceHeight);
    const breadcrumb = page.getByRole('navigation', { name: catalog.nav_breadcrumb, exact: true });
    assert.equal(await breadcrumb.locator('[aria-current="page"]').textContent(), catalog.analytics_tab_search);
    assert.equal(await breadcrumb.locator(`a[href="/app/projects/${projectId}"]`).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${locale}: shell overflow`);

    // A retained project layout must close the actual modal sheet on site selection.
    const sheet = await openSheet();
    await sheet.locator('[data-slot="dropdown-menu-trigger"]').first().click();
    await page.getByRole('menuitem', { name: /Help Center/ }).click();
    await page.waitForURL(`${base}/app/projects/${secondId}`);
    await page.locator('[data-mobile="true"]').waitFor({ state: 'hidden' });
    await page.locator('header button:has(svg.lucide-search)').click();
    await page.locator('[data-slot="command-input"]').waitFor();
    await page.keyboard.press('Escape');
    const secondSheet = await openSheet();
    await secondSheet.locator('[data-slot="dropdown-menu-trigger"]').first().click();
    await page.getByRole('menuitem', { name: catalog.nav_workspace, exact: true }).click();
    await page.waitForURL(`${base}/app`);
    await page.locator('[data-mobile="true"]').waitFor({ state: 'hidden' });
    const workspaceSheet = await openSheet();
    await workspaceSheet.locator('[data-slot="dropdown-menu-trigger"]').first().click();
    await page.getByRole('menuitem', { name: catalog.dashboard_newproject, exact: true }).click();
    await page.waitForURL(/\/app\/sites\?newSite=true$/);
    await page.locator('[data-mobile="true"]').waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    report.push({ name: `${locale}: mobile switch and accessible shell`, pageErrors: [...pageErrors] });

    await bell().click();
    await bounded(page, `${locale}: notifications 320x720`);
    const label = await bell().getAttribute('aria-label');
    assert(label.includes('4'), `${locale}: full unread count missing: ${label}`);
    assert.equal(await page.locator('[data-slot="popover-content"] .sr-only').filter({ hasText: catalog.notifications_unread }).count(), 4);
    await page.keyboard.press('Escape');

    // Short viewport: all controls must remain reachable via internal scrolling.
    await page.setViewportSize({ width: 320, height: 300 });
    await bell().click();
    await bounded(page, `${locale}: notifications 320x300`);
    await page.keyboard.press('Escape');
    await visit(`/app/projects/${projectId}/analytics/search`);
    await page.locator('button:has(svg.lucide-calendar-range)').click();
    await bounded(page, `${locale}: date filter 320x300`);
    const submit = page.locator('[data-slot="popover-content"] button[type="submit"]');
    await submit.scrollIntoViewIfNeeded();
    assert(await submit.isVisible());
    await page.keyboard.press('Escape');
    // A 1440x900 window at 200% browser zoom has a 720x450 CSS viewport.
    await page.setViewportSize({ width: 720, height: 450 });
    await bell().click();
    await bounded(page, `${locale}: notifications at 200%-equivalent CSS viewport`);
    await page.keyboard.press('Escape');
    await page.locator('button:has(svg.lucide-calendar-range)').click();
    await bounded(page, `${locale}: date filter at 200%-equivalent CSS viewport`);
    await page.keyboard.press('Escape');
    assert.deepEqual(pageErrors, []);
    await context.close();
  }
  // The retry controls use real query refetches; only the failed HTTP reads are injected.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([...cookies, { name: 'NIBLEAF_LOCALE', value: 'en', domain: new URL(base).hostname, path: '/' }]);
  const page = await context.newPage();
  let failPages = true;
  await page.route(`**/api/app/projects/${projectId}/pages*`, (route) =>
    failPages
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"success":false,"message":"Injected read failure"}' })
      : route.continue(),
  );
  await page.goto(`${base}/app/projects/${projectId}/analytics/search`, { waitUntil: 'networkidle' });
  await page.locator('header button:has(svg.lucide-search)').click();
  const pageError = page.getByRole('alert').filter({ hasText: 'Could not refresh pages' });
  await pageError.waitFor({ timeout: 15_000 });
  await page.locator('[data-slot="command-input"]').fill('unmatched-query');
  assert.equal(await page.getByText('No results found.', { exact: true }).count(), 0);
  await page.screenshot({ path: `${dir}/palette-error-after.png` });
  failPages = false;
  await pageError.getByRole('button').click();
  await pageError.waitFor({ state: 'hidden' });
  await page.locator('[data-slot="command-input"]').fill('');
  assert((await page.locator('[data-slot="command-group"]').count()) > 0);
  report.push({ name: 'palette page read fails and retries in place', passed: true });
  await context.close();

  const ar = JSON.parse(readFileSync(`${repo}/packages/i18n/messages/ar.json`, 'utf8'));
  const recovery = await browser.newContext({ viewport: { width: 320, height: 720 } });
  await recovery.addCookies([...cookies, { name: 'NIBLEAF_LOCALE', value: 'ar', domain: new URL(base).hostname, path: '/' }]);
  const recoveryPage = await recovery.newPage();
  let failSites = true;
  await recoveryPage.route('**/api/app/projects', (route) =>
    failSites
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"success":false,"message":"Injected read failure"}' })
      : route.continue(),
  );
  await recoveryPage.goto(`${base}/app/projects/${projectId}/analytics/search`, { waitUntil: 'networkidle' });
  await recoveryPage.locator('[data-slot="sidebar-trigger"]').click();
  const recoverySheet = recoveryPage.getByRole('dialog', { name: ar.nav_sidebartitle, exact: true });
  const switcher = recoverySheet.locator('[data-slot="dropdown-menu-trigger"]').first();
  await switcher.click();
  const siteError = recoveryPage.getByRole('alert').filter({ hasText: ar.nav_sitesloaderror });
  await siteError.waitFor({ timeout: 15_000 });
  assert(!(await switcher.textContent()).includes(ar.nav_workspace));
  assert(!(await switcher.textContent()).includes(ar.project_allsites));
  failSites = false;
  await siteError.getByRole('menuitem').focus();
  await recoveryPage.keyboard.press('Enter');
  await siteError.waitFor({ state: 'hidden' });
  assert((await switcher.textContent()).includes('Acme API Reference'));
  assert(await recoveryPage.getByRole('menuitem', { name: /Help Center/ }).isVisible());
  await recoveryPage.keyboard.press('Escape');
  await recoveryPage.keyboard.press('Escape');
  report.push({ name: 'Arabic switcher keeps site scope and keyboard retry recovers', passed: true });
  // Only after all comparison screenshots: verify the real mark-read round trip.
  const recoveryBell = recoveryPage.locator('header button:has(svg.lucide-bell)');
  await recoveryBell.click();
  await recoveryPage.getByRole('button', { name: ar.notifications_markallread, exact: true }).click();
  await recoveryPage.waitForFunction(() => document.querySelector('header button:has(svg.lucide-bell)')?.getAttribute('aria-label')?.includes('0'));
  assert.equal(await recoveryPage.locator('[data-slot="popover-content"] .sr-only').filter({ hasText: ar.notifications_unread }).count(), 0);
  const persisted = await recovery.request.get(`${api}/api/app/notifications/unread-count`);
  assert.equal((await persisted.json()).data.count, 0);
  report.push({ name: 'mark all read updates accessible names and persists zero unread', passed: true });
  await recovery.close();
} finally {
  await browser.close();
  writeFileSync(`${dir}/browser-checks.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
