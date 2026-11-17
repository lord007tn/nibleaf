// #642: the organization header (OrganizationLayout) on Usage & billing, before and
// after the switcher trigger may shrink. The actual signed-in shell, organization
// route and Billing page, built with Vite; fictional API answers come from request
// interception. No server, port, database or real account is used.
//
// "before" builds organization-switcher.tsx from the base commit, "after" from the
// working tree. Everything else is the working tree in both. Measured per capture:
// overlapping header controls, the trigger spilling out of its breadcrumb item,
// whether the name's first character is visible, hit targets, the accessible name;
// and, after, that Enter opens the switcher and Escape returns focus to the trigger.
//
//   PLAYWRIGHT_CHROMIUM_EXECUTABLE=… node .github/assets/org-header-overlap/capture.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';
import { writeEvidenceJson } from '../../../tests/integration/lib/evidence-json.mjs';

const root = resolve(import.meta.dirname, '../../..');
const appDir = resolve(root, 'apps/app');
const appRequire = createRequire(resolve(appDir, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(appRequire.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const base = '5e3fd880217bce138ec997c8c00195f33ab0d627';
const switcherFile = 'apps/app/src/components/app/org-switcher/organization-switcher.tsx';
const baseSwitcher = git('show', `${base}:${switcherFile}`);
// Never listened on: every request to it is answered by page.route below.
const origin = 'http://org-header.fixture.test';

// Fictional organizations, <id#1>..<id#3>.
const names = {
  latin: "Layla Haddad's documentation workspace",
  arabic: 'مساحة عمل ليلى حداد للتوثيق والمراجعة',
  mixed: 'Acme Docs — مساحة توثيق ليلى 2026',
};
const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const organizations = Object.entries(names).map(([key, name], index) => ({
  key,
  id: id(index + 1),
  label: `<id#${index + 1}>`,
  slug: `org-${key}`,
  name,
  logo: null,
  orgRole: 'owner',
  canCreateWebsite: true,
  sendInvitationEmails: true,
}));
const user = { id: id(9), name: 'Layla Haddad', email: 'layla@example.test', image: null };
const date = '2026-11-12T00:00:00.000Z';

const answer = (pathname) => {
  const data = (value) => ({ data: value });
  if (pathname === '/api/auth/get-session')
    return {
      session: { id: 'fixture', userId: user.id, expiresAt: '2099-01-01T00:00:00.000Z' },
      user: { ...user, emailVerified: true, createdAt: date, updatedAt: date },
    };
  if (pathname === '/api/app/me/switcher')
    return data({
      organizations: organizations.map((org) => ({ ...org, websiteCount: 0 })),
      recent: [],
      landing: { id: organizations[0].id, slug: organizations[0].slug },
    });
  if (pathname === '/api/app/notifications/unread-count') return data({ count: 3 });
  for (const org of organizations) {
    if (pathname === `/api/app/organizations/by-slug/${org.slug}`) return data({ ...org, administrators: [{ name: user.name }] });
    if (pathname === `/api/app/organizations/${org.id}/usage`)
      return data({
        plan: { key: null },
        period: { start: '2026-11-01T00:00:00.000Z', endExclusive: '2026-12-01T00:00:00.000Z' },
        availability: 'complete',
        meters: [],
        websites: [],
        incomplete: false,
      });
  }
  return null;
};

const fixture = `
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { CommandPaletteProvider } from '../src/components/app/command-palette';
import { SwitcherProvider } from '../src/components/app/org-switcher/switcher-provider';
import { SkipToContent } from '../src/components/app/skip-to-content';
import { AppProviders } from '../src/components/app-providers';
import { createQueryClient } from '../src/integrations/tanstack-query/query-client';
import { Route as billing } from '../src/routes/app/o/$orgSlug/billing';
import { Route as organization } from '../src/routes/app/o/$orgSlug/route';
import { ProjectProvider } from '../src/stores/active-project';

await setLanguage(new URLSearchParams(location.search).get('locale') === 'ar' ? 'ar' : 'en');
document.documentElement.classList.add('light');
document.documentElement.style.colorScheme = 'light';
const queryClient = createQueryClient();
const routeSession = await (await fetch('/api/auth/get-session')).json();
// The signed-in shell from routes/app/route.tsx, without its server session check.
function Shell() {
  return (
    <AppProviders>
      <div data-dashboard-shell="">
        <SkipToContent />
        <ProjectProvider>
          <SwitcherProvider>
            <CommandPaletteProvider>
              <Outlet />
            </CommandPaletteProvider>
          </SwitcherProvider>
        </ProjectProvider>
      </div>
    </AppProviders>
  );
}
const root = createRootRoute({ component: Outlet });
const app = createRoute({ getParentRoute: () => root, path: '/app', beforeLoad: () => ({ routeSession }), component: Shell });
const organizationRoute = organization.update({ getParentRoute: () => app, path: 'o/$orgSlug' } as never);
const billingRoute = billing.update({ getParentRoute: () => organizationRoute, path: 'billing' } as never);
const router = createRouter({ routeTree: root.addChildren([app.addChildren([organizationRoute.addChildren([billingRoute])])]), context: { queryClient } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
`;

/** In the page: the header's controls, their boxes, and what overlaps what. */
function measure(name) {
  const header = document.querySelector('header [data-slot="breadcrumb-page"]').closest('header');
  const box = (element) => {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return {
      left: Math.round(r.left * 10) / 10,
      right: Math.round(r.right * 10) / 10,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width * 10) / 10,
      height: Math.round(r.height * 10) / 10,
    };
  };
  const item = header.querySelector('[data-slot="breadcrumb-item"]');
  const trigger = item.querySelector('button');
  const nameSpan = trigger.querySelector('span.truncate');
  const children = [...header.children];
  const controls = {
    sidebar: header.querySelector('[data-slot="sidebar-trigger"]'),
    trigger,
    separator: header.querySelector('[data-slot="breadcrumb-separator"]'),
    section: header.querySelector('[data-slot="breadcrumb-page"]'),
    search: children.at(-2),
    bell: children.at(-1),
  };
  const boxes = Object.fromEntries(Object.entries(controls).map(([key, element]) => [key, box(element)]));
  const overlaps = [];
  const keys = Object.keys(boxes);
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const a = boxes[keys[i]];
      const b = boxes[keys[j]];
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 0.5 && y > 0.5) overlaps.push({ a: keys[i], b: keys[j], px: Math.round(x * 10) / 10 });
    }
  // The first and last character of the name: inside the visible part of the name, or cut off?
  const span = nameSpan.getBoundingClientRect();
  // Base wraps the name in <bdi>; the fix puts dir="auto" on the span itself.
  const text = (nameSpan.querySelector('bdi') ?? nameSpan).firstChild;
  const charBox = (index) => {
    const range = document.createRange();
    range.setStart(text, index);
    range.setEnd(text, index + 1);
    const r = range.getBoundingClientRect();
    return r.left >= span.left - 0.5 && r.right <= span.right + 0.5;
  };
  return {
    boxes,
    overlaps,
    triggerOutsideItem:
      Math.round(Math.max(0, item.getBoundingClientRect().left - boxes.trigger.left, boxes.trigger.right - item.getBoundingClientRect().right) * 10) /
      10,
    nameTruncated: nameSpan.scrollWidth > nameSpan.clientWidth + 1,
    nameFirstCharVisible: charBox(0),
    nameLastCharVisible: charBox(text.length - 1),
    triggerName: trigger.getAttribute('aria-label'),
    triggerNameHasFullName: trigger.getAttribute('aria-label').includes(name),
    nameDir: nameSpan.getAttribute('dir'),
    sectionText: controls.section.textContent,
    sectionTruncated: controls.section.scrollWidth > controls.section.clientWidth + 1,
    headerOverflow: header.scrollWidth > header.clientWidth + 1,
    pageOverflow: document.documentElement.scrollWidth > innerWidth,
    htmlDir: document.documentElement.dir,
  };
}

const owner = `fix/642-org-header-overlap ${new Date().toISOString()}`;
const lock = await acquireDevstackLock(owner);
const harness = await mkdtemp(resolve(appDir, '.org-header-capture-'));
try {
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Organization header</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>',
  );
  await writeFile(resolve(harness, 'main.tsx'), `import './styles.css';\n${fixture}`);
  await writeFile(resolve(harness, 'styles.css'), '@import "@nibleaf/design-system/globals.css";\n@source "../src";\n');

  const { build } = await fromApp('vite');
  const dists = {};
  for (const phase of ['before', 'after']) {
    dists[phase] = resolve(harness, `dist-${phase}`);
    await build({
      configFile: false,
      root: harness,
      base: '/',
      logLevel: 'error',
      define: { 'import.meta.env.VITE_SITE_BASE_DOMAIN': JSON.stringify('docs.example.test') },
      resolve: { alias: { '@': resolve(appDir, 'src') } },
      plugins: [
        (await fromApp('@vitejs/plugin-react')).default(),
        (await fromApp('@tailwindcss/vite')).default(),
        {
          name: 'org-header-capture',
          enforce: 'pre',
          resolveId(source) {
            if (source.startsWith('@nibleaf/')) return appRequire.resolve(source);
          },
          load(file) {
            const path = file.replaceAll('\\', '/');
            if (phase === 'before' && path.endsWith(`/${switcherFile}`)) return baseSwitcher;
            // Plain Vite has no Start import-protection transform: use the browser halves.
            if (path.endsWith('/src/services/api-origin.ts')) return 'export const apiOrigin = () => window.location.origin;';
            if (path.endsWith('/src/lib/site-origin.ts')) return 'export const customDomainOrigin = () => undefined;';
            if (path.endsWith('/src/functions/site-search.ts'))
              return 'export const searchSiteFn = () => { throw new Error("outside this fixture"); };';
          },
        },
      ],
      build: { outDir: dists[phase], emptyOutDir: true, target: 'esnext' },
    });
  }

  const sizes = [
    { width: 320, height: 640, mobile: true },
    { width: 390, height: 844, mobile: true },
    { width: 768, height: 1024, mobile: true },
    { width: 1440, height: 900, mobile: false },
  ];
  // Kept in the repository; every other combination is measured only.
  const kept = (locale, width, org) => org === 'latin' && (width === 390 || width === 1440 || (width === 320 && locale === 'ar'));
  const captures = [];
  const interactions = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const phase of ['before', 'after'])
      for (const locale of ['en', 'ar'])
        for (const size of sizes)
          for (const org of organizations) {
            const context = await browser.newContext({
              viewport: { width: size.width, height: size.height },
              isMobile: size.mobile,
              hasTouch: size.mobile,
              reducedMotion: 'reduce',
              colorScheme: 'light',
              locale,
              timezoneId: 'UTC',
            });
            const page = await context.newPage();
            const pageErrors = [];
            page.on('pageerror', (error) => pageErrors.push(error.message));
            const unexpected = [];
            await page.route(`${origin}/**`, async (route) => {
              const request = route.request();
              const { pathname } = new URL(request.url());
              if (pathname.startsWith('/api/')) {
                const json = request.method() === 'GET' || pathname === '/api/auth/get-session' ? answer(pathname) : null;
                if (json) return route.fulfill({ json });
                unexpected.push(`${request.method()} ${pathname}`);
                return route.fulfill({ json: { data: [] } });
              }
              const dist = dists[phase];
              const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
              assert.ok(file.startsWith(`${dist}${sep}`));
              const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
              return route.fulfill({ body: await readFile(file), contentType: types[extname(file)] ?? 'application/octet-stream' });
            });
            await page.goto(`${origin}/app/o/${org.slug}/billing?locale=${locale}`);
            await page.locator('header [data-slot="breadcrumb-page"]').waitFor({ timeout: 20_000 });
            await page.locator('header [data-slot="breadcrumb-item"] button span.truncate').waitFor({ timeout: 20_000 });
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(300);
            const result = await page.evaluate(measure, org.name);
            const name = `${phase}-${locale}-${size.width}`;
            let file = null;
            if (kept(locale, size.width, org.key)) {
              file = `${name}.png`;
              await page.screenshot({
                path: resolve(import.meta.dirname, file),
                clip: { x: 0, y: 0, width: size.width, height: 200 },
                animations: 'disabled',
              });
            }
            // Keyboard: the trigger still opens the switcher (sheet ≤ 640 px, popover above) and Escape returns focus to it.
            if (phase === 'after' && org.key === 'latin' && (size.width === 390 || size.width === 1440)) {
              const trigger = page.locator('header [data-slot="breadcrumb-item"] button');
              await trigger.focus();
              await page.keyboard.press('Enter');
              const dialog = page.getByRole('dialog');
              await dialog.first().waitFor({ timeout: 10_000 });
              const opened = { expanded: await trigger.getAttribute('aria-expanded'), dialogs: await dialog.count() };
              await page.keyboard.press('Escape');
              await dialog.first().waitFor({ state: 'detached', timeout: 10_000 });
              const focusBack = await trigger.evaluate((element) => document.activeElement === element);
              interactions.push({ locale, width: size.width, ...opened, focusBack });
            }
            captures.push({ phase, locale, width: size.width, organization: org.label, nameKind: org.key, file, ...result, pageErrors, unexpected });
            await context.close();
          }
    assert.equal(attempted.length, 0);
    const after = captures.filter((capture) => capture.phase === 'after');
    const before = captures.filter((capture) => capture.phase === 'before');
    const summary = {
      captures: captures.length,
      beforeWithOverlap: before.filter((c) => c.overlaps.length > 0).map((c) => `${c.locale}-${c.width}-${c.nameKind}`),
      afterWithOverlap: after.filter((c) => c.overlaps.length > 0).map((c) => `${c.locale}-${c.width}-${c.nameKind}`),
      afterTriggerOutsideItem: after.filter((c) => c.triggerOutsideItem > 0.5).length,
      beforeNameStartHidden: before.filter((c) => !c.nameFirstCharVisible).map((c) => `${c.locale}-${c.width}-${c.nameKind}`),
      afterNameStartHidden: after.filter((c) => !c.nameFirstCharVisible).map((c) => `${c.locale}-${c.width}-${c.nameKind}`),
      // Hit targets of the other header controls are the same before and after.
      hitTargetsUnchanged: after.every((c) => {
        const b = before.find((x) => x.locale === c.locale && x.width === c.width && x.nameKind === c.nameKind);
        return ['sidebar', 'search', 'bell'].every((key) => b.boxes[key].width === c.boxes[key].width && b.boxes[key].height === c.boxes[key].height);
      }),
      triggerNameHasFullName: captures.every((c) => c.triggerNameHasFullName),
      pageErrors: captures.reduce((n, c) => n + c.pageErrors.length, 0),
      pageOverflow: captures.filter((c) => c.pageOverflow).length,
    };
    for (const c of after) {
      assert.deepEqual(c.overlaps, [], `${c.locale}-${c.width}-${c.nameKind} overlaps`);
      assert.ok(c.triggerOutsideItem <= 0.5, `${c.locale}-${c.width}-${c.nameKind} trigger spills out of its breadcrumb item`);
      assert.ok(c.nameFirstCharVisible, `${c.locale}-${c.width}-${c.nameKind} hides the start of the name`);
      assert.equal(c.htmlDir, c.locale === 'ar' ? 'rtl' : 'ltr');
    }
    assert.ok(summary.hitTargetsUnchanged);
    assert.ok(summary.triggerNameHasFullName);
    assert.equal(summary.pageErrors, 0);
    for (const i of interactions) assert.ok(i.dialogs > 0 && i.expanded === 'true' && i.focusBack, JSON.stringify(i));
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Headless Chromium; the real dashboard shell, organization route and Billing page built with Vite; fictional API answers by request interception; no server, database or production request',
      base,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain'),
      before: `${switcherFile} at ${base}`,
      after: `${switcherFile} in the working tree`,
      attempted: attempted.length,
      summary,
      interactions,
      captures,
    });
    console.log(JSON.stringify(summary, null, 2));
  });
} finally {
  assert.ok(harness.startsWith(`${appDir}${sep}`));
  await rm(harness, { recursive: true, force: true });
  await lock.release();
}
